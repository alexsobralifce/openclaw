import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";
import { prisma } from "@openclaw/database";
import { decryptSecret, encryptSecret } from "./crypto";
import { assertPublicUrl } from "./url-guard";
import { limitsFor } from "../public-api/plan-limits";

export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "conversation.created",
  "conversation.status_changed",
  "conversation.deleted",
  "contact.created",
  "contact.updated",
  "email.received",
  "webhook.test",
] as const;

// Retentativas: 1 min, 5 min, 30 min, 2 h, 12 h (depois disso a entrega falha)
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DISABLE_AFTER_FAILED = 10;
const TICK_MS = 5_000;
const TIMEOUT_MS = 10_000;
const CLAIM_MS = 60_000;

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Gestão dos endpoints ──────────────────────────────────────

  async create(workspaceId: string, data: { url: string; events?: string[] }) {
    const events = data.events?.length ? data.events : ["*"];
    const bad = events.filter((e) => e !== "*" && !(WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (bad.length) throw new BadRequestException(`Eventos inválidos: ${bad.join(", ")}`);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { plan: true } });
    const limits = limitsFor(ws.plan);
    if ((await prisma.webhookEndpoint.count({ where: { workspaceId } })) >= limits.webhooks) {
      throw new ForbiddenException(`Seu plano permite até ${limits.webhooks} webhooks. Remova um ou mude de plano.`);
    }
    await assertPublicUrl(data.url).catch((e) => {
      throw new BadRequestException(e.message);
    });
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const ep = await prisma.webhookEndpoint.create({
      data: { workspaceId, url: data.url, events, secret: encryptSecret(secret) },
    });
    return { ...this.view(ep), secret };
  }

  async list(workspaceId: string) {
    const eps = await prisma.webhookEndpoint.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    return eps.map((e) => this.view(e));
  }

  async remove(workspaceId: string, id: string) {
    const res = await prisma.webhookEndpoint.deleteMany({ where: { id, workspaceId } });
    if (!res.count) throw new NotFoundException("Webhook não encontrado");
    return { ok: true };
  }

  async test(workspaceId: string, id: string) {
    const ep = await this.find(workspaceId, id);
    await this.enqueue(ep.id, "webhook.test", { message: "Evento de teste do Assist.IA" });
    return { ok: true };
  }

  async deliveries(workspaceId: string, id: string) {
    await this.find(workspaceId, id);
    const rows = await prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, eventId: true, type: true, status: true, attempts: true, responseCode: true, lastError: true, nextAttemptAt: true, createdAt: true },
    });
    return { data: rows };
  }

  /** Recoloca uma entrega (por exemplo, falha) na fila para nova tentativa. */
  async retry(workspaceId: string, id: string, deliveryId: string) {
    await this.find(workspaceId, id);
    const res = await prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, endpointId: id },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    if (!res.count) throw new NotFoundException("Entrega não encontrada");
    await prisma.webhookEndpoint.update({ where: { id }, data: { isActive: true, failureCount: 0 } });
    return { ok: true };
  }

  // ─── Emissão de eventos ────────────────────────────────────────

  /** Registra o evento para todos os endpoints ativos que o assinam. Nunca lança erro. */
  emit(workspaceId: string, type: string, data: unknown) {
    void this.doEmit(workspaceId, type, data).catch((e) => this.logger.error(`emit ${type}: ${e.message}`));
  }

  private async doEmit(workspaceId: string, type: string, data: unknown) {
    const eps = await prisma.webhookEndpoint.findMany({
      where: { workspaceId, isActive: true, OR: [{ events: { has: type } }, { events: { has: "*" } }] },
      select: { id: true },
    });
    if (!eps.length) return;
    const eventId = `evt_${randomBytes(12).toString("hex")}`;
    for (const ep of eps) await this.enqueue(ep.id, type, data, eventId);
  }

  private enqueue(endpointId: string, type: string, data: unknown, eventId = `evt_${randomBytes(12).toString("hex")}`) {
    const payload = { id: eventId, type, createdAt: new Date().toISOString(), data };
    return prisma.webhookDelivery.create({ data: { endpointId, eventId, type, payload: payload as any } });
  }

  // ─── Entrega ───────────────────────────────────────────────────

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await prisma.webhookDelivery.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: "asc" },
        take: 20,
        include: { endpoint: true },
      });
      for (const d of due) {
        // reserva a entrega para este processo (evita envio duplicado se demorar)
        const claimed = await prisma.webhookDelivery.updateMany({
          where: { id: d.id, status: "PENDING", nextAttemptAt: d.nextAttemptAt },
          data: { nextAttemptAt: new Date(Date.now() + CLAIM_MS) },
        });
        if (claimed.count) await this.deliver(d).catch((e) => this.logger.error(`entrega ${d.id}: ${e.message}`));
      }
    } catch (e: any) {
      this.logger.error(`Fila de webhooks falhou: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private async deliver(d: any) {
    const ep = d.endpoint;
    if (!ep.isActive) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", lastError: "Endpoint desativado" } });
      return;
    }

    let code: number | null = null;
    let error: string | null = null;
    try {
      await assertPublicUrl(ep.url);
      const body = JSON.stringify(d.payload);
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", decryptSecret(ep.secret)).update(`${t}.${body}`).digest("hex");
      const res = await fetch(ep.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "openclaw-webhooks/1",
          "X-OpenClaw-Event": d.type,
          "X-OpenClaw-Delivery": d.id,
          "X-OpenClaw-Signature": `t=${t},v1=${sig}`,
        },
        body,
      });
      code = res.status;
      if (code < 200 || code >= 300) error = `HTTP ${code}`;
    } catch (e: any) {
      error = String(e.message ?? e).slice(0, 200);
    }

    const attempts = d.attempts + 1;
    if (!error) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "SUCCESS", attempts, responseCode: code, lastError: null } });
      if (ep.failureCount) await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { failureCount: 0 } });
      return;
    }

    if (attempts >= MAX_ATTEMPTS) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", attempts, responseCode: code, lastError: error } });
      const updated = await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { failureCount: { increment: 1 } } });
      if (updated.failureCount >= DISABLE_AFTER_FAILED) {
        await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { isActive: false } });
        this.logger.warn(`Webhook ${ep.id} desativado após ${DISABLE_AFTER_FAILED} entregas falhas`);
      }
      return;
    }
    await prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { attempts, responseCode: code, lastError: error, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) },
    });
  }

  // ─── Auxiliares ────────────────────────────────────────────────

  private async find(workspaceId: string, id: string) {
    const ep = await prisma.webhookEndpoint.findFirst({ where: { id, workspaceId } });
    if (!ep) throw new NotFoundException("Webhook não encontrado");
    return ep;
  }

  private view(e: any) {
    return { id: e.id, url: e.url, events: e.events, isActive: e.isActive, failureCount: e.failureCount, createdAt: e.createdAt };
  }
}
