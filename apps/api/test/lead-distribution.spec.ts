import { beforeEach, describe, expect, it, vi } from "vitest";

// Estado em memória simulando o Postgres: config do canal e atribuições de leads
const db = vi.hoisted(() => ({ config: {} as any, assignments: [] as any[] }));
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => []),
  channel: {
    findUnique: vi.fn(async () => ({ config: db.config })),
    update: vi.fn(async ({ data }: any) => {
      db.config = data.config;
      return {};
    }),
  },
  leadAssignment: {
    findFirst: vi.fn(async ({ where }: any) =>
      db.assignments.filter((a) => a.channelId === where.channelId && a.contactPhone === where.contactPhone).slice(-1)[0] ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      db.assignments.push({ ...data });
      return data;
    }),
  },
}));

vi.mock("@openclaw/database", () => ({
  prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) },
}));

import { LeadDistributionService, readDistribution } from "../src/modules/channels/inbound/lead-distribution.service";

const S1 = "5585911110001";
const S2 = "5585911110002";
const S3 = "5585911110003";

function setup(sellers = [S1, S2], enabled = true) {
  db.config = {
    instanceName: "oc_test",
    distribution: { enabled, sellers: sellers.map((p, i) => ({ name: `V${i + 1}`, phone: p })), cursor: 0 },
  };
  db.assignments = [];
  vi.clearAllMocks();
}

const channel = () => ({ id: "ch1", workspaceId: "ws1", config: db.config });
const msg = (phone: string, name = "Cliente") => ({ contact: { name, phone }, message: { body: "oi" } });

describe("readDistribution", () => {
  it("tolera configuração ausente ou malformada", () => {
    expect(readDistribution(undefined)).toEqual({ enabled: false, sellers: [], cursor: 0 });
    expect(readDistribution({ distribution: { enabled: "sim", sellers: "x", cursor: -3 } })).toEqual({ enabled: false, sellers: [], cursor: 0 });
  });
});

describe("LeadDistributionService", () => {
  let evo: { sendText: ReturnType<typeof vi.fn> };
  let svc: LeadDistributionService;

  beforeEach(() => {
    evo = { sendText: vi.fn(async () => ({})) };
    svc = new LeadDistributionService(evo as any);
  });

  it("distribui em rodízio, um cliente novo por vez (1-2-1)", async () => {
    setup([S1, S2]);
    await svc.distribute(channel(), msg("5585999990001", "A"));
    await svc.distribute(channel(), msg("5585999990002", "B"));
    await svc.distribute(channel(), msg("5585999990003", "C"));
    expect(evo.sendText.mock.calls.map((c) => c[1])).toEqual([S1, S2, S1]);
    expect(db.config.distribution.cursor).toBe(3);
  });

  it("cliente já atribuído continua com o mesmo vendedor e não avança o rodízio", async () => {
    setup([S1, S2]);
    await svc.distribute(channel(), msg("5585999990001", "A"));
    await svc.distribute(channel(), msg("5585999990001", "A"));
    expect(evo.sendText.mock.calls.map((c) => c[1])).toEqual([S1, S1]);
    expect(db.assignments).toHaveLength(1);
    expect(db.config.distribution.cursor).toBe(1);
  });

  it("envia o texto com nome, telefone, link wa.me e a mensagem", async () => {
    setup([S1]);
    await svc.distribute(channel(), msg("5585999990001", "Ana"));
    const text: string = evo.sendText.mock.calls[0][2];
    expect(text).toContain("Nome: Ana");
    expect(text).toContain("Telefone: 5585999990001");
    expect(text).toContain("https://wa.me/5585999990001");
    expect(text).toContain("Mensagem: oi");
  });

  it("falha de envio não atribui o cliente nem avança o rodízio", async () => {
    setup([S1, S2]);
    evo.sendText.mockRejectedValueOnce(new Error("instância desconectada"));
    await expect(svc.distribute(channel(), msg("5585999990001"))).resolves.toBeUndefined();
    expect(db.assignments).toHaveLength(0);
    expect(db.config.distribution.cursor).toBe(0);
  });

  it("não faz nada com recurso desligado, sem vendedores ou sem telefone do cliente", async () => {
    setup([S1, S2], false);
    await svc.distribute(channel(), msg("5585999990001"));
    setup([]);
    await svc.distribute(channel(), msg("5585999990001"));
    setup([S1]);
    await svc.distribute(channel(), msg(null as any));
    expect(evo.sendText).not.toHaveBeenCalled();
  });

  it("mensagem vinda de um vendedor não é distribuída", async () => {
    setup([S1, S2]);
    await svc.distribute(channel(), msg(S1, "Vendedor"));
    expect(evo.sendText).not.toHaveBeenCalled();
  });

  it("vendedor removido da lista: cliente recebe outro vendedor pelo rodízio", async () => {
    setup([S1, S2, S3]);
    await svc.distribute(channel(), msg("5585999990001"));
    setup([S2, S3]);
    db.assignments = [{ workspaceId: "ws1", channelId: "ch1", contactPhone: "5585999990001", sellerPhone: S1 }];
    await svc.distribute(channel(), msg("5585999990001"));
    expect(evo.sendText.mock.calls.at(-1)[1]).not.toBe(S1);
  });
});
