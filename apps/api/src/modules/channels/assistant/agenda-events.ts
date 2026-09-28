// Criar eventos a partir de texto, links, imagens ou posts encaminhados (lógica pura).
// Tudo que vem de fora é DADO: a IA só extrai; nada vai para a agenda sem o dono confirmar a lista.

export interface AgendaEvent {
  title: string;
  /** "YYYY-MM-DDTHH:mm:ss-03:00" ou, para dia inteiro, "YYYY-MM-DD" */
  start: string;
  end: string;
  description?: string | null;
}

export interface EventsPlan {
  events: AgendaEvent[];
  /** itens que a IA viu mas não deu para criar (sem dia, data inválida, muito antiga...) */
  skipped: string[];
  /** por que nada foi encontrado, quando for o caso */
  error?: string;
  /** quantos passaram do teto e ficaram de fora */
  truncated: number;
}

export const MAX_EVENTS = 20;
const OFFSET = "-03:00";
const DAY_MS = 864e5;

/** Endereços http(s) citados no texto (sem pontuação colada no fim), sem repetir. */
export function extractUrls(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of text.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const url = m.replace(/[)\].,;:!?]+$/, "");
    if (!out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * O texto pede para pôr coisas na agenda? ("adicione na agenda", "crie esses eventos", "marque na agenda").
 * `flat` = texto normalizado (minúsculas, sem acentos nem pontuação). Perguntas ("o que tenho na agenda") não contam.
 */
export function looksLikeAgendaIntent(flat: string): boolean {
  const verb = /\b(adicion\w*|coloc\w*|cri[ae]\w*|marc\w*|marqu\w*|agend(e|ar)|anot\w*|inclu\w*|lanc\w*|registr\w*|cadastr\w*)\b/.test(flat);
  const target = /\b(agenda|calendario|evento|eventos|compromisso|compromissos|google agenda)\b/.test(flat);
  return verb && target;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Aceita "2026-10-03", "2026-10-03T14:00", com ou sem segundos/fuso; devolve o formato canônico ou null. */
function normalizeStart(v: unknown): { value: string; ms: number; allDay: boolean } | null {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const ms = Date.parse(`${s}T12:00:00${OFFSET}`);
    // recusa dias que não existem (2026-02-31 viraria março)
    return Number.isNaN(ms) || isoDay(Date.parse(`${s}T12:00:00Z`)) !== s ? null : { value: s, ms, allDay: true };
  }
  const t = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
  if (!t) return null;
  const value = `${t[1]}T${t[2]}:${t[3]}:${t[4] ?? "00"}${t[5] && t[5] !== "Z" ? t[5] : t[5] === "Z" ? "+00:00" : OFFSET}`;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : { value, ms, allDay: false };
}

/** Extrai o objeto JSON da resposta da IA (aceita cercas ```json e texto em volta). */
export function extractJson(raw: string): any {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

/**
 * Lê o JSON `{"eventos":[{"titulo","inicio","fim","descricao"}],"erro":string|null}` devolvido pela IA e descarta o que não faz sentido:
 * sem título ou data válida, mais de 1 dia no passado, mais de 3 anos no futuro, repetidos. Sem fim (ou fim antes do início)
 * vira 1 hora depois; sem hora vira dia inteiro.
 */
export function parseEventsPlan(raw: string, now = Date.now(), max = MAX_EVENTS): EventsPlan {
  const data = extractJson(raw);
  const plan: EventsPlan = { events: [], skipped: [], truncated: 0 };
  if (!data) return { ...plan, error: "não consegui entender a resposta da IA" };
  const seen = new Set<string>();
  for (const it of Array.isArray(data.eventos) ? data.eventos : []) {
    const title = String(it?.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const start = normalizeStart(it?.inicio);
    if (!title) continue;
    if (!start) {
      plan.skipped.push(`${title} (sem data clara)`);
      continue;
    }
    if (start.ms < now - DAY_MS || start.ms > now + 3 * 365 * DAY_MS) {
      plan.skipped.push(`${title} (data fora do período: ${start.value.slice(0, 10)})`);
      continue;
    }
    // dia inteiro: o Google exige o dia seguinte como fim; quem cria calcula (ver calendarCreate)
    const e = start.allDay ? null : normalizeStart(it?.fim);
    const end = start.allDay ? start.value : e && !e.allDay && e.ms > start.ms ? e.value : toOffset(start.ms + 3600_000);
    const dedupe = `${title.toLowerCase()}|${start.value}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (plan.events.length >= max) {
      plan.truncated++;
      continue;
    }
    const description = typeof it?.descricao === "string" && it.descricao.trim() ? it.descricao.trim().slice(0, 500) : null;
    plan.events.push({ title, start: start.value, end, description });
  }
  plan.events.sort((a, b) => Date.parse(a.start.length === 10 ? `${a.start}T00:00:00${OFFSET}` : a.start) - Date.parse(b.start.length === 10 ? `${b.start}T00:00:00${OFFSET}` : b.start));
  if (!plan.events.length) plan.error = typeof data.erro === "string" && data.erro.trim() ? data.erro.trim().slice(0, 200) : "não encontrei compromissos com dia definido";
  return plan;
}

/** ms → "YYYY-MM-DDTHH:mm:ss-03:00" (o fuso de Fortaleza não tem horário de verão). */
function toOffset(ms: number): string {
  const d = new Date(ms - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${OFFSET}`;
}

/** Dia seguinte a "YYYY-MM-DD" (fim exclusivo dos eventos de dia inteiro no Google Agenda). */
export function nextDay(day: string): string {
  return isoDay(Date.parse(`${day}T12:00:00Z`) + DAY_MS);
}
