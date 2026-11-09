import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import type { IncomingMessage } from "@openclaw/types";
import { InboxService } from "../../inbox/inbox.service";
import { InstagramService } from "../instagram/instagram.service";
import { InstagramEvent, toMessageContent } from "../instagram/parse";

@Injectable()
export class InstagramWorker {
  private readonly logger = new Logger(InstagramWorker.name);

  constructor(private inbox: InboxService, private instagram: InstagramService) {}

  /** Grava a mensagem do cliente. Devolve null se o canal não existe/está desligado ou se já foi gravada. */
  async process(ev: InstagramEvent): Promise<any> {
    // DESATIVADO A PEDIDO PARA TESTE
    return null;
    /*
    const channel = await this.instagram.findByAccount(ev.accountId);
    if (!channel || !channel.isActive) {
      this.logger.warn(`Canal do Instagram não encontrado ou desligado para a conta ${ev.accountId}`);
      return null;
    }
    const content = toMessageContent(ev);
    if (!content.body) return null;

    // O nome do cliente só é buscado enquanto o contato ainda não tem um (a primeira mensagem)
    let name: string | undefined;
    const token = this.instagram.tokenOf(channel);
    const known = await prisma.contact.findFirst({ where: { workspaceId: channel.workspaceId, externalId: ev.senderId }, select: { name: true } });
    if (token && (!known || known.name === ev.senderId)) {
      const p = await this.instagram.profile(token, ev.senderId);
      name = p.name || (p.username ? `@${p.username}` : undefined);
    }

    const msg: IncomingMessage = {
      channelId: channel.id,
      workspaceId: channel.workspaceId,
      externalId: ev.mid,
      from: ev.senderId,
      externalContactId: ev.senderId,
      name,
      body: content.body,
      type: content.type,
      metadata: content.metadata,
      timestamp: new Date(ev.timestamp),
      raw: ev,
    };
    const res = await this.inbox.processIncoming(msg);
    if (res) this.logger.log(`Instagram ${content.type} recebido de ${ev.senderId}`);
    return res ? { channel, ...res } : null;
    */
  }
}
