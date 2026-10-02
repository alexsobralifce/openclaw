import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ upsert: vi.fn(async (_a: any) => ({})) }));
vi.mock("@openclaw/database", () => ({ prisma: { aiUsage: { upsert: (a: any) => h.upsert(a) } } }));

import { geminiTokens, openaiTokens, recordUsage, rollup, runAs, SYSTEM_USER } from "../src/modules/channels/assistant/usage";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("contador de tokens", () => {
  it("lê os tokens da OpenAI e do Gemini (pensamento conta como saída; lixo vira zero)", () => {
    expect(openaiTokens({ usage: { prompt_tokens: 120, completion_tokens: 30 } })).toEqual({ input: 120, output: 30 });
    expect(geminiTokens({ usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 200 } })).toEqual({ input: 1000, output: 250 });
    expect(openaiTokens({})).toEqual({ input: 0, output: 0 });
    expect(geminiTokens({ usageMetadata: { promptTokenCount: "x", candidatesTokenCount: -5 } })).toEqual({ input: 0, output: 0 });
  });

  it("registra no usuário do contexto, somando ao contador do dia", async () => {
    h.upsert.mockClear();
    runAs({ userId: "u1", workspaceId: "w1" }, () => recordUsage("openai", "gpt-4o-mini", { input: 10, output: 5 }, undefined, new Date("2026-10-02T15:00:00Z")));
    await flush();
    const a = h.upsert.mock.calls[0][0];
    expect(a.where).toEqual({ userId_day_provider_model: { userId: "u1", day: "2026-10-02", provider: "openai", model: "gpt-4o-mini" } });
    expect(a.create).toMatchObject({ workspaceId: "w1", calls: 1, inputTokens: 10, outputTokens: 5 });
    expect(a.update).toEqual({ calls: { increment: 1 }, inputTokens: { increment: 10 }, outputTokens: { increment: 5 } });
  });

  it("sem contexto vai para 'sistema' (com o workspace informado); o dia vira no fuso, não no UTC", async () => {
    h.upsert.mockClear();
    recordUsage("gemini", "m", { input: 1, output: 1 }, "w9", new Date("2026-10-03T01:00:00Z"));
    await flush();
    const a = h.upsert.mock.calls[0][0];
    expect(a.create).toMatchObject({ userId: SYSTEM_USER, workspaceId: "w9", day: "2026-10-02" });
  });

  it("falha do banco nunca derruba quem chamou", async () => {
    h.upsert.mockRejectedValueOnce(new Error("tabela não existe"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => recordUsage("openai", "m", { input: 1, output: 1 })).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rollup agrupa por usuário, ordena pelo maior consumo e soma o total", () => {
    const r = rollup([
      { userId: "a", provider: "openai", model: "x", day: "2026-10-01", calls: 2, inputTokens: 100, outputTokens: 20 },
      { userId: "a", provider: "gemini", model: "y", day: "2026-10-02", calls: 1, inputTokens: 500, outputTokens: 50 },
      { userId: "b", provider: "openai", model: "x", day: "2026-10-02", calls: 9, inputTokens: 1000, outputTokens: 1000 },
    ]);
    expect(r.users.map((u) => u.userId)).toEqual(["b", "a"]);
    expect(r.users[1]).toMatchObject({ calls: 3, totalTokens: 670, lastDay: "2026-10-02", byProvider: { openai: { calls: 2, tokens: 120 }, gemini: { calls: 1, tokens: 550 } } });
    expect(r.total).toEqual({ calls: 12, inputTokens: 1600, outputTokens: 1070, totalTokens: 2670 });
    expect(r.byDay).toEqual([{ day: "2026-10-01", tokens: 120 }, { day: "2026-10-02", tokens: 2550 }]);
  });
});
