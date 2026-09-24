import {
  Body, Controller, Delete, Get, HttpCode, Param,
  Post, Request, Headers, UseGuards, Logger, ForbiddenException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { timingSafeEqual } from "crypto";
import { ChannelsService } from "./channels.service";
import { EvolutionService } from "./evolution/evolution.service";
import { WhatsappWorker } from "./workers/whatsapp.worker";
import { AssistantService } from "./assistant/assistant.service";
import { prisma } from "@openclaw/database";

@Controller("channels")
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(
    private channels: ChannelsService,
    private evolution: EvolutionService,
    private whatsapp: WhatsappWorker,
    private assistant: AssistantService,
  ) {}

  // ─── Autenticado ──────────────────────────────────────────────

  @UseGuards(AuthGuard("jwt"))
  @Get()
  list(@Request() req: any) {
    return this.channels.listChannels(req.user.workspaces[0]?.workspaceId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("whatsapp")
  async createWhatsapp(@Request() req: any, @Body() body: { name: string }) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const instanceName = `oc_${workspaceId.slice(0, 8)}_${Date.now()}`;
    const webhookUrl = `${process.env.API_URL || "http://localhost:3001"}/api/v1/channels/webhooks/whatsapp/${instanceName}`;

    // Cria no Evolution API
    const evo = await this.evolution.createInstance(instanceName, webhookUrl);

    // Persiste o canal no banco
    const channel = await this.channels.createChannel(workspaceId, body.name, "WHATSAPP", {
      instanceName,
      webhookUrl,
      evolutionData: evo,
    });

    return { channel, instance: instanceName };
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("whatsapp/:channelId/qrcode")
  async getQrCode(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    return this.evolution.getQrCode(cfg.instanceName);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("whatsapp/:channelId/status")
  async getStatus(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    return this.evolution.getConnectionState(cfg.instanceName);
  }

  @UseGuards(AuthGuard("jwt"))
  @Delete("whatsapp/:channelId")
  async deleteWhatsapp(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    await this.evolution.deleteInstance(cfg.instanceName).catch(() => {});
    await prisma.channel.delete({ where: { id: channelId } });
    return { ok: true };
  }

  // Enviar mensagem de saída via WhatsApp
  @UseGuards(AuthGuard("jwt"))
  @Post("whatsapp/:channelId/send")
  async sendMessage(
    @Request() req: any,
    @Param("channelId") channelId: string,
    @Body() body: { to: string; text: string; conversationId: string },
  ) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;

    const result = await this.evolution.sendText(cfg.instanceName, body.to, body.text);

    // Salva a mensagem enviada no banco
    if (body.conversationId) {
      await prisma.message.create({
        data: {
          conversationId: body.conversationId,
          body: body.text,
          direction: "OUTBOUND",
          type: "TEXT",
          externalId: result?.key?.id,
          authorId: req.user.id,
        },
      });
    }

    return result;
  }

  // ─── Webhook público (Evolution API → openclaw) ────────────────

  @Post("webhooks/whatsapp/:instanceName")
  @HttpCode(200)
  async whatsappWebhook(
    @Param("instanceName") instanceName: string,
    @Body() body: any,
    @Headers("x-openclaw-secret") secret?: string,
  ) {
    const expected = process.env.WEBHOOK_SECRET;
    if (expected) {
      const a = Buffer.from(secret ?? "");
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException("segredo do webhook inválido");
    }

    this.logger.log(`Webhook recebido: ${instanceName} event=${body?.event}`);

    // Ignora eventos que não são mensagens
    if (body?.event !== "messages.upsert") return { ok: true };

    const data = body?.data;
    if (!data) return { ok: true };

    try {
      const channel = await prisma.channel.findFirst({
        where: { config: { path: ["instanceName"], equals: instanceName } },
      });

      if (!channel) {
        this.logger.warn(`Canal não encontrado para instance: ${instanceName}`);
        return { ok: true };
      }

      const jid: string = data.key?.remoteJid ?? "";
      if (jid.endsWith("@g.us") || jid === "status@broadcast") return { ok: true };

      // Mensagens do dono (texto ou áudio) viram comandos do assistente
      if (this.assistant.isOwnerJid(data.key?.remoteJid) || this.assistant.isOwnerJid(data.key?.remoteJidAlt) || this.assistant.isOwnerJid(data.key?.senderPn)) {
        if (this.assistant.isOwnEcho(data.key?.id)) return { ok: true };
        // Mensagens enviadas pelo número conectado para o dono (respostas do assistente, áudios) não são comandos,
        // a não ser que o dono use o próprio número conectado ("mensagem para si mesmo").
        if (data.key?.fromMe && !this.assistant.isOwnerJid(body?.sender)) return { ok: true };
        let text: string = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
        let heard = false;
        if (!text && data.message?.audioMessage) {
          try {
            text = await this.assistant.transcribe(instanceName, data.key);
            heard = true;
          } catch (err: any) {
            this.logger.error(`Transcrição falhou: ${err.message}`);
          }
          if (!text) {
            await this.assistant.sendToOwner(channel.workspaceId, instanceName, "Não consegui entender o áudio. Pode tentar de novo ou escrever?");
            return { ok: true };
          }
        }
        if (text) await this.assistant.handle(channel.workspaceId, instanceName, text, { heard });
        return { ok: true };
      }

      if (data.key?.fromMe) return { ok: true };

      await this.whatsapp.process(channel.workspaceId, channel.id, body);
    } catch (err: any) {
      this.logger.error(`Erro no webhook: ${err.message}`);
    }

    return { ok: true };
  }
}
