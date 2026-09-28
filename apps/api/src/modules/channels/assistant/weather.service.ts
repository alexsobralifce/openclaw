import { Injectable, Logger } from "@nestjs/common";
import { parseForecast, Weather } from "./weather";

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 5_000;

export interface Place {
  lat: number;
  lng: number;
  /** "Recife, Pernambuco" */
  name: string;
}

/**
 * Clima e localização por serviços abertos e sem chave: Open-Meteo (previsão e busca de cidades, com modelos
 * meteorológicos oficiais combinados) e BigDataCloud (nome da cidade a partir de coordenadas).
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private cache = new Map<string, { at: number; w: Weather }>();

  private async getJson(url: string): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
    return res.json();
  }

  /** Previsão para o ponto (arredondado a ~1 km para reaproveitar o cache por 10 minutos). */
  async forecast(lat: number, lng: number): Promise<Weather> {
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.w;
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
    this.cache.set(key, { at: Date.now(), w });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
    return w;
  }

  /** Cidade pelo nome ("Recife", "Recife, PE"); prefere o Brasil quando há homônimas. */
  async geocode(name: string): Promise<Place | null> {
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
