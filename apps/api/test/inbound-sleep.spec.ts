import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  createMany: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@magobox/database", () => ({
  prisma: { inboundEvent: db, channel: { findFirst: vi.fn() } },
  Prisma: {},
}));

import { InboundService } from "../src/modules/channels/inbound/inbound.service";

const MIN = 60_000;
const mensagem = { event: "messages.upsert", data: { key: { id: "msg-1" } } };

describe("worker de entrada do WhatsApp dorme quando ocioso", () => {
  let svc: InboundService;

  beforeEach(() => {
    vi.useFakeTimers();
    db.createMany.mockResolvedValue({ count: 1 });
    db.findMany.mockResolvedValue([]);
    db.count.mockResolvedValue(0);
    db.deleteMany.mockResolvedValue({ count: 0 });
    svc = new InboundService({} as any, {} as any, {} as any);
  });

  afterEach(() => {
    svc.onModuleDestroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("não roda timer no boot", () => {
    svc.onModuleInit();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("acorda na primeira mensagem e dorme depois de 5 min sem atividade", async () => {
    svc.onModuleInit();
    await svc.enqueue("instancia", mensagem);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(6 * MIN);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("não dorme enquanto houver evento pendente (retentativa)", async () => {
    db.count.mockResolvedValue(1);
    svc.onModuleInit();
    await svc.enqueue("instancia", mensagem);

    await vi.advanceTimersByTimeAsync(6 * MIN);
    expect(vi.getTimerCount()).toBe(1);
  });
});
