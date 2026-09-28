// Clima (lógica pura): interpreta a resposta da Open-Meteo e monta as linhas do menu.

export interface Weather {
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
  /** hoje */
  max: number;
  min: number;
  rainProb: number;
  /** maior chance de chuva nas próximas 6 horas (%) */
  rainNext6h: number;
  /** amanhã, se a previsão trouxe */
  tomorrow?: { max: number; min: number; rainProb: number; code: number };
}

// Códigos WMO usados pela Open-Meteo
const WMO: Record<number, [string, string]> = {
  0: ["☀️", "Céu limpo"], 1: ["🌤️", "Quase limpo"], 2: ["⛅", "Parcialmente nublado"], 3: ["☁️", "Nublado"],
  45: ["🌫️", "Neblina"], 48: ["🌫️", "Neblina"],
  51: ["🌦️", "Garoa fraca"], 53: ["🌦️", "Garoa"], 55: ["🌦️", "Garoa forte"], 56: ["🌧️", "Garoa gelada"], 57: ["🌧️", "Garoa gelada"],
  61: ["🌧️", "Chuva fraca"], 63: ["🌧️", "Chuva"], 65: ["🌧️", "Chuva forte"], 66: ["🌧️", "Chuva gelada"], 67: ["🌧️", "Chuva gelada"],
  71: ["🌨️", "Neve fraca"], 73: ["🌨️", "Neve"], 75: ["🌨️", "Neve forte"], 77: ["🌨️", "Granizo fino"],
  80: ["🌦️", "Pancadas de chuva"], 81: ["🌧️", "Pancadas de chuva"], 82: ["⛈️", "Pancadas fortes"],
  85: ["🌨️", "Pancadas de neve"], 86: ["🌨️", "Pancadas de neve"],
  95: ["⛈️", "Tempestade"], 96: ["⛈️", "Tempestade com granizo"], 99: ["⛈️", "Tempestade com granizo"],
};

export function describeCode(code: number, isDay = true): { icon: string; text: string } {
  const [icon, text] = WMO[code] ?? ["🌡️", "Tempo indefinido"];
  return { icon: !isDay && (code === 0 || code === 1) ? "🌙" : icon, text };
}

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const deg = (v: number) => `${Math.round(v)}°`;

/** Lê a resposta da Open-Meteo (current + daily + hourly de 6 h); lança erro se vier sem o essencial. */
export function parseForecast(j: any): Weather {
  const c = j?.current;
  const d = j?.daily;
  if (!c || typeof c.temperature_2m !== "number" || !d?.temperature_2m_max?.length) throw new Error("previsão indisponível");
  const hourly: number[] = (j?.hourly?.precipitation_probability ?? []).filter((x: unknown) => typeof x === "number");
  return {
    temp: c.temperature_2m,
    feels: n(c.apparent_temperature, c.temperature_2m),
    humidity: n(c.relative_humidity_2m),
    wind: n(c.wind_speed_10m),
    code: n(c.weather_code),
    isDay: c.is_day !== 0,
    max: d.temperature_2m_max[0],
    min: d.temperature_2m_min[0],
    rainProb: n(d.precipitation_probability_max?.[0]),
    rainNext6h: hourly.length ? Math.max(...hourly) : n(d.precipitation_probability_max?.[0]),
    tomorrow: d.temperature_2m_max.length > 1
      ? { max: d.temperature_2m_max[1], min: d.temperature_2m_min[1], rainProb: n(d.precipitation_probability_max?.[1]), code: n(d.weather_code?.[1]) }
      : undefined,
  };
}

/** Dica prática, só quando vale a pena. */
export function weatherTip(w: Weather): string {
  if (w.rainNext6h >= 60 || (w.rainProb >= 70 && w.code >= 51)) return "☔ Leve o guarda-chuva";
  if (w.feels >= 35) return "🥵 Calor forte: beba água e evite o sol do meio-dia";
  if (w.temp <= 15) return "🧥 Frio: leve um casaco";
  return "";
}

/** Duas linhas para o menu: agora + resumo do dia. */
export function weatherLines(w: Weather): string[] {
  const { icon, text } = describeCode(w.code, w.isDay);
  const tip = weatherTip(w);
  return [
    `${icon} *${deg(w.temp)}* (sensação ${deg(w.feels)}) · ${text}`,
    `     hoje ${deg(w.min)}–${deg(w.max)} · chuva ${Math.round(w.rainProb)}%${tip ? ` · ${tip}` : ""}`,
  ];
}

/** Tela completa do clima (agora, próximas horas e amanhã). */
export function weatherDetail(w: Weather, place: string): string[] {
  const { icon, text } = describeCode(w.code, w.isDay);
  const out = [
    `📍 *${place}*`,
    `${icon} *${deg(w.temp)}* · ${text}`,
    `🌡️ Sensação ${deg(w.feels)} · 💧 umidade ${Math.round(w.humidity)}% · 💨 vento ${Math.round(w.wind)} km/h`,
    `📅 Hoje: mín ${deg(w.min)} / máx ${deg(w.max)} · chuva ${Math.round(w.rainProb)}%`,
    `🕐 Próximas 6 h: chance de chuva até ${Math.round(w.rainNext6h)}%`,
  ];
  if (w.tomorrow) {
    const t = describeCode(w.tomorrow.code);
    out.push(`🌅 Amanhã: ${t.icon} ${t.text} · mín ${deg(w.tomorrow.min)} / máx ${deg(w.tomorrow.max)} · chuva ${Math.round(w.tomorrow.rainProb)}%`);
  }
  const tip = weatherTip(w);
  if (tip) out.push(tip);
  return out;
}
