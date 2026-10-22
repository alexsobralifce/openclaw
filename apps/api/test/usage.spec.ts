
describe("limite mensal por usuário", async () => {
  const { assertQuota, QuotaExceededError, quotaHit, monthlyLimit, resetQuotaCache } = await import("../src/modules/channels/assistant/usage");
  const agg = vi.fn();
  (await import("@openclaw/database")).prisma.aiUsage.aggregate = agg as any;
  const setup = (used: number, limit: string | undefined) => {
    resetQuotaCache();
    agg.mockReset();
    agg.mockResolvedValue({ _sum: { inputTokens: used, outputTokens: 0 } });
    if (limit === undefined) delete process.env.AI_MONTHLY_TOKEN_LIMIT;
    else process.env.AI_MONTHLY_TOKEN_LIMIT = limit;
  };

  it("sem limite configurado nada é barrado (e nem consulta o banco)", async () => {
    setup(999_999_999, undefined);
    await runAs({ userId: "u1" }, () => expect(assertQuota()).resolves.toBeUndefined());
    expect(agg).not.toHaveBeenCalled();
    expect(monthlyLimit()).toBe(0);
  });

  it("passou do limite: barra e marca o fluxo para o aviso", async () => {
    setup(1000, "1000");
    await runAs({ userId: "u1" }, async () => {
      await expect(assertQuota()).rejects.toBeInstanceOf(QuotaExceededError);
      expect(quotaHit()).toBe(true);
    });
  });

  it("abaixo do limite passa; root/admin (isento) e rotinas sem usuário nunca são barrados", async () => {
    setup(10, "1000");
    await runAs({ userId: "u1" }, async () => {
      await assertQuota();
      expect(quotaHit()).toBe(false);
    });
    setup(5000, "1000");
    await runAs({ userId: "root", exempt: true }, () => expect(assertQuota()).resolves.toBeUndefined());
    await expect(assertQuota()).resolves.toBeUndefined();
  });

  it("o que acabou de ser gasto conta na hora, sem esperar o cache", async () => {
    setup(900, "1000");
    await runAs({ userId: "u2" }, async () => {
      await assertQuota();
      recordUsage("openai", "m", { input: 80, output: 30 });
      await expect(assertQuota()).rejects.toBeInstanceOf(QuotaExceededError);
    });
  });

  it("se o banco falhar na consulta, deixa passar", async () => {
    setup(0, "1000");
    agg.mockRejectedValue(new Error("banco fora"));
    await runAs({ userId: "u3" }, () => expect(assertQuota()).resolves.toBeUndefined());
  });
});
