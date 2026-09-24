import { Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { InboxGateway } from "./inbox.gateway";
import { WebhooksService } from "../webhooks/webhooks.service";
import type { IncomingMessage } from "@openclaw/types";

@Injectable()
export class InboxService {
  constructor(
    private gateway: InboxGateway,
    private webhooks: WebhooksService,
  ) {}

  async listConversations(workspaceId: string, status?: string) {
    return prisma.conversation.findMany({
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
  }

  async getConversation(workspaceId: string, id: string) {
    return prisma.conversation.findFirstOrThrow({
      where: { id, workspaceId },
      include: {
        contact: true,
        channel: true,
        assignees: { include: { user: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
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

  async processIncoming(msg: IncomingMessage) {
    let contact = await prisma.contact.findFirst({
      where: { workspaceId: msg.workspaceId, phone: msg.from },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: { workspaceId: msg.workspaceId, name: msg.from, phone: msg.from },
      });
      this.webhooks.emit(msg.workspaceId, "contact.created", { contact });
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: msg.workspaceId,
        contactId: contact.id,
        channelId: msg.channelId,
        status: "OPEN",
      },
    });

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

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        body: msg.body,
        type: msg.type,
        direction: "INBOUND",
        externalId: msg.externalId,
      },
    });

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

    return { conversation, message };
  }
}
