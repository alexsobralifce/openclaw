// Agenda por dia: agrupa, ordena e formata os compromissos (lógica pura, sem Google nem estado).

export interface DayEvent {
  titulo?: string;
  inicio: string;
  fim?: string | null;
  local?: string;
  agenda?: string;
  account?: string;
}

export const isAllDay = (e: DayEvent) => !String(e.inicio).includes("T");

export function dayOf(e: DayEvent, tz: string): string {
  return isAllDay(e) ? String(e.inicio).slice(0, 10) : new Date(e.inicio).toLocaleDateString("sv-SE", { timeZone: tz });
}

/** Dia inteiro primeiro, depois por horário. */
export function sortDay(evs: DayEvent[]): DayEvent[] {
  return [...evs].sort((a, b) => Number(isAllDay(b)) - Number(isAllDay(a)) || String(a.inicio).localeCompare(String(b.inicio)));
}

const hhmm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

export function timeRange(e: DayEvent, tz: string): string {
  if (isAllDay(e)) return "☀️ Dia todo";
  return `🕘 ${hhmm(e.inicio, tz)}${e.fim && String(e.fim).includes("T") ? ` – ${hhmm(e.fim, tz)}` : ""}`;
}

export interface WeekDay {
  day: string;
  count: number;
  first?: string;
}

/** Um item por dia do período (inclusive os livres), com quantos compromissos e o primeiro horário. */
export function weekSummary(days: string[], events: DayEvent[], tz: string): WeekDay[] {
  return days.map((day) => {
    const evs = sortDay(events.filter((e) => dayOf(e, tz) === day));
    const firstTimed = evs.find((e) => !isAllDay(e));
    return { day, count: evs.length, first: firstTimed ? hhmm(firstTimed.inicio, tz) : evs.length ? "dia todo" : undefined };
  });
}

export const dayLabel = (day: string, tz: string, today: string, tomorrow: string) => {
  const d = new Date(`${day}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" });
  return day === today ? `Hoje · ${d}` : day === tomorrow ? `Amanhã · ${d}` : d;
};

export const countText = (w: WeekDay) =>
  w.count === 0 ? "livre" : `${w.count} compromisso${w.count > 1 ? "s" : ""}${w.first ? ` · começa ${w.first === "dia todo" ? "(dia todo)" : `às ${w.first}`}` : ""}`;

/** Um bloco por compromisso: horário, título e, se houver, local e agenda. */
export function dayBlocks(events: DayEvent[], tz: string, multi: boolean): string[] {
  return sortDay(events).map((e) => {
    const extra = [e.local ? `📍 ${e.local}` : "", multi && e.account ? `📥 ${e.account.split("@")[0]}` : ""].filter(Boolean).join(" · ");
    return [timeRange(e, tz), `*${e.titulo ?? "(sem título)"}*`, extra].filter(Boolean).join("\n");
  });
}
