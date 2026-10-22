// Regras de automação: validação do que o usuário cadastra e avaliação das condições (lógica pura).

export const TRIGGER_EVENTS = ["message.received", "conversation.created"] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const MESSAGE_TYPES = ["TEXT", "IMAGE", "AUDIO", "VIDEO", "FILE"] as const;
const STATUSES = ["OPEN", "PENDING", "RESOLVED", "SNOOZED"] as const;
const TEXT_OPS = ["contains", "not_contains", "equals", "starts_with"] as const;

export type Condition =
  | { field: "message.body"; op: (typeof TEXT_OPS)[number]; value: string }
  | { field: "message.type"; op: "in"; value: string[] }
  | { field: "channel.id"; op: "equals"; value: string }
  | { field: "time"; op: "within" | "outside"; value: { days: number[]; start: string; end: string } };

export interface Trigger {
  event: TriggerEvent;
  conditions: Condition[];
  /** Não repete a automação na mesma conversa antes deste prazo (0 = sempre) */
  cooldownMinutes: number;
}

export type Action =
  | { type: "send_message"; text: string }
  | { type: "set_status"; status: (typeof STATUSES)[number] }
  | { type: "add_tag"; tag: string }
  | { type: "assign"; userId: string }
  | { type: "notify_owner"; text: string };

export interface RuleContext {
  message: { body: string; type: string };
  channelId: string;
  now: Date;
  timeZone: string;
}

const MAX_CONDITIONS = 10;
const MAX_ACTIONS = 10;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class RuleError extends Error {}
const fail = (msg: string): never => {
  throw new RuleError(msg);
};
const str = (v: unknown, name: string, max = 1000) => {
  if (typeof v !== "string" || !v.trim()) fail(`${name} é obrigatório`);
  if ((v as string).length > max) fail(`${name} passa de ${max} caracteres`);
  return (v as string).trim();
};

/** Valida e normaliza o que veio do painel/API. Lança erro com mensagem legível. */
export function validateRule(trigger: any, actions: any): { trigger: Trigger; actions: Action[] } {
  if (!trigger || typeof trigger !== "object") fail("gatilho ausente");
  if (!TRIGGER_EVENTS.includes(trigger.event)) fail(`evento inválido; use ${TRIGGER_EVENTS.join(" ou ")}`);
  const rawConds = trigger.conditions ?? [];
  if (!Array.isArray(rawConds) || rawConds.length > MAX_CONDITIONS) fail(`condições devem ser uma lista de até ${MAX_CONDITIONS}`);
  const conditions = rawConds.map((c: any, i: number) => validateCondition(c, i + 1));
  const cooldown = Number(trigger.cooldownMinutes ?? 0);
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 60 * 24 * 30) fail("cooldownMinutes deve ser inteiro entre 0 e 43200");

  if (!Array.isArray(actions) || !actions.length || actions.length > MAX_ACTIONS) fail(`informe de 1 a ${MAX_ACTIONS} ações`);
  return {
    trigger: { event: trigger.event, conditions, cooldownMinutes: cooldown },
    actions: actions.map((a: any, i: number) => validateAction(a, i + 1)),
  };
}

function validateCondition(c: any, i: number): Condition {
  const at = `condição ${i}`;
  if (c?.field === "message.body") {
    if (!TEXT_OPS.includes(c.op)) fail(`${at}: operador inválido (${TEXT_OPS.join(", ")})`);
    return { field: "message.body", op: c.op, value: str(c.value, `${at}: valor`, 200) };
  }
  if (c?.field === "message.type") {
    const v = Array.isArray(c.value) ? c.value : [c.value];
    if (!v.length || v.some((t: any) => !MESSAGE_TYPES.includes(t))) fail(`${at}: tipos válidos são ${MESSAGE_TYPES.join(", ")}`);
    return { field: "message.type", op: "in", value: v };
  }
  if (c?.field === "channel.id") return { field: "channel.id", op: "equals", value: str(c.value, `${at}: canal`, 50) };
  if (c?.field === "time") {
    if (c.op !== "within" && c.op !== "outside") fail(`${at}: use within ou outside`);
    const v = c.value ?? {};
    const days = Array.isArray(v.days) && v.days.length ? v.days : [1, 2, 3, 4, 5];
    if (days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) fail(`${at}: dias vão de 0 (domingo) a 6 (sábado)`);
    if (!HHMM.test(v.start ?? "") || !HHMM.test(v.end ?? "")) fail(`${at}: horários no formato HH:MM`);
    return { field: "time", op: c.op, value: { days, start: v.start, end: v.end } };
  }
  return fail(`${at}: campo inválido (message.body, message.type, channel.id ou time)`);
}

function validateAction(a: any, i: number): Action {
  const at = `ação ${i}`;
  switch (a?.type) {
    case "send_message":
      return { type: "send_message", text: str(a.text, `${at}: texto`, 4000) };
    case "notify_owner":
      return { type: "notify_owner", text: str(a.text, `${at}: texto`, 1000) };
    case "set_status":
      if (!STATUSES.includes(a.status)) fail(`${at}: status inválido`);
      return { type: "set_status", status: a.status };
    case "add_tag":
      return { type: "add_tag", tag: str(a.tag, `${at}: etiqueta`, 40) };
    case "assign":
      return { type: "assign", userId: str(a.userId, `${at}: usuário`, 50) };
  }
  return fail(`${at}: tipo inválido (send_message, set_status, add_tag, assign, notify_owner)`);
}

export const isRuleError = (e: unknown): e is Error => e instanceof RuleError;

// ─── Avaliação ───────────────────────────────────────────────────

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Dia da semana (0 = domingo) e minutos desde a meia-noite no fuso informado. */
export function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function withinHours(now: Date, timeZone: string, v: { days: number[]; start: string; end: string }) {
  const { day, minutes } = localClock(now, timeZone);
  const start = toMin(v.start);
  const end = toMin(v.end);
  // Janela que atravessa a meia-noite (ex.: 22:00–06:00)
  const inWindow = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  return v.days.includes(day) && inWindow;
}

export function conditionMatches(c: Condition, ctx: RuleContext): boolean {
  switch (c.field) {
    case "message.body": {
      const body = fold(ctx.message.body);
      const v = fold(c.value);
      if (c.op === "contains") return body.includes(v);
      if (c.op === "not_contains") return !body.includes(v);
      if (c.op === "equals") return body === v;
      return body.startsWith(v);
    }
    case "message.type":
      return c.value.includes(ctx.message.type);
    case "channel.id":
      return ctx.channelId === c.value;
    case "time": {
      const inside = withinHours(ctx.now, ctx.timeZone, c.value);
      return c.op === "within" ? inside : !inside;
    }
  }
}

export function ruleMatches(trigger: Trigger, event: TriggerEvent, ctx: RuleContext) {
  return trigger.event === event && trigger.conditions.every((c) => conditionMatches(c, ctx));
}

/** Substitui {{contato.nome}} e {{contato.telefone}} no texto. */
export function render(text: string, vars: { name?: string | null; phone?: string | null }) {
  return text.replace(/\{\{\s*contato\.nome\s*\}\}/g, vars.name ?? "").replace(/\{\{\s*contato\.telefone\s*\}\}/g, vars.phone ?? "");
}
