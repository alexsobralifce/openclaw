import { Injectable, Logger } from "@nestjs/common";
import { InboxService } from "../../inbox/inbox.service";
import type { IncomingMessage } from "@openclaw/types";

// Normaliza o payload do Evolution API para IncomingMessage
interface EvolutionPayload {
  instance: string;
  data: {
    key: { remoteJid: string; id: string };
    message: { conversation?: string; imageMessage?: { caption?: string }; audioMessage?: object };
    messageTimestamp: number;
  };
}

@Injectable()
export class WhatsappWorker {
  private readonly logger = new Logger(WhatsappWorker.name);

  constructor(private inbox: InboxService) {}

  async process(workspaceId: string, channelId: string, raw: EvolutionPayload): Promise<void> {
    const { data } = raw;
    const from = data.key.remoteJid.replace("@s.whatsapp.net", "");
    const body = data.message.conversation || data.message.imageMessage?.caption || "";
    const type = data.message.conversation ? "TEXT" : data.message.imageMessage ? "IMAGE" : "AUDIO";

    const msg: IncomingMessage = {
      channelId,
      workspaceId,
      externalId: data.key.id,
      from,
      body,
      type,
      timestamp: new Date(data.messageTimestamp * 1000),
      raw,
    };

    await this.inbox.processIncoming(msg);
    this.logger.log(`WhatsApp message processed from ${from}`);
  }
}
