// Contador de tokens de IA por usuário: o contexto (quem está pedindo) viaja pela cadeia assíncrona, então as chamadas
// à OpenAI/Gemini registram o consumo sem receber o usuário como parâmetro. Registrar nunca derruba o comando.

import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@openclaw/database";
import { dayStamp } from "./notes";

export const SYSTEM_USER = "sistema";
const TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";

export interface UsageContext {
  userId?: string;
  workspaceId?: string;
}
const als = new AsyncLocalStorage<UsageContext>();

/** A partir daqui (e em tudo que este fluxo chamar), o consumo de IA é do usuário. */
export const trackUser = (ctx: UsageContext) => als.enterWith(ctx);
export const runAs = <T>(ctx: UsageContext, fn: () => T) => als.run(ctx, fn);

export interface Tokens {
  input: number;
  output: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Resposta da OpenAI (chat): `usage.prompt_tokens` / `completion_tokens`. */
export const openaiTokens = (data: any): Tokens => ({ input: num(data?.usage?.prompt_tokens), output: num(data?.usage?.completion_tokens) });

/** Resposta do Gemini: `usageMetadata`; o que o modelo "pensou" também é cobrado como saída. */
export const geminiTokens = (data: any): Tokens => ({
  input: num(data?.usageMetadata?.promptTokenCount),
  output: num(data?.usageMetadata?.candidatesTokenCount) + num(data?.usageMetadata?.thoughtsTokenCount),
});

/** Soma uma chamada ao contador do dia. Falhas (banco fora, tabela ainda não criada) só viram aviso no log. */
export function recordUsage(provider: string, model: string, tokens: Tokens, fallbackWs?: string, at = new Date()): void {
  const ctx = als.getStore();
  const userId = ctx?.userId ?? SYSTEM_USER;
  const workspaceId = ctx?.workspaceId ?? fallbackWs ?? "";
  const day = dayStamp(at, TZ);
  void Promise.resolve()
    .then(() =>
      prisma.aiUsage.upsert({
        where: { userId_day_provider_model: { userId, day, provider, model } },
        create: { userId, workspaceId, day, provider, model, calls: 1, inputTokens: tokens.input, outputTokens: tokens.output },
        update: { calls: { increment: 1 }, inputTokens: { increment: tokens.input }, outputTokens: { increment: tokens.output } },
      }),
    )
    .catch((e: any) => console.warn(`Contador de tokens falhou: ${String(e?.message ?? e).slice(0, 120)}`));
}

export interface UsageRow {
  userId: string;
  provider: string;
  model: string;
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UserUsage {
  userId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  byProvider: Record<string, { calls: number; tokens: number }>;
  lastDay: string;
}

/** Agrupa as linhas por usuário (mais consumo primeiro) e soma o total geral. */
export function rollup(rows: UsageRow[]): { users: UserUsage[]; total: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number }; byDay: { day: string; tokens: number }[] } {
  const users = new Map<string, UserUsage>();
  const days = new Map<string, number>();
  for (const r of rows) {
    const u = users.get(r.userId) ?? { userId: r.userId, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, byProvider: {}, lastDay: "" };
    const t = r.inputTokens + r.outputTokens;
    u.calls += r.calls;
    u.inputTokens += r.inputTokens;
    u.outputTokens += r.outputTokens;
    u.totalTokens += t;
    const p = (u.byProvider[r.provider] ??= { calls: 0, tokens: 0 });
    p.calls += r.calls;
    p.tokens += t;
    if (r.day > u.lastDay) u.lastDay = r.day;
    users.set(r.userId, u);
    days.set(r.day, (days.get(r.day) ?? 0) + t);
  }
  const list = [...users.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  const total = list.reduce((s, u) => ({ calls: s.calls + u.calls, inputTokens: s.inputTokens + u.inputTokens, outputTokens: s.outputTokens + u.outputTokens, totalTokens: s.totalTokens + u.totalTokens }), { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return { users: list, total, byDay: [...days].map(([day, tokens]) => ({ day, tokens })).sort((a, b) => a.day.localeCompare(b.day)) };
}
