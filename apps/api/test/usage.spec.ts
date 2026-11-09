import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ upsert: vi.fn(async (_a: any) => ({})) }));
vi.mock("@magobox/database", () => ({ prisma: { aiUsage: { upsert: (a: any) => h.upsert(a) } } }));

import { costOf, geminiTokens, loadPrices, openaiTokens, recordUsage, rollup, runAs, SYSTEM_USER } from "../src/modules/channels/assistant/usage";

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

  it("custo: preço por milhão de tokens, modelo datado usa o nome base, sem preço = null", () => {
    const prices = loadPrices();
    expect(costOf({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 1_000_000 }, prices)).toBeCloseTo(0.75, 6);
    expect(costOf({ model: "gpt-4o-mini-2024-07-18", inputTokens: 2_000_000, outputTokens: 0 }, prices)).toBeCloseTo(0.3, 6);
    expect(costOf({ model: "gemini-x", inputTokens: 10, outputTokens: 10 }, prices)).toBeNull();
  });

  it("AI_PRICES acrescenta modelos; JSON inválido ou preço negativo é ignorado", () => {
    const p = loadPrices('{"gemini-x":{"in":0.1,"out":0.4},"ruim":{"in":-1,"out":1}}');
    expect(p["gemini-x"]).toEqual({ in: 0.1, out: 0.4 });
    expect(p["ruim"]).toBeUndefined();
    expect(Object.keys(loadPrices("{lixo"))).toEqual(["gpt-4o-mini"]);
  });

  it("rollup: custo por usuário, tokens sem preço à parte e projeção de 30 dias pelo ritmo", () => {
    const prices = loadPrices('{"g":{"in":1,"out":1}}');
    const r = rollup(
      [
        { userId: "a", provider: "openai", model: "gpt-4o-mini", day: "2026-10-01", calls: 1, inputTokens: 1_000_000, outputTokens: 0 },
        { userId: "a", provider: "gemini", model: "g", day: "2026-10-02", calls: 1, inputTokens: 1_000_000, outputTokens: 0 },
        { userId: "a", provider: "gemini", model: "sem-preco", day: "2026-10-02", calls: 1, inputTokens: 500, outputTokens: 0 },
      ],
      prices,
      "2026-10-02",
    );
    const a = r.users[0];
    expect(a.costUsd).toBeCloseTo(1.15, 6);
    expect(a.unpricedTokens).toBe(500);
    // 2 dias de uso (01 e 02): 1,15 / 2 * 30
    expect(a.monthlyUsd).toBeCloseTo(17.25, 6);
  });
});

describe("limite mensal por usuário, em dólar", async () => {
  const { assertQuota, QuotaExceededError, quotaHit, monthlyLimitUsd, resetQuotaCache, limitCost, monthSpend } = await import("../src/modules/channels/assistant/usage");
  const find = vi.fn();
  (await import("@magobox/database")).prisma.aiUsage.findMany = find as any;
  const PRICES = '{"gemini-x":{"in":0.75,"out":3.75}}';
  const setup = (rows: { model: string; inputTokens: number; outputTokens: number }[], limit: string | undefined) => {
    resetQuotaCache();
    find.mockReset();
    find.mockResolvedValue(rows);
    process.env.AI_PRICES = PRICES;
    if (limit === undefined) delete process.env.AI_MONTHLY_USD_LIMIT;
    else process.env.AI_MONTHLY_USD_LIMIT = limit;
  };

  it("sem limite configurado nada é barrado (e nem consulta o banco)", async () => {
    setup([{ model: "gemini-x", inputTokens: 999_000_000, outputTokens: 0 }], undefined);
    await runAs({ userId: "u1" }, () => expect(assertQuota()).resolves.toBeUndefined());
    expect(find).not.toHaveBeenCalled();
    expect(monthlyLimitUsd()).toBe(0);
  });

  it("o mesmo número de tokens pesa diferente: Gemini estoura o limite, gpt-4o-mini não", async () => {
    // 2 milhões de tokens de entrada: Gemini = US$ 1,50; gpt-4o-mini = US$ 0,30. Limite de US$ 1.
    setup([{ model: "gemini-x", inputTokens: 2_000_000, outputTokens: 0 }], "1");
    await runAs({ userId: "u1" }, async () => {
      await expect(assertQuota()).rejects.toBeInstanceOf(QuotaExceededError);
      expect(quotaHit()).toBe(true);
    });
    setup([{ model: "gpt-4o-mini", inputTokens: 2_000_000, outputTokens: 0 }], "1");
    await runAs({ userId: "u2" }, async () => {
      await assertQuota();
      expect(quotaHit()).toBe(false);
    });
  });

  it("a mensagem do limite sai em português, com o valor em dólar", async () => {
    setup([{ model: "gemini-x", inputTokens: 10_000_000, outputTokens: 0 }], "4");
    await runAs({ userId: "u1" }, () => expect(assertQuota()).rejects.toThrow("Limite mensal de uso de IA atingido (US$ 4,00)."));
  });

  it("modelo sem preço não vale zero: usa o maior preço da tabela; sem tabela, zero", () => {
    const prices = loadPrices(PRICES);
    expect(limitCost({ model: "desconhecido", inputTokens: 1_000_000, outputTokens: 1_000_000 }, prices)).toBeCloseTo(4.5, 6);
    expect(limitCost({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 }, prices)).toBeCloseTo(0.15, 6);
    expect(limitCost({ model: "x", inputTokens: 5, outputTokens: 5 }, {})).toBe(0);
  });

  it("root/admin (isento) e rotinas sem usuário nunca são barrados", async () => {
    setup([{ model: "gemini-x", inputTokens: 99_000_000, outputTokens: 0 }], "1");
    await runAs({ userId: "root", exempt: true }, () => expect(assertQuota()).resolves.toBeUndefined());
    await expect(assertQuota()).resolves.toBeUndefined();
  });

  it("o que acabou de ser gasto conta na hora, sem esperar o cache", async () => {
    setup([{ model: "gemini-x", inputTokens: 1_000_000, outputTokens: 0 }], "1");
    await runAs({ userId: "u3" }, async () => {
      await assertQuota(); // US$ 0,75 de US$ 1
      recordUsage("gemini", "gemini-x", { input: 100_000, output: 100_000 }); // + US$ 0,45
      await expect(assertQuota()).rejects.toBeInstanceOf(QuotaExceededError);
    });
  });

  it("se o banco falhar na consulta, deixa passar", async () => {
    setup([], "1");
    find.mockRejectedValue(new Error("banco fora"));
    await runAs({ userId: "u4" }, () => expect(assertQuota()).resolves.toBeUndefined());
  });

  it("monthSpend soma o gasto do mês por usuário", () => {
    const m = monthSpend(
      [
        { userId: "a", provider: "g", model: "gemini-x", day: "2026-10-01", calls: 1, inputTokens: 1_000_000, outputTokens: 0 },
        { userId: "a", provider: "o", model: "gpt-4o-mini", day: "2026-10-02", calls: 1, inputTokens: 1_000_000, outputTokens: 0 },
        { userId: "b", provider: "o", model: "gpt-4o-mini", day: "2026-10-02", calls: 1, inputTokens: 0, outputTokens: 1_000_000 },
      ],
      loadPrices(PRICES),
    );
    expect(m.get("a")).toBeCloseTo(0.9, 6);
    expect(m.get("b")).toBeCloseTo(0.6, 6);
  });
});
