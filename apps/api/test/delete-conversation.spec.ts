import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: { findFirstOrThrow: vi.fn(), delete: vi.fn(), count: vi.fn() },
  contact: { delete: vi.fn() },
}));
vi.mock("@magobox/database", () => ({ prisma: db }));

import { InboxService } from "../src/modules/inbox/inbox.service";

const gateway = { emitConversationDeleted: vi.fn() };
const webhooks = { emit: vi.fn() };
const svc = new InboxService(gateway as any, webhooks as any);

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findFirstOrThrow.mockResolvedValue({ id: "c1", contactId: "p1" });
});

describe("excluir conversa", () => {
  it("só procura a conversa dentro do workspace informado", async () => {
    await svc.deleteConversation("w1", "c1");
    expect(db.conversation.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", workspaceId: "w1" } }));
    expect(db.conversation.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("outra conversa de outro workspace não é apagada (a busca falha antes)", async () => {
    db.conversation.findFirstOrThrow.mockRejectedValue(new Error("not found"));
    await expect(svc.deleteConversation("w2", "c1")).rejects.toThrow("not found");
    expect(db.conversation.delete).not.toHaveBeenCalled();
  });

  it("mantém o contato por padrão e avisa a tela e os webhooks", async () => {
    const r = await svc.deleteConversation("w1", "c1");
    expect(r).toEqual({ ok: true, contactDeleted: false });
    expect(db.contact.delete).not.toHaveBeenCalled();
    expect(gateway.emitConversationDeleted).toHaveBeenCalledWith("w1", { conversationId: "c1" });
    expect(webhooks.emit).toHaveBeenCalledWith("w1", "conversation.deleted", { conversationId: "c1", contactId: "p1", contactDeleted: false });
  });

  it("com deleteContact apaga o contato quando não sobra conversa", async () => {
    db.conversation.count.mockResolvedValue(0);
    const r = await svc.deleteConversation("w1", "c1", true);
    expect(r.contactDeleted).toBe(true);
    expect(db.contact.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("com deleteContact NÃO apaga o contato se ele ainda tem outra conversa", async () => {
    db.conversation.count.mockResolvedValue(2);
    const r = await svc.deleteConversation("w1", "c1", true);
    expect(r.contactDeleted).toBe(false);
    expect(db.contact.delete).not.toHaveBeenCalled();
  });
});
