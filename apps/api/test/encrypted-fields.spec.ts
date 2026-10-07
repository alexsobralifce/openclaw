import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const messages: any[] = [];
  const memories: any[] = [];
  const notes: any[] = [];
  const startsWithAny = (v: string, ps: string[]) => ps.some((p) => v.startsWith(p));
  // O backfill filtra com AND[NOT startsWith chat1:, NOT startsWith chat2:] sobre um campo
  const unsealed = (where: any, field: string) => (r: any) => !startsWithAny(r[field], ["chat1:", "chat2:"]) || !where?.AND;
  return {
    messages, memories, notes,
    message: {
      create: vi.fn(async ({ data }: any) => { const r = { id: `m${messages.length + 1}`, type: "TEXT", createdAt: new Date(), ...data }; messages.push(r); return r; }),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where, take }: any) => messages.filter(unsealed(where, "body")).slice(0, take).map((m) => ({ ...m, conversation: { workspaceId: m.ws } }))),
      updateMany: vi.fn(async ({ where, data }: any) => { const r = messages.find((m) => m.id === where.id && m.body === where.body); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
    },
    memory: {
      findMany: vi.fn(async ({ where, take }: any) => memories.filter((m) => (where.kind?.not ? m.kind !== where.kind.not : where.kind ? m.kind === where.kind : true) && (!where.AND || unsealed(where, "content")(m))).slice(0, take ?? 1000)),
      count: vi.fn(async () => memories.length),
      findFirst: vi.fn(async () => null),
      delete: vi.fn(),
      create: vi.fn(async ({ data }: any) => { const r = { id: `k${memories.length + 1}`, createdAt: new Date(), ...data }; memories.push(r); return r; }),
      updateMany: vi.fn(async ({ where, data }: any) => { const r = memories.find((m) => m.id === where.id && (where.content === undefined || m.content === where.content)); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
    },
    listNote: {
      findMany: vi.fn(async ({ where, take }: any) => notes.filter(unsealed(where, "title")).slice(0, take)),
      updateMany: vi.fn(async ({ where, data }: any) => { const r = notes.find((n) => n.id === where.id && n.title === where.title); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
    },
    conversation: { update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => ({ id: "c1" })), findFirstOrThrow: vi.fn(), create: vi.fn() },
    contact: { findUnique: vi.fn(async () => ({ id: "p1", name: "Ana", phone: "5585" })), create: vi.fn() },
  };
});
vi.mock("@openclaw/database", () => ({ prisma: db }));
process.env.WEBHOOK_SECRET = "segredo-de-teste-campos";

import { InboxService } from "../src/modules/inbox/inbox.service";
import { EncryptionBackfillService } from "../src/modules/inbox/encryption-backfill.service";
import { MemoryService } from "../src/modules/channels/assistant/memory.service";
import { openField, sealField } from "../src/modules/webhooks/crypto";
import { openNoteRow } from "../src/modules/channels/assistant/list-notes-store";

const gateway = { emitNewMessage: vi.fn() };
const webhooks = { emit: vi.fn() };

beforeEach(() => {
  db.messages.length = 0; db.memories.length = 0; db.notes.length = 0;
  vi.clearAllMocks();
});

describe("mensagens do inbox cifradas", () => {
  const svc = new InboxService(gateway as any, webhooks as any);

  it("recebida: grava cifrada, mas painel e webhooks recebem o texto aberto", async () => {
    const r: any = await svc.processIncoming({ workspaceId: "w1", channelId: "ch", from: "5585", body: "meu CPF é 123", type: "TEXT" } as any);
    expect(db.messages[0].body).toMatch(/^chat2:/);
    expect(JSON.stringify(db.messages[0])).not.toContain("123");
    expect(r.message.body).toBe("meu CPF é 123");
    expect(gateway.emitNewMessage).toHaveBeenCalledWith("w1", expect.objectContaining({ message: expect.objectContaining({ body: "meu CPF é 123" }) }));
    expect(webhooks.emit).toHaveBeenCalledWith("w1", "message.received", expect.objectContaining({ message: expect.objectContaining({ body: "meu CPF é 123" }) }));
  });

  it("enviada: idem", async () => {
    await svc.recordOutbound("w1", "c1", "olá, tudo bem?");
    expect(db.messages[0].body).toMatch(/^chat2:/);
    expect(gateway.emitNewMessage).toHaveBeenCalledWith("w1", expect.objectContaining({ message: expect.objectContaining({ body: "olá, tudo bem?" }) }));
  });

  it("leitura abre as cifradas e deixa passar as antigas em texto puro", async () => {
    db.conversation.findFirstOrThrow.mockResolvedValue({ id: "c1", messages: [{ id: "a", body: sealField("nova", "w1") }, { id: "b", body: "antiga" }] });
    const c = await svc.getConversation("w1", "c1");
    expect(c.messages.map((m: any) => m.body)).toEqual(["nova", "antiga"]);
    db.conversation.findMany.mockResolvedValue([{ id: "c1", messages: [{ id: "a", body: sealField("última", "w1") }] }]);
    expect((await svc.listConversations("w1"))[0].messages[0].body).toBe("última");
  });

  it("chave de outro workspace não abre", () => {
    expect(openField(sealField("segredo", "w1"), "w2")).not.toBe("segredo");
  });
});

describe("memórias cifradas", () => {
  const mem = new MemoryService();

  it("grava cifrada, lista aberta e não duplica", async () => {
    const a = await mem.add("w1", "gosto de café sem açúcar");
    expect(a.content).toBe("gosto de café sem açúcar");
    expect(db.memories[0].content).toMatch(/^chat2:/);
    await mem.add("w1", "gosto de café sem açúcar");
    expect(db.memories).toHaveLength(1);
    expect((await mem.list("w1")).map((m) => m.content)).toEqual(["gosto de café sem açúcar"]);
    expect(await mem.promptBlock("w1")).toContain("gosto de café sem açúcar");
  });

  it("rotina: cifrada no banco, aberta ao listar, e troca o item do mesmo tema", async () => {
    await mem.setRoutine("w1", { topic: "Academia", description: "treino de perna", days: [1, 3] } as any);
    expect(db.memories[0].content).toMatch(/^chat2:/);
    expect((await mem.listRoutine("w1"))[0]).toMatchObject({ topic: "Academia", description: "treino de perna" });
    expect((await mem.setRoutine("w1", { topic: "Academia", description: "natação", days: [2] } as any)).updated).toBe(true);
    expect((await mem.listRoutine("w1"))[0].description).toBe("natação");
  });
});

describe("cifra dos registros antigos (backfill)", () => {
  it("cifra mensagens, memórias e notas em texto puro, uma vez só", async () => {
    db.messages.push({ id: "m1", ws: "w1", body: "antiga 1" }, { id: "m2", ws: "w2", body: sealField("já cifrada", "w2") });
    db.memories.push({ id: "k1", workspaceId: "w1", kind: "fact", content: "fato antigo" });
    db.notes.push({ id: "n1", workspaceId: "w1", title: "Mercado", items: [{ text: "leite", done: false }] });
    const svc = new EncryptionBackfillService();
    expect(await svc.run()).toEqual({ mensagens: 1, memorias: 1, notas: 1 });
    expect(openField(db.messages[0].body, "w1")).toBe("antiga 1");
    expect(db.messages[0].body).toMatch(/^chat2:/);
    expect(openField(db.memories[0].content, "w1")).toBe("fato antigo");
    expect(openNoteRow(db.notes[0])).toMatchObject({ title: "Mercado", items: [{ text: "leite", done: false }] });
    expect(typeof db.notes[0].items).toBe("string");
    expect(await svc.run()).toEqual({ mensagens: 0, memorias: 0, notas: 0 });
  });
});
