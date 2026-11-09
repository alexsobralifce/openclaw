import {
  Body, Controller, Delete, Get, HttpCode, Param,
  Post, Request, Headers, Logger, ForbiddenException, UseFilters,
} from "@nestjs/common";
import { Access } from "../auth/access";
import { timingSafeEqual } from "crypto";
import { ChannelsService } from "./channels.service";
import { EvolutionService } from "./evolution/evolution.service";
import { EvolutionExceptionFilter } from "./evolution/evolution.filter";
import { InboundService } from "./inbound/inbound.service";
import { InboxService } from "../inbox/inbox.service";
import { prisma } from "@openclaw/database";

@Controller("channels")
@UseFilters(EvolutionExceptionFilter)
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(
    private channels: ChannelsService,
    private evolution: EvolutionService,
    private inbound: InboundService,
    private inbox: InboxService,
  ) {}

  // ─── Autenticado ──────────────────────────────────────────────

  @Access()
  @Get()
  list(@Request() req: any) {
    return this.channels.listChannels(req.user.workspaces[0]?.workspaceId);
  }

  @Access("channels")
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

  @Access("channels")
  @Get("whatsapp/:channelId/qrcode")
  async getQrCode(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    try {
      return await this.evolution.getQrCode(cfg.instanceName);
    } catch (e: any) {
      if (!this.evolution.isMissingInstance(e)) throw e;
      // A instância sumiu do Evolution: recria com o mesmo nome e webhook e devolve o QR novo
      this.logger.warn(`Instância ${cfg.instanceName} não existe no Evolution; recriando`);
      await this.evolution.createInstance(cfg.instanceName, cfg.webhookUrl);
      return this.evolution.getQrCode(cfg.instanceName);
    }
  }

  @Access("channels")
  @Get("whatsapp/:channelId/status")
  async getStatus(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    try {
      return await this.evolution.getConnectionState(cfg.instanceName);
    } catch (e: any) {
      // Instância que não existe mais no Evolution conta como desconectada (o painel oferece o QR Code para reconectar)
      if (this.evolution.isMissingInstance(e)) return { state: "close" };
      throw e;
    }
  }

  @Access("channels")
  @Delete("whatsapp/:channelId")
  async deleteWhatsapp(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    await this.evolution.deleteInstance(cfg.instanceName).catch(() => {});
    // Com conversas, o canal não pode ser apagado (o histórico depende dele): fica desativado e some da lista
    const conversations = await prisma.conversation.count({ where: { channelId } });
    if (conversations) await prisma.channel.update({ where: { id: channelId }, data: { isActive: false } });
    else await prisma.channel.delete({ where: { id: channelId } });
    return { ok: true };
  }

  // Enviar mensagem de saída via WhatsApp
  @Access("inbox")
  @Post("whatsapp/:channelId/send")
  async sendMessage(
    @Request() req: any,
    @Param("channelId") channelId: string,
    @Body() body: { to: string; text: string; conversationId: string },
  ) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId } });
    const cfg = channel.config as any;
    // A conversa precisa ser deste workspace (antes, qualquer id era aceito)
    if (body.conversationId) await prisma.conversation.findFirstOrThrow({ where: { id: body.conversationId, workspaceId } });

    const result = await this.evolution.sendText(cfg.instanceName, body.to, body.text);
    if (body.conversationId) await this.inbox.recordOutbound(workspaceId, body.conversationId, body.text, result?.key?.id, req.user.id);

    return result;
  }

  // ─── Webhook público (Evolution API → openclaw) ────────────────

  /** Só grava na fila e responde: o processamento (IA, transcrição, banco) acontece no InboundService. */
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

    // Se a gravação falhar, a exceção vira 500 e o Evolution pode reenviar; duplicatas são descartadas na fila
    const queued = await this.inbound.enqueue(instanceName, body);
    if (queued) this.logger.log(`Webhook enfileirado: ${instanceName} ${body?.data?.key?.id}`);
    return { ok: true };
  }
}
