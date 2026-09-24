import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { GoogleService } from "../../integrations/google/google.service";
import { AssistantService } from "./assistant.service";
import { MenuService } from "./menu.service";

const INTERVAL_MS = Number(process.env.EMAIL_POLL_SECONDS || 60) * 1000;

@Injectable()
export class EmailWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWatcherService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private google: GoogleService,
    private assistant: AssistantService,
    private menu: MenuService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running || !AssistantService.ownerNumber()) return;
    this.running = true;
    try {
      const channels = await prisma.channel.findMany({
        where: { type: "EMAIL", config: { path: ["provider"], equals: "google" } },
      });
      const byWorkspace = new Map<string, typeof channels>();
      for (const c of channels) byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c]);

      for (const [workspaceId, list] of byWorkspace) {
        await this.checkWorkspace(workspaceId, list).catch((e) =>
          this.logger.error(`Vigia de e-mail falhou (${workspaceId}): ${e.message}`),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async checkWorkspace(workspaceId: string, channels: any[]) {
    const fresh: { account: string; id: string; de: string; assunto: string }[] = [];
    const updates: { id: string; config: any }[] = [];

    for (const ch of channels) {
      const cfg = ch.config as any;
      const account: string = cfg.email;

      // Primeira vez: marca o "agora" como ponto de partida, sem avisar dos antigos
      if (!cfg.lastSeenMs) {
        updates.push({ id: ch.id, config: { ...cfg, lastSeenMs: Date.now() } });
        continue;
      }

      const sinceSec = Math.floor(cfg.lastSeenMs / 1000);
      const items = await this.google.gmailSearch(workspaceId, `is:unread in:inbox after:${sinceSec}`, account, 10);
      const news = items.filter((m: any) => m.internalDate > cfg.lastSeenMs);
      if (!news.length) continue;

      news.forEach((m: any) => fresh.push({ account, id: m.id, de: m.de ?? "", assunto: m.assunto ?? "" }));
      const newest = Math.max(...news.map((m: any) => m.internalDate));
      updates.push({ id: ch.id, config: { ...cfg, lastSeenMs: newest } });
    }

    if (fresh.length) {
      const wa = await prisma.channel.findFirst({ where: { workspaceId, type: "WHATSAPP", isActive: true } });
      const instance = (wa?.config as any)?.instanceName;
      if (instance) {
        const text = await this.menu.notifyNew(workspaceId, fresh);
        await this.assistant.sendToOwner(workspaceId, instance, text);
      } else {
        this.logger.warn("Novo e-mail, mas não há canal WhatsApp para avisar.");
      }
    }

    // Só avança o ponto de partida depois de tentar avisar
    for (const u of updates) await prisma.channel.update({ where: { id: u.id }, data: { config: u.config } });
  }
}
