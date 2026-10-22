// Notas em lista com lembrete (lógica pura): título, itens editáveis e a data e hora em que o assistente manda a nota.
// Ficam no Postgres (list-notes-store.ts). Não servem para guardar documentos: para isso existe o catálogo de Documentos.

export interface NoteItem {
  text: string;
  done: boolean;
}

export const MAX_ITEMS = 50;
const MAX_ITEM_LEN = 120;
const MAX_TITLE_LEN = 60;

/** Título como é guardado: sem marcação do WhatsApp, até 60 letras, primeira maiúscula. */
export function cleanNoteTitle(raw: unknown): string {
  const t = String(raw ?? "").replace(/[#*_`~\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LEN).trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const BULLET = /^\s*(?:[-•*·–—]+|\d{1,2}[.)]|\[[ xX]?\]|[☐☑✅▫️]+)\s*/u;

/** Um item como é guardado: sem marcador de lista, sem marcação do WhatsApp, até 120 letras. */
export function cleanItem(raw: unknown): string {
  return String(raw ?? "").replace(BULLET, "").replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LEN).trim();
}

/** Itens de um texto: um por linha; numa linha só, separados por vírgula ou ponto e vírgula ("leite, pão, ovos"). */
export function parseItems(text: string): string[] {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parts = lines.length > 1 ? lines : (lines[0] ?? "").split(/[;,]/);
  return parts.map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS);
}

/** Lê os itens guardados no banco (JSON) com segurança. */
export function sanitizeItems(raw: unknown): NoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i: any) => ({ text: cleanItem(i?.text), done: i?.done === true }))
    .filter((i) => i.text)
    .slice(0, MAX_ITEMS);
}

/** Acrescenta itens novos (respeitando o teto). Devolve a lista e quantos entraram. */
export function addItems(items: NoteItem[], texts: string[]): { items: NoteItem[]; added: number } {
  const room = Math.max(0, MAX_ITEMS - items.length);
  const fresh = texts.map(cleanItem).filter(Boolean).slice(0, room);
  return { items: [...items, ...fresh.map((text) => ({ text, done: false }))], added: fresh.length };
}

/** Números de itens citados num texto ("2", "1, 3", "1 e 4"), de 1 a `max`, sem repetir. */
export function parseNumbers(text: string, max: number): number[] {
  const nums = (String(text ?? "").match(/\d{1,2}/g) ?? []).map(Number).filter((n) => n >= 1 && n <= max);
  return [...new Set(nums)];
}

export function toggleItems(items: NoteItem[], nums: number[]): NoteItem[] {
  return items.map((it, i) => (nums.includes(i + 1) ? { ...it, done: !it.done } : it));
}

export function removeItems(items: NoteItem[], nums: number[]): NoteItem[] {
  return items.filter((_, i) => !nums.includes(i + 1));
}

// ─── Comandos escritos ────────────────────────────────────────────

/** "notas", "minhas notas", "ver notas", "listas": abre a tela de notas (texto já normalizado). */
export function looksLikeNotesHome(flat: string): boolean {
  return /^(ver |abrir |mostrar |listar )?(as |minhas |meus )?(notas|listas)$/.test(flat);
}

/**
 * "nota compras: leite, pão, ovos", "criar lista mercado: arroz; feijão", "nova nota: ..." (sem título não vale).
 * Recebe o texto ORIGINAL (guarda acento e maiúscula). Os dois-pontos são obrigatórios: sem eles não dá para separar título e itens.
 */
export function parseNoteCreate(text: string): { title: string; items: string[] } | null {
  const m = String(text ?? "").trim().match(/^(?:por favor\s+)?(?:(?:criar|crie|nova|novo|fazer|fa[cç]a|montar|monte)\s+)?(?:uma\s+)?(?:nova\s+)?(?:nota|lista)\s+(?:de |da |do |sobre |para |chamada )?([^:\n]{1,60}?)\s*:\s*([\s\S]+)$/i);
  if (!m) return null;
  const title = cleanNoteTitle(m[1]);
  const items = parseItems(m[2]);
  return title && items.length ? { title, items } : null;
}

/** "feito 2", "marcar 1 e 3", "desmarcar 2", "concluir 2": os números e se é para marcar ou desmarcar. */
export function parseCheck(flat: string): { nums: number[] } | null {
  const m = flat.match(/^(?:feito|feita|pronto|marcar|marca|desmarcar|desmarca|concluir|conclui|riscar|risca|tirar o feito de)\s+(?:o |a |os |as )?(?:item |itens )?(\d{1,2}(?:\s*(?:,|e)\s*\d{1,2})*)$/);
  return m ? { nums: (m[1].match(/\d{1,2}/g) ?? []).map(Number) } : null;
}

// ─── Data e hora do lembrete ──────────────────────────────────────

const WEEKDAYS: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

const flatten = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Deslocamento do fuso (minutos a leste de UTC) no instante dado. */
function offsetMinutes(at: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - at) / 60_000);
}

/** Data e hora "de parede" no fuso → instante real. */
export function zonedDate(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMinutes(guess, tz) * 60_000;
  // Reconfere o deslocamento no instante achado (vale na virada de horário de verão)
  return new Date(guess - offsetMinutes(first, tz) * 60_000);
}

function localParts(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")), h: Number(g("hour")), mi: Number(g("minute")), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) };
}

