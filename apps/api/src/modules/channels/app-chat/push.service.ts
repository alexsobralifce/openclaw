import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import * as webpush from "web-push";

/** Notificações do navegador (Web Push). Só funciona com as chaves VAPID configuradas (WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY). */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private ready = false;

  enabled() {
    return !!process.env.WEBPUSH_PUBLIC_KEY && !!process.env.WEBPUSH_PRIVATE_KEY;
  }

  publicKey() {
    return process.env.WEBPUSH_PUBLIC_KEY ?? "";
  }

  private init() {
    if (this.ready || !this.enabled()) return;
    webpush.setVapidDetails(process.env.WEBPUSH_SUBJECT || "mailto:contato@magobox.com.br", process.env.WEBPUSH_PUBLIC_KEY!, process.env.WEBPUSH_PRIVATE_KEY!);
    this.ready = true;
  }

  async subscribers(userId: string): Promise<number> {
    return prisma.pushSubscription.count({ where: { userId } });
  }

  /** Guarda a assinatura do navegador (a mesma assinatura não duplica: a unicidade é garantida aqui, sem @unique). */
  async subscribe(userId: string, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
    const endpoint = String(sub?.endpoint ?? "");
    const p256dh = String(sub?.keys?.p256dh ?? "");
    const auth = String(sub?.keys?.auth ?? "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) throw new Error("assinatura de notificação inválida");
    const existing = await prisma.pushSubscription.findFirst({ where: { endpoint } });
    if (existing) await prisma.pushSubscription.update({ where: { id: existing.id }, data: { userId, p256dh, auth } });
    else await prisma.pushSubscription.create({ data: { userId, endpoint, p256dh, auth } });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /** Avisa todos os navegadores do usuário. Assinatura vencida (404/410) é apagada; qualquer outra falha só vira aviso no log. */
  async notify(userId: string, payload: { title: string; body: string; url?: string }) {
    if (!this.enabled()) return;
    this.init();
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 });
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          else this.logger.warn(`Notificação não enviada: ${e?.statusCode ?? ""} ${String(e?.message ?? e).slice(0, 100)}`);
        }
      }),
    );
  }
}
