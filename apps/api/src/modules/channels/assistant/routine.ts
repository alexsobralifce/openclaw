// Rotina do dono (lógica pura): compromissos e hábitos recorrentes que o assistente lembra e o dono pode atualizar sempre.

export interface RoutineItem {
  /** nome curto, chave para atualizar: "Aulas", "Academia" */
  topic: string;
  description: string;
  /** dias da semana em que acontece (0 = domingo … 6 = sábado); vazio/ausente = sem dia fixo */
  days?: number[];
  /** "HH:mm" */
  time?: string;
}

export const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MAX_ROUTINE = 40;

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const topicKey = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Aceita números 0-6, "seg", "segunda", "terça-feira"... e devolve os dias únicos em ordem; "todos"/"diario" = os 7. */
export function normalizeDays(input: unknown): number[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,;]+/).filter((w) => w !== "e") : [];
  const out = new Set<number>();
  for (const raw of list) {
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 6) out.add(raw);
    else if (typeof raw === "string") {
      const s = topicKey(raw).replace(/-feira$/, "");
      if (/^(todos|todo dia|diario|diaria|diariamente)$/.test(s)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => out.add(d));
      else {
        const i = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"].findIndex((p) => s.startsWith(p));
        if (i >= 0) out.add(i);
        else if (/^[0-6]$/.test(s)) out.add(Number(s));
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Valida o que veio da IA: tema e descrição obrigatórios, hora "H:mm"/"HHhmm" normalizada. */
export function sanitizeRoutine(raw: any): RoutineItem | null {
  const topic = clean(raw?.topic, 40);
  const description = clean(raw?.description, 200);
  if (!topic || !description) return null;
  const t = /^(\d{1,2})\s*(?::|h)\s*(\d{2})?$/i.exec(String(raw?.time ?? "").trim());
  const time = t && Number(t[1]) < 24 && Number(t[2] ?? 0) < 60 ? `${t[1].padStart(2, "0")}:${t[2] ?? "00"}` : undefined;
  const days = normalizeDays(raw?.days);
  return { topic, description, ...(days.length ? { days } : {}), ...(time ? { time } : {}) };
}

export const encodeRoutine = (i: RoutineItem) => JSON.stringify(i);

export function parseRoutine(content: string): RoutineItem | null {
  try {
    return sanitizeRoutine(JSON.parse(content));
  } catch {
    return null;
  }
}

/** Itens do dia (dias fixos incluindo o de hoje), pela hora. Itens sem hora vêm no fim. */
export function todayItems(items: RoutineItem[], weekday: number): RoutineItem[] {
  return items
    .filter((i) => i.days?.includes(weekday))
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

export function when(i: RoutineItem): string {
  const days = i.days?.length === 7 ? "todo dia" : i.days?.map((d) => DAY_NAMES[d]).join(", ");
  return [days, i.time].filter(Boolean).join(" · ");
}
