import { Injectable } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { InboxGateway } from "./inbox.gateway";
import { WebhooksService } from "../webhooks/webhooks.service";
import { openField, sealField } from "../webhooks/crypto";
import type { IncomingMessage } from "@magobox/types";

@Injectable()
export class InboxService {
  constructor(
    private gateway: InboxGateway,
    private webhooks: WebhooksService,
  ) {}

  async listConversations(workspaceId: string, status?: string) {
    const rows = await prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        contact: true,
        channel: true,
        assignees: { include: { user: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((c) => ({ ...c, messages: openBodies(c.messages, workspaceId) }));
  }

  async getConversation(workspaceId: string, id: string) {
    const c = await prisma.conversation.findFirstOrThrow({
      where: { id, workspaceId },
      include: {
        contact: true,
        channel: true,
        assignees: { include: { user: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    return { ...c, messages: openBodies(c.messages, workspaceId) };
  }

  async updateStatus(workspaceId: string, id: string, status: string) {
    const conversation = await prisma.conversation.update({
      where: { id, workspaceId },
      data: { status: status as any },
      include: { assignees: true },
    });
    this.gateway.emitConversationUpdated(workspaceId, {
      conversationId: id,
      status: conversation.status,
      assigneeIds: conversation.assignees.map((a) => a.userId),
    });
    this.webhooks.emit(workspaceId, "conversation.status_changed", { conversationId: id, status: conversation.status });
    return conversation;
  }

  /**
   * Apaga a conversa com todas as mensagens (e os responsáveis, em cascata). Com `deleteContact`, apaga também o
   * contato quando ele não tiver mais nenhuma conversa: é o que atende a um pedido de exclusão de dados.
   */
  async deleteConversation(workspaceId: string, id: string, deleteContact = false) {
    const conv = await prisma.conversation.findFirstOrThrow({ where: { id, workspaceId }, select: { id: true, contactId: true } });
    await prisma.conversation.delete({ where: { id: conv.id } });

    let contactDeleted = false;
    if (deleteContact) {
      const left = await prisma.conversation.count({ where: { contactId: conv.contactId } });
      if (!left) {
        await prisma.contact.delete({ where: { id: conv.contactId } });
        contactDeleted = true;
      }
    }

    this.gateway.emitConversationDeleted(workspaceId, { conversationId: id });
    this.webhooks.emit(workspaceId, "conversation.deleted", { conversationId: id, contactId: conv.contactId, contactDeleted });
    return { ok: true, contactDeleted };
  }

  /**
   * Grava uma mensagem recebida. Idempotente: se o canal reentregar a mesma mensagem (mesmo externalId),
   * devolve null sem duplicar nada.
   */
  async processIncoming(msg: IncomingMessage) {
    if (msg.externalId) {
      const dup = await prisma.message.findFirst({
        where: { externalId: msg.externalId, conversation: { channelId: msg.channelId } },
        select: { id: true },
      });
      if (dup) return null;
    }

    const { contact, created: newContact } = await this.findOrCreateContact(msg);
    if (newContact) this.webhooks.emit(msg.workspaceId, "contact.created", { contact });

    let conversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: msg.workspaceId,
        contactId: contact.id,
        channelId: msg.channelId,
        status: "OPEN",
      },
    });

    const newConversation = !conversation;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          workspaceId: msg.workspaceId,
          contactId: contact.id,
          channelId: msg.channelId,
        },
      });
      this.webhooks.emit(msg.workspaceId, "conversation.created", { conversation });
    }

    const stored = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        body: sealField(msg.body, msg.workspaceId),
        type: msg.type,
        direction: "INBOUND",
        externalId: msg.externalId,
        ...(msg.metadata && Object.keys(msg.metadata).length ? { metadata: msg.metadata as any } : {}),
      },
    });
    const message = { ...stored, body: msg.body };
    // Mantém a conversa no topo da lista
    await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    this.webhooks.emit(msg.workspaceId, "message.received", {
      conversationId: conversation.id,
      contactId: contact.id,
      message: { id: message.id, body: message.body, type: message.type, direction: message.direction, createdAt: message.createdAt },
    });

    this.gateway.emitNewMessage(msg.workspaceId, {
      conversationId: conversation.id,
      message: {
        id: message.id,
        body: message.body,
        type: message.type,
        direction: message.direction,
        createdAt: message.createdAt.toISOString(),
        authorId: null,
      },
    });

    return { conversation, message, contact, newContact, newConversation };
  }

  /** Registra uma mensagem enviada (por pessoa ou automação) e avisa painel e webhooks. */
  async recordOutbound(workspaceId: string, conversationId: string, body: string, externalId?: string, authorId?: string, metadata?: Record<string, unknown>) {
    const stored = await prisma.message.create({
      data: { conversationId, body: sealField(body, workspaceId), direction: "OUTBOUND", type: "TEXT", externalId, authorId, ...(metadata ? { metadata: metadata as any } : {}) },
    });
    const message = { ...stored, body };
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    const view = { id: message.id, body: message.body, type: message.type, direction: message.direction, createdAt: message.createdAt };
    this.webhooks.emit(workspaceId, "message.sent", { conversationId, message: view });
    this.gateway.emitNewMessage(workspaceId, {
      conversationId,
      message: { ...view, direction: "OUTBOUND", createdAt: message.createdAt.toISOString(), authorId: authorId ?? null },
    });
    return message;
  }

  /** Contato pelo telefone (único por workspace); tolera duas mensagens simultâneas do mesmo número. */
  private async findOrCreateContact(msg: IncomingMessage) {
    const where = { workspaceId_phone: { workspaceId: msg.workspaceId, phone: msg.from } };
    const existing = await prisma.contact.findUnique({ where });
    if (existing) {
      // Troca o número pelo nome do WhatsApp quando ainda não temos um nome melhor
      if (msg.name && existing.name === existing.phone) {
        return { contact: await prisma.contact.update({ where: { id: existing.id }, data: { name: msg.name } }), created: false };
      }
      return { contact: existing, created: false };
    }
    try {
      const contact = await prisma.contact.create({ data: { workspaceId: msg.workspaceId, name: msg.name || msg.from, phone: msg.from } });
      return { contact, created: true };
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
      return { contact: await prisma.contact.findUniqueOrThrow({ where }), created: false };
    }
  }
}

/** Mensagens guardadas cifradas com a chave do workspace; as antigas (texto puro) passam como estão. */
export const openBodies = <T extends { body: string }>(rows: T[], workspaceId: string): T[] => rows.map((m) => ({ ...m, body: openField(m.body, workspaceId) }));