const addDays = (y: number, mo: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** Hora citada: "9h", "9h30", "9:30", "às 14", "14 horas", "9 da noite", "meio dia", "meia noite". */
function parseTime(f: string): { h: number; mi: number } | null {
  if (/\bmeio[- ]?dia\b/.test(f)) return { h: 12, mi: 0 };
  if (/\bmeia[- ]?noite\b/.test(f)) return { h: 0, mi: 0 };
  const m =
    f.match(/\b(\d{1,2})\s*(?::|h|horas?\b)(?:(\d{2})(?![\d/]))?/) ??
    f.match(/\b(\d{1,2})\s+da\s+(?:manha|tarde|noite)\b/) ??
    f.match(/\bas\s+(\d{1,2})\b(?!\s*(?:\/|-|de))/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  if (h > 23 || mi > 59) return null;
  if (/\b(da|de|a) (tarde|noite)\b|\bpm\b/.test(f) && h < 12) h += 12;
  if (/\bda manha\b/.test(f) && h === 12) h = 0;
  return { h, mi };
}

export type RemindParse = { ok: true; at: Date } | { ok: false; error: string };

/**
 * Entende quando lembrar: "amanhã 9h", "hoje às 18:30", "15/10 14h", "sexta 8h", "dia 20 às 10h", "daqui a 2 horas", "em 30 minutos".
 * Só hora ("às 18h"): hoje se ainda não passou, senão amanhã. Só data, sem hora, não vale (pede a hora). Sempre no futuro.
 */
export function parseRemindAt(text: string, tz: string, now = new Date()): RemindParse {
  const f = flatten(String(text ?? ""));
  if (!f) return { ok: false, error: "Diga quando, por exemplo: *amanhã 9h*." };

  const rel = f.match(/\b(?:daqui a|daqui|em)\s+(\d{1,3})\s*(minutos?|min|horas?|h)\b/);
  if (rel) {
    const n = Number(rel[1]);
    const ms = /^h/.test(rel[2]) ? n * 3_600_000 : n * 60_000;
    return n > 0 ? { ok: true, at: new Date(now.getTime() + ms) } : { ok: false, error: "Diga um tempo maior que zero." };
  }

  const today = localParts(now, tz);
  let day: { y: number; mo: number; d: number } | null = null;
  let weekly = false; // dia da semana citado: se já passou hoje, vale o da semana que vem
  const dm = f.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/) ?? f.match(/\b(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?\b(?!\s*:)/);
  if (/\bdepois de amanha\b/.test(f)) day = addDays(today.y, today.mo, today.d, 2);
  else if (/\bamanha\b/.test(f)) day = addDays(today.y, today.mo, today.d, 1);
  else if (/\bhoje\b/.test(f)) day = { y: today.y, mo: today.mo, d: today.d };
  else if (dm) {
    const d = Number(dm[1]);
    const mo = Number(dm[2]);
    let y = dm[3] ? Number(dm[3]) : today.y;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { ok: false, error: "Não entendi essa data. Use, por exemplo, *15/10 às 14h*." };
    day = { y, mo, d };
    // Sem ano e a data já passou neste ano: vale a do ano que vem
    if (!dm[3] && zonedDate(y, mo, d, 23, 59, tz).getTime() < now.getTime()) day = { y: y + 1, mo, d };
  } else {
    const wd = Object.keys(WEEKDAYS).find((k) => new RegExp(`\\b${k}`).test(f));
    if (wd) {
      const ahead = (WEEKDAYS[wd] - today.wd + 7) % 7;
      day = addDays(today.y, today.mo, today.d, ahead);
      weekly = true;
    } else {
      const dd = f.match(/\bdia (\d{1,2})\b/);
      if (dd) {
        const d = Number(dd[1]);
        if (d < 1 || d > 31) return { ok: false, error: "Não entendi esse dia do mês." };
        let { y, mo } = today;
        if (d < today.d) ({ y, mo } = mo === 12 ? { y: y + 1, mo: 1 } : { y, mo: mo + 1 });
        day = { y, mo, d };
      }
    }
  }

  const time = parseTime(f);
  if (!time) return { ok: false, error: day ? "Faltou a hora, por exemplo: *às 9h*." : "Não entendi. Diga, por exemplo: *amanhã 9h*, *15/10 às 14h* ou *daqui a 2 horas*." };

  let at: Date;
  if (day) {
    at = zonedDate(day.y, day.mo, day.d, time.h, time.mi, tz);
    if (weekly && at.getTime() <= now.getTime()) {
      const t = addDays(day.y, day.mo, day.d, 7);
      at = zonedDate(t.y, t.mo, t.d, time.h, time.mi, tz);
    }
  } else {
    at = zonedDate(today.y, today.mo, today.d, time.h, time.mi, tz);
    if (at.getTime() <= now.getTime()) {
      const t = addDays(today.y, today.mo, today.d, 1);
      at = zonedDate(t.y, t.mo, t.d, time.h, time.mi, tz);
    }
  }
  if (at.getTime() <= now.getTime()) return { ok: false, error: "Esse horário já passou. Diga um horário futuro." };
  return { ok: true, at };
}

/** "ter., 07/10 às 09:00" no fuso do dono. */
export function fmtRemind(at: Date | string, tz: string): string {
  const d = new Date(at);
  const day = d.toLocaleDateString("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
}
