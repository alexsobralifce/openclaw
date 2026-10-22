// Avisos que o usuário liga/desliga no menu (e-mail, agenda, notas) e lembretes de compromissos da agenda.

export type NotifyKind = "email" | "agenda" | "notes";
export type NotifyPrefs = Record<NotifyKind, boolean>;

export const NOTIFY_KINDS: NotifyKind[] = ["email", "agenda", "notes"];
export const NOTIFY_LABEL: Record<NotifyKind, { icon: string; label: string }> = {
  email: { icon: "📧", label: "E-mails novos" },
  agenda: { icon: "📅", label: "Lembretes da agenda" },
  notes: { icon: "📝", label: "Lembretes de notas" },
};

export const notifyKey = (ws: string) => `notify:${ws}`;

interface Store {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}

/** Tudo ligado até o usuário desligar. */
export async function loadNotify(state: Store, ws: string): Promise<NotifyPrefs> {
  const v = await state.get<Partial<NotifyPrefs>>(notifyKey(ws));
  return { email: v?.email !== false, agenda: v?.agenda !== false, notes: v?.notes !== false };
}

export const notifyOn = async (state: Store, ws: string, kind: NotifyKind) => (await loadNotify(state, ws))[kind];

export async function setNotify(state: Store, ws: string, kind: NotifyKind, on: boolean): Promise<NotifyPrefs> {
  const next = { ...(await loadNotify(state, ws)), [kind]: on };
  await state.set(notifyKey(ws), next);
  return next;
}

/** "desligar avisos de e-mail", "ativar lembretes da agenda"... (texto já normalizado, sem acento). */
export function parseNotifyCommand(flat: string): { kind: NotifyKind; on: boolean } | null {
  const m = /^(ligar|ativar|desligar|desativar|parar)( os| as)? (avisos?|lembretes?|notificacoes)( de| da| do| das| dos)? (e-?mails?|agenda|notas?)$/.exec(flat.trim());
  if (!m) return null;
  return { on: m[1] === "ligar" || m[1] === "ativar", kind: m[5].startsWith("e") ? "email" : m[5] === "agenda" ? "agenda" : "notes" };
}

// Lembrete de compromisso, escolhido por quem agenda

export type RemindChoice = "15m" | "1h" | "1d" | "eve" | "day" | "none";

export const evremKey = (ws: string, eventId: string) => `evrem:${ws}:${eventId}`;

export interface EventReminder {
  at: number;
  title: string;
  start: string;
  account: string;
  /** quanto antes avisa, para o texto ("daqui a 15 min") */
  label: string;
}

const MIN = 60_000;
const BEFORE: Record<"15m" | "1h" | "1d", { ms: number; label: string }> = {
  "15m": { ms: 15 * MIN, label: "daqui a 15 minutos" },
  "1h": { ms: 60 * MIN, label: "daqui a 1 hora" },
  "1d": { ms: 24 * 60 * MIN, label: "amanhã" },
};

const prevDay = (d: string) => new Date(new Date(`${d}T12:00:00-03:00`).getTime() - 24 * 60 * MIN).toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });

/** Quando avisar e como dizer. Nulo se a escolha é "não precisa" ou o horário já passou. */
export function remindPlan(start: string, choice: RemindChoice, now = Date.now()): { at: number; label: string } | null {
  if (choice === "none") return null;
  const allDay = !start.includes("T");
  let at: number;
  let label: string;
  if (allDay) {
    if (choice === "eve") {
      at = new Date(`${prevDay(start)}T18:00:00-03:00`).getTime();
      label = "amanhã";
    } else if (choice === "day") {
      at = new Date(`${start}T08:00:00-03:00`).getTime();
      label = "hoje";
    } else return null;
  } else {
    if (choice !== "15m" && choice !== "1h" && choice !== "1d") return null;
    at = new Date(start).getTime() - BEFORE[choice].ms;
    label = BEFORE[choice].label;
  }
  return Number.isFinite(at) && at > now ? { at, label } : null;
}

export function eventReminderText(r: EventReminder, tz: string): string {
  const allDay = !r.start.includes("T");
  const when = allDay
    ? "dia todo"
    : new Date(r.start).toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return [`⏰ *Lembrete:* ${r.label}`, `📌 *${r.title}*`, `🕐 ${when}`].join("\n");
}
