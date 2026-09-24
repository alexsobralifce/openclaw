import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { EvolutionService } from "../channels/evolution/evolution.service";
import { InboxGateway } from "../inbox/inbox.gateway";
import { ListQuery } from "./dto";

const digits = (v?: string) => (v ?? "").replace(/\D/g, "");

function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
}

const listArgs = (q: ListQuery) => {
  const limit = q.limit ?? 50;
  return {
    limit,
    args: {
      take: limit + 1,
      orderBy: [{ updatedAt: "asc" as const }, { id: "asc" as const }],
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    },
    since: q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {},
  };
};

const conflict = (e: any) => {
  if (e?.code === "P2002") throw new ConflictException("Já existe um contato com este telefone ou e-mail");
  throw e;
};

@Injectable()
export class PublicApiService {
  constructor(
    private evolution: EvolutionService,
    private gateway: InboxGateway,
  ) {}

  async me(workspaceId: string, scopes: string[]) {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return { workspace: { id: ws.id, name: ws.name, plan: ws.plan }, scopes };
  }

  // ─── Contatos ──────────────────────────────────────────────────

  async listContacts(workspaceId: string, q: ListQuery) {
    const { limit, args, since } = listArgs(q);
    const search = q.search
      ? { OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { email: { contains: q.search, mode: "insensitive" as const } }, { phone: { contains: digits(q.search) || q.search } }] }
      : {};
    const rows = await prisma.contact.findMany({ where: { workspaceId, ...since, ...search }, ...args });
    return page(rows, limit);
  }

  async getContact(workspaceId: string, id: string) {
    const c = await prisma.contact.findFirst({ where: { id, workspaceId }, include: { tags: { include: { tag: true } } } });
    if (!c) throw new NotFoundException("Contato não encontrado");
    return { ...c, tags: c.tags.map((t) => t.tag.name) };
  }

  async createContact(workspaceId: string, data: { name: string; email?: string; phone?: string; externalId?: string; notes?: string }) {
    try {
      return await prisma.contact.create({ data: { workspaceId, ...data, phone: data.phone ? digits(data.phone) : undefined } });
    } catch (e) {
      return conflict(e);
    }
  }

  async updateContact(workspaceId: string, id: string, data: Record<string, any>) {
    await this.getContact(workspaceId, id);
    if (data.phone) data.phone = digits(data.phone);
    try {
      return await prisma.contact.update({ where: { id }, data });
    } catch (e) {
      return conflict(e);
    }
  }

  /** Cria ou atualiza o contato pelo telefone (idempotente, ideal para CRM). */
  async upsertContactByPhone(workspaceId: string, phone: string, data: { name?: string; email?: string; externalId?: string; notes?: string }) {
    const p = digits(phone);
    if (p.length < 8) throw new BadRequestException("Telefone inválido");
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    try {
      return await prisma.contact.upsert({
        where: { workspaceId_phone: { workspaceId, phone: p } },
        create: { workspaceId, phone: p, name: data.name ?? p, ...defined },
        update: defined,
      });
    } catch (e) {
      return conflict(e);
    }
  }

  // ─── Conversas e mensagens ─────────────────────────────────────

  async listConversations(workspaceId: string, q: ListQuery) {
    const { limit, args, since } = listArgs(q);
    const status = q.status ? { status: q.status as any } : {};
    const rows = await prisma.conversation.findMany({ where: { workspaceId, ...since, ...status }, ...args });
    return page(rows, limit);
  }

  async getConversation(workspaceId: string, id: string) {
    const c = await prisma.conversation.findFirst({ where: { id, workspaceId }, include: { contact: true } });
    if (!c) throw new NotFoundException("Conversa não encontrada");
    return c;
  }

  async updateConversation(workspaceId: string, id: string, status: string) {
    await this.getConversation(workspaceId, id);
    const conv = await prisma.conversation.update({ where: { id }, data: { status: status as any }, include: { assignees: true } });
    this.gateway.emitConversationUpdated(workspaceId, {
      conversationId: id,
      status: conv.status,
      assigneeIds: conv.assignees.map((a) => a.userId),
    });
    const { assignees, ...rest } = conv;
    return rest;
  }

  async listMessages(workspaceId: string, conversationId: string, q: ListQuery) {
    await this.getConversation(workspaceId, conversationId);
    const limit = q.limit ?? 50;
    const rows = await prisma.message.findMany({
      where: { conversationId, ...(q.updatedSince ? { createdAt: { gt: new Date(q.updatedSince) } } : {}) },
      take: limit + 1,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: { id: true, body: true, type: true, direction: true, createdAt: true, conversationId: true },
    });
    return page(rows, limit);
  }

  /** Envia uma mensagem de WhatsApp e registra na conversa aberta do contato. */
  async sendMessage(workspaceId: string, data: { to: string; text: string; channelId?: string }) {
    const phone = digits(data.to);
    if (phone.length < 8) throw new BadRequestException("Número de destino inválido (use formato internacional, ex.: 5585999999999)");

    const channel = await prisma.channel.findFirst({
      where: { workspaceId, type: "WHATSAPP", isActive: true, ...(data.channelId ? { id: data.channelId } : {}) },
    });
    const instanceName = (channel?.config as any)?.instanceName;
    if (!channel || !instanceName) throw new BadRequestException("Nenhum canal de WhatsApp ativo neste workspace");

    let res: any;
    try {
      res = await this.evolution.sendText(instanceName, phone, data.text);
    } catch (e: any) {
      throw new BadRequestException(`Falha ao enviar pelo WhatsApp: ${String(e.message).slice(0, 200)}`);
    }

    const contact = await prisma.contact.upsert({
      where: { workspaceId_phone: { workspaceId, phone } },
      create: { workspaceId, phone, name: phone },
      update: {},
    });
    const conversation =
      (await prisma.conversation.findFirst({ where: { workspaceId, contactId: contact.id, channelId: channel.id, status: "OPEN" } })) ??
      (await prisma.conversation.create({ data: { workspaceId, contactId: contact.id, channelId: channel.id } }));

    const message = await prisma.message.create({
      data: { conversationId: conversation.id, body: data.text, direction: "OUTBOUND", type: "TEXT", externalId: res?.key?.id },
    });
    this.gateway.emitNewMessage(workspaceId, {
      conversationId: conversation.id,
      message: { id: message.id, body: message.body, type: message.type, direction: message.direction, createdAt: message.createdAt.toISOString(), authorId: null },
    });

    return { id: message.id, conversationId: conversation.id, contactId: contact.id, status: "sent", createdAt: message.createdAt };
  }
}
