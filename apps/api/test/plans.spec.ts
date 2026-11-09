import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upsert: vi.fn(async (_a: any) => ({})),
  findMany: vi.fn(async () => [] as any[]),
  ownerFind: vi.fn(async (_a: any) => ({ userId: "dono1", user: { role: "USER", plan: "aprendiz" } }) as any),
  userFind: vi.fn(async (_a: any) => ({ id: "u1", email: "a@b.c", role: "USER", status: "ACTIVE" }) as any),
  userUpdate: vi.fn(async (a: any) => ({ id: "u1", name: "Ana", email: "a@b.c", role: "USER", status: "ACTIVE", services: a.data.services ?? [], plan: a.data.plan ?? null, workspaces: [] })),
}));
vi.mock("@magobox/database", () => ({
  prisma: {
    aiUsage: { upsert: (a: any) => h.upsert(a), findMany: () => h.findMany() },
    workspaceMember: { findFirst: (a: any) => h.ownerFind(a), count: async () => 1 },
    user: { findUnique: (a: any) => h.userFind(a), update: (a: any) => h.userUpdate(a), findFirst: async () => null },
  },
}));

import { ALL_SERVICES } from "../src/modules/auth/permissions";
import { PLAN_IDS, PLANS, isPlan, planOf } from "../src/modules/auth/plans";
import { maxAudioSeconds, maxPdfPages } from "../src/modules/channels/assistant/media-limits";
import { assertQuota, QuotaExceededError, recordUsage, resetOwnerCache, resetQuotaCache, runAs } from "../src/modules/channels/assistant/usage";
import { GoogleService } from "../src/modules/integrations/google/google.service";
import { UsersService } from "../src/modules/users/users.service";
import { IntentService } from "../src/modules/channels/assistant/intent.service";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("planos", () => {
  it("quatro planos, com serviços válidos e cada plano pago incluindo os do anterior", () => {
    expect(PLAN_IDS).toEqual(["teste", "aprendiz", "mago", "arquimago"]);
    for (const p of Object.values(PLANS)) expect(p.services.every((s) => ALL_SERVICES.includes(s))).toBe(true);
    expect(PLANS.mago.services).toEqual(expect.arrayContaining(PLANS.aprendiz.services));
    expect(PLANS.arquimago.services).toEqual(expect.arrayContaining(PLANS.mago.services));
    expect(PLANS.arquimago.services).toEqual(expect.arrayContaining(["inbox", "automations", "api", "vault"]));
    expect(PLANS.aprendiz.services).not.toContain("vault");
  });

  it("o teto de IA de cada plano pago respeita a regra de margem: teto (R$ a 5,50) ≤ 0,6 × preço − 2", () => {
    for (const id of ["aprendiz", "mago", "arquimago"]) {
      const p = PLANS[id];
      expect(p.aiUsd * 5.5).toBeLessThanOrEqual(0.6 * p.priceBrl - 2 + 1e-9);
    }
    expect(PLANS.teste.aiUsd).toBe(0.4);
  });

  it("os limites crescem com o plano", () => {
    const [a, m, x] = [PLANS.aprendiz, PLANS.mago, PLANS.arquimago];
    expect([a.aiUsd, m.aiUsd, x.aiUsd]).toEqual([0.7, 2.5, 6]);
    expect(a.googleAccounts < m.googleAccounts && m.googleAccounts < x.googleAccounts).toBe(true);
    expect(a.pdfPages < m.pdfPages && m.pdfPages < x.pdfPages).toBe(true);
    expect(a.audioSeconds < m.audioSeconds && m.audioSeconds < x.audioSeconds).toBe(true);
  });

  it("planOf ignora plano inexistente; limites de PDF e áudio seguem o plano, sem plano seguem o ambiente", () => {
    expect(isPlan("mago")).toBe(true);
    expect(isPlan("toString")).toBe(false);
    expect(planOf("xyz")).toBeNull();
    expect(maxPdfPages(planOf("aprendiz"))).toBe(15);
    expect(maxAudioSeconds(planOf("mago"))).toBe(180);
    expect(maxPdfPages(null)).toBe(80);
    expect(maxAudioSeconds(undefined)).toBe(300);
  });
});

describe("limite de IA do plano", () => {
  beforeEach(() => {
    resetQuotaCache();
    process.env.AI_PRICES = '{"gemini-x":{"in":0.75,"out":3.75}}';
    delete process.env.AI_MONTHLY_USD_LIMIT;
  });

  it("o teto do plano vale mesmo sem limite geral no ambiente", async () => {
    h.findMany.mockResolvedValueOnce([{ model: "gemini-x", inputTokens: 1_000_000, outputTokens: 0 }]); // US$ 0,75
    await runAs({ userId: "u1", limitUsd: PLANS.aprendiz.aiUsd }, async () => {
      await expect(assertQuota()).rejects.toBeInstanceOf(QuotaExceededError);
    });
    resetQuotaCache();
    h.findMany.mockResolvedValueOnce([{ model: "gemini-x", inputTokens: 1_000_000, outputTokens: 0 }]);
    await runAs({ userId: "u2", limitUsd: PLANS.mago.aiUsd }, () => expect(assertQuota()).resolves.toBeUndefined());
  });

  it("o teto do plano tem prioridade sobre o limite geral do ambiente", async () => {
    process.env.AI_MONTHLY_USD_LIMIT = "100";
    h.findMany.mockResolvedValueOnce([{ model: "gemini-x", inputTokens: 1_000_000, outputTokens: 0 }]);
    await runAs({ userId: "u1", limitUsd: 0.5 }, () => expect(assertQuota()).rejects.toBeInstanceOf(QuotaExceededError));
  });
});

