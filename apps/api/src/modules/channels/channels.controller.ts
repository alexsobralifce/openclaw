import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Query,
  Post, Put, RawBodyRequest, Req, Request, Res, Headers, Logger, ForbiddenException, UseFilters,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Access } from "../auth/access";
import { timingSafeEqual } from "crypto";
import { ChannelsService } from "./channels.service";
import { EvolutionService } from "./evolution/evolution.service";
import { EvolutionExceptionFilter } from "./evolution/evolution.filter";
import { InboundService } from "./inbound/inbound.service";
import { readDistribution } from "./inbound/lead-distribution.service";
import { InboxService } from "../inbox/inbox.service";
import { InstagramApiError, InstagramService, REPLY_WINDOW_MS } from "./instagram/instagram.service";
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
    private instagram: InstagramService,
    private jwt: JwtService,
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
  /** Configuração da distribuição de clientes entre vendedores. Só OWNER e ADMIN. */
  @Get("whatsapp/:channelId/distribution")
  async getDistribution(@Request() req: any, @Param("channelId") channelId: string) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    await this.assertManager(req.user.id, workspaceId);
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId, type: "WHATSAPP" } });
    return readDistribution(channel.config);
  }

  @Put("whatsapp/:channelId/distribution")
  async setDistribution(
    @Request() req: any,
    @Param("channelId") channelId: string,
    @Body() body: { enabled: boolean; sellers: { name: string; phone: string }[] },
  ) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    await this.assertManager(req.user.id, workspaceId);
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId, type: "WHATSAPP" } });
    const sellers = (Array.isArray(body.sellers) ? body.sellers : [])
      .map((s) => ({ name: String(s?.name ?? "").trim().slice(0, 80), phone: String(s?.phone ?? "").replace(/\D/g, "") }))
      .filter((s) => s.phone);
    if (sellers.some((s) => s.phone.length < 10 || s.phone.length > 15)) throw new BadRequestException("Telefone de vendedor inválido");
    if (body.enabled && sellers.length === 0) throw new BadRequestException("Cadastre pelo menos um vendedor para ativar");
    const cfg: any = channel.config ?? {};
    const cursor = readDistribution(cfg).cursor;
    await prisma.channel.update({
      where: { id: channel.id },
      data: { config: { ...cfg, distribution: { enabled: body.enabled === true, sellers, cursor } } },
    });
    return { enabled: body.enabled === true, sellers, cursor };
  }

  private async assertManager(userId: string, workspaceId: string) {
    const m = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId, role: { in: ["OWNER", "ADMIN"] } } });
    if (!m) throw new ForbiddenException("Somente dono ou administrador podem configurar a distribuição");
  }

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

  // ─── Instagram ────────────────────────────────────────────────

  /** Endereço de login do Instagram: o cliente só clica em "Conectar" e autoriza, sem colar chave nenhuma. */
  @Access("channels")
  @Get("instagram/auth-url")
  instagramAuthUrl(@Request() req: any) {
    if (!this.instagram.isConfigured()) {
      throw new BadRequestException("INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET não configurados no .env");
    }
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const state = this.jwt.sign({ workspaceId, purpose: "instagram-oauth" }, { expiresIn: "10m" });
    return { url: this.instagram.authUrl(state) };
  }

  @Get("instagram/callback")
  async instagramCallback(@Query("code") code: string, @Query("state") state: string, @Query("error") error: string, @Res() res: any) {
    const web = process.env.WEB_URL || "http://localhost:3000";
    if (error || !code || !state) return res.redirect(`${web}/dashboard/channels?instagram=error`);
    try {
      const payload: any = this.jwt.verify(state);
      if (payload.purpose !== "instagram-oauth") throw new Error("state inválido");
      await this.instagram.connect(payload.workspaceId, code);
      return res.redirect(`${web}/dashboard/channels?instagram=ok`);
    } catch (e: any) {
      this.logger.error(`Conexão do Instagram falhou: ${e.message}`);
      return res.redirect(`${web}/dashboard/channels?instagram=error`);
    }
  }

  @Access("channels")
  @Delete("instagram/:channelId")
  async disconnectInstagram(@Request() req: any, @Param("channelId") channelId: string) {
    await this.instagram.disconnect(req.user.workspaces[0]?.workspaceId, channelId);
    return { ok: true };
  }

  @Access("inbox")
  @Post("instagram/:channelId/send")
  async sendInstagram(
    @Request() req: any,
    @Param("channelId") channelId: string,
    @Body() body: { text: string; conversationId: string },
  ) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const text = body?.text?.trim();
    if (!text || !body.conversationId) throw new BadRequestException("text e conversationId são obrigatórios");
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId, type: "INSTAGRAM" } });
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { id: body.conversationId, workspaceId, channelId: channel.id },
      include: { contact: true },
    });
    if (!conversation.contact.externalId) throw new BadRequestException("Contato sem id do Instagram");

    // A Meta só deixa responder até 24 h depois da última mensagem do cliente
    const last = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!last || Date.now() - last.createdAt.getTime() > REPLY_WINDOW_MS) {
      throw new BadRequestException("Passaram mais de 24 h desde a última mensagem do cliente: o Instagram não permite mais responder.");
    }

    let mid: string | undefined;
    try {
      mid = await this.instagram.sendText(channel, conversation.contact.externalId, text);
    } catch (e: any) {
      if (e instanceof InstagramApiError) throw new BadRequestException(`Instagram recusou o envio: ${e.message}`);
      throw e;
    }
    await this.inbox.recordOutbound(workspaceId, conversation.id, text, mid, req.user.id);
    return { ok: true, id: mid };
  }

  // ─── Webhook público do Instagram (Meta → openclaw) ────────────

  /** Verificação inicial: a Meta manda hub.challenge e espera receber o mesmo valor de volta. */
  @Get("webhooks/instagram")
  instagramVerify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    const expected = this.instagram.verifyToken;
    const a = Buffer.from(token ?? "");
    const b = Buffer.from(expected);
    if (mode !== "subscribe" || !expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException("verify token inválido");
    return challenge;
  }

  /** Confere a assinatura, grava na fila e responde: o processamento acontece no InboundService. */
  @Post("webhooks/instagram")
  @HttpCode(200)
  async instagramWebhook(@Req() req: RawBodyRequest<any>, @Body() body: any, @Headers("x-hub-signature-256") signature?: string) {
    if (!this.instagram.verifySignature(req.rawBody, signature)) throw new ForbiddenException("assinatura inválida");
    const queued = await this.inbound.enqueueInstagram(body);
    if (queued) this.logger.log(`Webhook do Instagram enfileirado: ${queued} mensagem(ns)`);
    return { ok: true };
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
