import { Injectable, Logger } from "@nestjs/common";
import { mapGoogleWeather, parseForecast, parseGoogleGeocode, Weather } from "./weather";

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 5_000;

export interface Place {
  lat: number;
  lng: number;
  /** "Recife, Pernambuco" */
  name: string;
}

/**
 * Clima e localização. Com GOOGLE_MAPS_API_KEY (Weather API e Geocoding API ativadas no Google Cloud) vêm do Google; sem a chave, ou se o
 * Google falhar, vêm dos serviços abertos que já usávamos: Open-Meteo (previsão e busca de cidades) e BigDataCloud (nome da cidade).
 * `source` diz de onde veio a última previsão, para a tela mostrar a fonte certa.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private cache = new Map<string, { at: number; w: Weather; source: string }>();
  /** Fonte da última previsão entregue: "Google" ou "Open-Meteo". */
  source = "Open-Meteo";

  private get googleKey() { return process.env.GOOGLE_MAPS_API_KEY || ""; }

  private async getJson(url: string): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
    return res.json();
  }

  /** Previsão para o ponto (arredondado a ~1 km para reaproveitar o cache por 10 minutos). */
  async forecast(lat: number, lng: number): Promise<Weather> {
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      this.source = hit.source;
      return hit.w;
    }
    if (this.googleKey) {
      try {
        const w = await this.googleForecast(lat, lng);
        this.remember(key, w, "Google");
        return w;
      } catch (e: any) {
        this.logger.warn(`Clima do Google indisponível, usando o Open-Meteo: ${e.message}`);
      }
    }
    const p = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      hourly: "precipitation_probability",
      forecast_hours: "6",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
      forecast_days: "2",
      timezone: "auto",
    });
    const w = parseForecast(await this.getJson(`https://api.open-meteo.com/v1/forecast?${p}`));
    this.remember(key, w, "Open-Meteo");
    return w;
  }

  private remember(key: string, w: Weather, source: string) {
    this.source = source;
    this.cache.set(key, { at: Date.now(), w, source });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Condições atuais, próximas 6 horas e 2 dias, em português e em unidades métricas. */
  private async googleForecast(lat: number, lng: number): Promise<Weather> {
    const base = `key=${encodeURIComponent(this.googleKey)}&location.latitude=${lat.toFixed(4)}&location.longitude=${lng.toFixed(4)}&languageCode=pt-BR&unitsSystem=METRIC`;
    const [current, hours, days] = await Promise.all([
      this.getJson(`https://weather.googleapis.com/v1/currentConditions:lookup?${base}`),
      this.getJson(`https://weather.googleapis.com/v1/forecast/hours:lookup?${base}&hours=6`),
      this.getJson(`https://weather.googleapis.com/v1/forecast/days:lookup?${base}&days=2`),
    ]);
    return mapGoogleWeather(current, hours, days);
  }

  /** Cidade pelo nome ("Recife", "Recife, PE"); prefere o Brasil quando há homônimas. */
  async geocode(name: string): Promise<Place | null> {
    if (this.googleKey) {
      try {
        const p = new URLSearchParams({ address: name.slice(0, 100), region: "br", language: "pt-BR", key: this.googleKey });
        const hit = parseGoogleGeocode(await this.getJson(`https://maps.googleapis.com/maps/api/geocode/json?${p}`));
        if (hit) return hit;
      } catch (e: any) {
        this.logger.warn(`Busca de cidade no Google indisponível, usando o Open-Meteo: ${e.message}`);
      }
    }
    const city = name.split(",")[0].trim();
    const p = new URLSearchParams({ name: city, count: "10", language: "pt", format: "json" });
    const j = await this.getJson(`https://geocoding-api.open-meteo.com/v1/search?${p}`);
    const hits: any[] = j?.results ?? [];
    const hint = name.includes(",") ? name.split(",")[1].trim().toLowerCase() : "";
    const best =
      (hint && hits.find((h) => h.country_code === "BR" && String(h.admin1 ?? "").toLowerCase().includes(hint))) ||
      hits.find((h) => h.country_code === "BR") ||
      hits[0];
    if (!best) return null;
    return { lat: best.latitude, lng: best.longitude, name: [best.name, best.admin1].filter(Boolean).join(", ") };
  }

  /** Nome da cidade onde está o ponto; nulo se o serviço não responder. */
  async reverse(lat: number, lng: number): Promise<string | null> {
    if (this.googleKey) {
      try {
        const p = new URLSearchParams({ latlng: `${lat},${lng}`, language: "pt-BR", result_type: "locality|administrative_area_level_2", key: this.googleKey });
        const hit = parseGoogleGeocode(await this.getJson(`https://maps.googleapis.com/maps/api/geocode/json?${p}`));
        if (hit) return hit.name;
      } catch (e: any) {
        this.logger.warn(`Nome da cidade no Google indisponível, usando o BigDataCloud: ${e.message}`);
      }
    }
    try {
      const j = await this.getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=pt`);
      const city = j?.city || j?.locality;
      return city ? [city, j?.principalSubdivision].filter(Boolean).join(", ") : null;
    } catch (e: any) {
      this.logger.warn(`Nome da cidade indisponível: ${e.message}`);
      return null;
    }
  }
}