describe("consumo atribuído ao dono (rotinas automáticas) e ao Jev", () => {
  beforeEach(() => {
    h.upsert.mockClear();
    h.ownerFind.mockClear();
    resetOwnerCache();
  });

  it("sem usuário no contexto, a chamada de um workspace conta para o dono dele", async () => {
    recordUsage("openai", "gpt-4o-mini", { input: 10, output: 5 }, "wsA");
    await flush();
    expect(h.upsert.mock.calls[0][0].create).toMatchObject({ userId: "dono1", workspaceId: "wsA" });
    recordUsage("openai", "gpt-4o-mini", { input: 10, output: 5 }, "wsA");
    await flush();
    expect(h.ownerFind).toHaveBeenCalledTimes(1); // o dono fica em cache
  });

  it("sem workspace, ou sem dono, continua em 'sistema'", async () => {
    recordUsage("openai", "m", { input: 1, output: 1 });
    await flush();
    expect(h.upsert.mock.calls[0][0].create.userId).toBe("sistema");
    h.ownerFind.mockResolvedValueOnce(null);
    recordUsage("openai", "m", { input: 1, output: 1 }, "wsSemDono");
    await flush();
    expect(h.upsert.mock.calls[1][0].create.userId).toBe("sistema");
  });

  it("o usuário do contexto vale mais que o dono", async () => {
    runAs({ userId: "outro", workspaceId: "wsA" }, () => recordUsage("openai", "m", { input: 1, output: 1 }));
    await flush();
    expect(h.upsert.mock.calls[0][0].create.userId).toBe("outro");
    expect(h.ownerFind).not.toHaveBeenCalled();
  });

  it("cada chamada ao Jev é contada, com os tokens que o SDK informa (classificar intenção e escolher assuntos)", async () => {
    process.env.TYPESAFE_API_KEY = "k";
    const svc = new IntentService();
    (svc as any).client = { systemOne: vi.fn(async () => ({ model: "jev-1", answers: { intent: { choice: "other", confidence: 0.9 }, email: { noul: 0.9 }, agenda: { noul: 0.1 } }, usage: { input_tokens: 120, output_tokens: 8 } })) };
    await runAs({ userId: "u9", workspaceId: "w" }, async () => {
      await svc.classify("quero ver meus emails de hoje");
      await svc.toolDomains("quero ver meus emails de hoje");
    });
    await flush();
    const rows = h.upsert.mock.calls.map((c) => c[0].create);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: "u9", provider: "jev", model: "jev-1", inputTokens: 120, outputTokens: 8 });
    delete process.env.TYPESAFE_API_KEY;
  });
});

describe("limite de contas Google do plano", () => {
  const svc = (accounts: string[]) => {
    const g = Object.create(GoogleService.prototype) as any;
    g.listAccounts = async () => accounts;
    return g as { assertAccountLimit: (ws: string) => Promise<void> };
  };

  it("Aprendiz com 1 conta conectada não conecta a segunda, e a mensagem diz o motivo", async () => {
    h.ownerFind.mockResolvedValueOnce({ user: { role: "USER", plan: "aprendiz" } });
    await expect(svc(["a@gmail.com"]).assertAccountLimit("w")).rejects.toThrow("O plano Aprendiz permite 1 conta Google");
  });

  it("Mago com 2 contas conecta a terceira; com 3 não conecta a quarta", async () => {
    h.ownerFind.mockResolvedValueOnce({ user: { role: "USER", plan: "mago" } });
    await expect(svc(["a", "b"]).assertAccountLimit("w")).resolves.toBeUndefined();
    h.ownerFind.mockResolvedValueOnce({ user: { role: "USER", plan: "mago" } });
    await expect(svc(["a", "b", "c"]).assertAccountLimit("w")).rejects.toThrow("3 contas Google");
  });

  it("sem plano, ou root/admin, sem limite", async () => {
    h.ownerFind.mockResolvedValueOnce({ user: { role: "USER", plan: null } });
    await expect(svc(["a", "b", "c", "d", "e"]).assertAccountLimit("w")).resolves.toBeUndefined();
    h.ownerFind.mockResolvedValueOnce({ user: { role: "ADMIN", plan: "aprendiz" } });
    await expect(svc(["a", "b"]).assertAccountLimit("w")).resolves.toBeUndefined();
  });
});

describe("admin escolhe o plano do usuário", () => {
  const users = () => new UsersService({} as any);
  beforeEach(() => {
    h.userUpdate.mockClear();
  });

  it("escolher o plano libera os serviços dele", async () => {
    await users().update("admin", "ROOT", "u1", { plan: "mago" });
    const data = h.userUpdate.mock.calls[0][0].data;
    expect(data.plan).toBe("mago");
    expect([...data.services].sort()).toEqual([...PLANS.mago.services].sort());
  });

  it("serviços enviados junto com o plano valem (o admin ajustou na tela)", async () => {
    await users().update("admin", "ROOT", "u1", { plan: "mago", services: ["assistant", "email"] });
    expect(h.userUpdate.mock.calls[0][0].data.services).toEqual(["assistant", "email"]);
  });

  it("plano vazio tira o plano e não mexe nos serviços; plano inventado é recusado", async () => {
    await users().update("admin", "ROOT", "u1", { plan: "" });
    const data = h.userUpdate.mock.calls[0][0].data;
    expect(data.plan).toBeNull();
    expect(data.services).toBeUndefined();
    await expect(users().update("admin", "ROOT", "u1", { plan: "vip" })).rejects.toThrow("Plano inválido");
  });
});
