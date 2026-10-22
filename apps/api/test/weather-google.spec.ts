import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeatherService } from "../src/modules/channels/assistant/weather.service";
import { googleCondition, mapGoogleWeather, parseGoogleGeocode } from "../src/modules/channels/assistant/weather";

// Respostas no formato da documentação do Weather API (condensadas)
const current = { isDaytime: true, temperature: { degrees: 29.4 }, feelsLikeTemperature: { degrees: 32 }, relativeHumidity: 70, weatherCondition: { type: "PARTLY_CLOUDY" }, precipitation: { probability: { percent: 10 } }, wind: { speed: { value: 12, unit: "KILOMETERS_PER_HOUR" } } };
const hours = { forecastHours: [5, 20, 60, 30, 10, 0, 99].map((p) => ({ precipitation: { probability: { percent: p } } })) };
const days = {
  forecastDays: [
    { maxTemperature: { degrees: 31 }, minTemperature: { degrees: 25 }, daytimeForecast: { weatherCondition: { type: "CLEAR" }, precipitation: { probability: { percent: 15 } } }, nighttimeForecast: { precipitation: { probability: { percent: 40 } } } },
    { maxTemperature: { degrees: 30 }, minTemperature: { degrees: 24 }, daytimeForecast: { weatherCondition: { type: "LIGHT_RAIN" }, precipitation: { probability: { percent: 70 } } }, nighttimeForecast: {} },
  ],
};

describe("clima do Google → formato do sistema", () => {
  it("junta condições, próximas horas e dias", () => {
    expect(mapGoogleWeather(current, hours, days)).toEqual({
      temp: 29.4, feels: 32, humidity: 70, wind: 12, code: 2, isDay: true, max: 31, min: 25,
      rainProb: 40, // o maior entre dia, noite e agora
      rainNext6h: 60, // só as 6 primeiras horas (o 99 da sétima fica de fora)
      tomorrow: { max: 30, min: 24, rainProb: 70, code: 61 },
    });
  });
  it("converte vento em milhas ou m/s para km/h; sem o essencial, falha", () => {
    expect(mapGoogleWeather({ ...current, wind: { speed: { value: 10, unit: "MILES_PER_HOUR" } } }, hours, days).wind).toBeCloseTo(16.09, 1);
    expect(mapGoogleWeather({ ...current, wind: { speed: { value: 10, unit: "METERS_PER_SECOND" } } }, hours, days).wind).toBe(36);
    expect(() => mapGoogleWeather({}, hours, days)).toThrow();
    expect(() => mapGoogleWeather(current, hours, { forecastDays: [] })).toThrow();
  });
  it("as condições viram os códigos que o sistema já mostra", () => {
    const table: [string, number][] = [["CLEAR", 0], ["MOSTLY_CLEAR", 1], ["PARTLY_CLOUDY", 2], ["CLOUDY", 3], ["LIGHT_RAIN", 61], ["RAIN", 63], ["HEAVY_RAIN", 65], ["RAIN_SHOWERS", 80], ["HEAVY_RAIN_SHOWERS", 82], ["THUNDERSTORM", 95], ["LIGHT_SNOW", 71], ["HAIL", 77], ["TYPE_UNSPECIFIED", -1]];
    for (const [type, code] of table) expect(googleCondition(type), type).toBe(code);
  });
  it("geocodificação: cidade e estado, e nada quando não achou", () => {
    const ok = { status: "OK", results: [{ formatted_address: "Recife, PE, Brasil", geometry: { location: { lat: -8.05, lng: -34.9 } }, address_components: [{ long_name: "Recife", types: ["locality"] }, { long_name: "Pernambuco", types: ["administrative_area_level_1"] }] }] };
    expect(parseGoogleGeocode(ok)).toEqual({ lat: -8.05, lng: -34.9, name: "Recife, Pernambuco" });
    expect(parseGoogleGeocode({ status: "ZERO_RESULTS", results: [] })).toBeNull();
  });
});

describe("WeatherService: Google primeiro, Open-Meteo de reserva", () => {
  const calls: string[] = [];
  let googleDown = false;
  beforeEach(() => {
    calls.length = 0;
    googleDown = false;
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(new URL(u).hostname + new URL(u).pathname);
      if (u.includes("googleapis.com")) {
        if (googleDown) return new Response("{}", { status: 403 });
        if (u.includes("currentConditions")) return new Response(JSON.stringify(current));
        if (u.includes("forecast/hours")) return new Response(JSON.stringify(hours));
        if (u.includes("forecast/days")) return new Response(JSON.stringify(days));
        if (u.includes("geocode")) return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: -8.05, lng: -34.9 } }, address_components: [{ long_name: "Recife", types: ["locality"] }, { long_name: "Pernambuco", types: ["administrative_area_level_1"] }] }] }));
      }
      if (u.includes("open-meteo.com/v1/forecast")) return new Response(JSON.stringify({ current: { temperature_2m: 27, apparent_temperature: 30, relative_humidity_2m: 60, weather_code: 3, wind_speed_10m: 9, is_day: 1 }, daily: { temperature_2m_max: [30, 31], temperature_2m_min: [24, 25], precipitation_probability_max: [20, 30], weather_code: [3, 61] }, hourly: { precipitation_probability: [10, 20] } }));
      if (u.includes("geocoding-api.open-meteo.com")) return new Response(JSON.stringify({ results: [{ name: "Recife", admin1: "Pernambuco", country_code: "BR", latitude: -8.05, longitude: -34.9 }] }));
      return new Response("{}", { status: 404 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("com a chave usa o Google (3 chamadas, guardadas por 10 minutos) e informa a fonte", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "chave";
    const svc = new WeatherService();
    const w = await svc.forecast(-8.05, -34.9);
    expect(w.temp).toBe(29.4);
    expect(svc.source).toBe("Google");
    expect(calls.filter((c) => c.startsWith("weather.googleapis.com"))).toHaveLength(3);
    calls.length = 0;
    await svc.forecast(-8.05, -34.9);
    expect(calls).toHaveLength(0);
  });

  it("se o Google falhar, cai no Open-Meteo sem erro para o usuário", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "chave";
    googleDown = true;
    const svc = new WeatherService();
    expect((await svc.forecast(-8.05, -34.9)).temp).toBe(27);
    expect(svc.source).toBe("Open-Meteo");
    expect((await svc.geocode("Recife"))!.name).toBe("Recife, Pernambuco");
  });

  it("sem a chave nem tenta o Google", async () => {
    const svc = new WeatherService();
    await svc.forecast(-8.05, -34.9);
    await svc.geocode("Recife");
    expect(calls.some((c) => c.includes("googleapis"))).toBe(false);
    expect(svc.source).toBe("Open-Meteo");
  });

  it("a cidade pelo nome vem do Google quando há chave", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "chave";
    expect(await new WeatherService().geocode("Recife, PE")).toEqual({ lat: -8.05, lng: -34.9, name: "Recife, Pernambuco" });
    expect(calls.every((c) => c.includes("googleapis"))).toBe(true);
  });
});
