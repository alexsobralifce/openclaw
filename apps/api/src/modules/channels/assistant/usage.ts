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

/** Preço em US$ por 1 milhão de tokens. */
export interface Price {
  in: number;
  out: number;
}

/** Só o que está confirmado; os demais modelos entram pela variável AI_PRICES (JSON: {"modelo":{"in":0.1,"out":0.4}}). */
const DEFAULT_PRICES: Record<string, Price> = { "gpt-4o-mini": { in: 0.15, out: 0.6 } };

/** Tabela de preços: os padrões mais o que o dono definir em AI_PRICES (entradas inválidas são ignoradas). */
export function loadPrices(raw = process.env.AI_PRICES): Record<string, Price> {
  const out = { ...DEFAULT_PRICES };
  try {
    for (const [model, p] of Object.entries(JSON.parse(raw || "{}") as Record<string, any>)) {
      if (Number.isFinite(p?.in) && Number.isFinite(p?.out) && p.in >= 0 && p.out >= 0) out[model] = { in: p.in, out: p.out };
    }
  } catch {
    /* AI_PRICES inválida: fica só com os padrões */
  }
  return out;
}

/** Custo em US$ de uma linha, ou null quando o modelo não tem preço (não se inventa preço). Modelos datados (gpt-4o-mini-2024...) usam o preço do nome base. */
export function costOf(r: { model: string; inputTokens: number; outputTokens: number }, prices: Record<string, Price>): number | null {
  const key = Object.keys(prices).filter((k) => r.model === k || r.model.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  const p = key && prices[key];
  return p ? (r.inputTokens * p.in + r.outputTokens * p.out) / 1_000_000 : null;
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
  firstDay: string;
  /** Custo estimado só do que tem preço conhecido; o resto fica em `unpricedTokens`. */
  costUsd: number;
  unpricedTokens: number;
  /** Projeção para 30 dias, pelo ritmo desde o primeiro uso (mínimo de 1 dia). */
  monthlyUsd: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1);

/** Agrupa as linhas por usuário (mais consumo primeiro) e soma o total geral. */
export function rollup(rows: UsageRow[], prices: Record<string, Price> = {}, today = ""): { users: UserUsage[]; total: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number }; byDay: { day: string; tokens: number }[] } {
  const users = new Map<string, UserUsage>();
  const days = new Map<string, number>();
  for (const r of rows) {
    const u = users.get(r.userId) ?? { userId: r.userId, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, byProvider: {}, lastDay: "", firstDay: r.day, costUsd: 0, unpricedTokens: 0, monthlyUsd: 0 };
    const t = r.inputTokens + r.outputTokens;
    u.calls += r.calls;
    u.inputTokens += r.inputTokens;
    u.outputTokens += r.outputTokens;
    u.totalTokens += t;
    const p = (u.byProvider[r.provider] ??= { calls: 0, tokens: 0 });
    p.calls += r.calls;
    p.tokens += t;
    if (r.day > u.lastDay) u.lastDay = r.day;
    if (r.day < u.firstDay) u.firstDay = r.day;
    const c = costOf(r, prices);
    if (c === null) u.unpricedTokens += t;
    else u.costUsd += c;
    users.set(r.userId, u);
    days.set(r.day, (days.get(r.day) ?? 0) + t);
  }
  for (const u of users.values()) u.monthlyUsd = (u.costUsd / daysBetween(u.firstDay, today || u.lastDay)) * 30;
  const list = [...users.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  const total = list.reduce((s, u) => ({ calls: s.calls + u.calls, inputTokens: s.inputTokens + u.inputTokens, outputTokens: s.outputTokens + u.outputTokens, totalTokens: s.totalTokens + u.totalTokens }), { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return { users: list, total, byDay: [...days].map(([day, tokens]) => ({ day, tokens })).sort((a, b) => a.day.localeCompare(b.day)) };
}
