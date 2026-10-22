import { Injectable, Logger } from "@nestjs/common";
import { InboxService } from "../../inbox/inbox.service";
import type { IncomingMessage } from "@openclaw/types";
import { parseWhatsappMessage } from "../whatsapp/parse";
import { senderPhone } from "../whatsapp/phone";

// Normaliza o payload do Evolution API para IncomingMessage
interface EvolutionPayload {
  instance: string;
  data: {
    key: { remoteJid: string; remoteJidAlt?: string; senderPn?: string; id: string };
    pushName?: string;
    message: any;
    messageTimestamp: number;
  };
}

@Injectable()
export class WhatsappWorker {
  private readonly logger = new Logger(WhatsappWorker.name);

  constructor(private inbox: InboxService) {}

  /** Grava a mensagem do cliente. Devolve null se não for conteúdo (reação, mensagem apagada...) ou se já foi gravada. */
  async process(workspaceId: string, channelId: string, raw: EvolutionPayload) {
    const { data } = raw;
    const parsed = parseWhatsappMessage(data.message);
    if (!parsed) return null;
    const from = senderPhone(data.key) ?? data.key.remoteJid.split("@")[0];

    const msg: IncomingMessage = {
      channelId,
      workspaceId,
      externalId: data.key.id,
      from,
      name: data.pushName || undefined,
      body: parsed.body,
      type: parsed.type,
      // A chave permite baixar a mídia depois pelo Evolution (getBase64FromMediaMessage)
      metadata: { ...(parsed.metadata ?? {}), ...(parsed.type !== "TEXT" ? { waKey: data.key } : {}) },
      timestamp: new Date(Number(data.messageTimestamp) * 1000),
      raw,
    };

    const res = await this.inbox.processIncoming(msg);
    if (res) this.logger.log(`WhatsApp ${parsed.type} recebido de ${from}`);
    return res;
  }
}
