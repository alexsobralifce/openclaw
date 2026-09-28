import { classifyEmail, isHidden } from "./email-filter";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { GoogleService } from "../../integrations/google/google.service";
import { AssistantService } from "./assistant.service";
import { MenuService } from "./menu.service";
import { WebhooksService } from "../../webhooks/webhooks.service";
import { assistantInstance, can, workspaceCommander } from "./commander";
import { loadMute } from "./email-mute";
import { StateService } from "../../state/state.service";

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
    private webhooks: WebhooksService,
    private state: StateService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private lastFailure = new Map<string, { message: string; at: number }>();

  /**
   * Com o WhatsApp fora, o aviso é refeito a cada volta (o ponto de partida só avança depois de avisar).
   * Registra a falha uma vez e volta a registrar se a causa mudar ou passar meia hora, para não encher o log.
   */
  private logFailure(workspaceId: string, e: any) {
    const message = String(e?.message ?? e).slice(0, 300);
    const last = this.lastFailure.get(workspaceId);
    if (last && last.message === message && Date.now() - last.at < 30 * 60_000) return;
    this.lastFailure.set(workspaceId, { message, at: Date.now() });
    this.logger.error(`Vigia de e-mail falhou (${workspaceId}); tenta de novo na próxima volta: ${message}`);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const channels = await prisma.channel.findMany({
        where: { type: "EMAIL", config: { path: ["provider"], equals: "google" } },
      });
      const byWorkspace = new Map<string, typeof channels>();
      for (const c of channels) byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c]);

      for (const [workspaceId, list] of byWorkspace) {
        await this.checkWorkspace(workspaceId, list)
          .then(() => this.lastFailure.delete(workspaceId))
          .catch((e) => this.logFailure(workspaceId, e));
      }
    } finally {
      this.running = false;
    }
  }

  private async checkWorkspace(workspaceId: string, channels: any[]) {
    const fresh: { account: string; id: string; de: string; assunto: string; at: number; kind: "person" | "auto" }[] = [];
    const updates: { id: string; config: any }[] = [];
    const mute = await loadMute(this.state, workspaceId);

    for (const ch of channels) {
      const cfg = ch.config as any;
      const account: string = cfg.email;

      // Primeira vez: marca o "agora" como ponto de partida, sem avisar dos antigos
      if (!cfg.lastSeenMs) {
        updates.push({ id: ch.id, config: { ...cfg, lastSeenMs: Date.now() } });
        continue;
      }

      const sinceSec = Math.floor(cfg.lastSeenMs / 1000);
      const items = await this.google.gmailSearch(workspaceId, `is:unread in:inbox after:${sinceSec}`, account, 25);
      const news = items.filter((m: any) => m.internalDate > cfg.lastSeenMs);
      if (!news.length) continue;

      // Spam, promoções e remetentes "sem interesse" não avisam nem entram na fila (continuam no Gmail, intactos)
      let hidden = 0;
      for (const m of news) {
        const c = classifyEmail(m, mute);
        if (isHidden(c.kind)) hidden++;
        else fresh.push({ account, id: m.id, de: m.de ?? "", assunto: m.assunto ?? "", at: m.internalDate, kind: c.kind === "auto" ? "auto" : "person" });
      }
      if (hidden) this.logger.log(`${hidden} e-mail(s) de spam/promoção/sem interesse não avisados (${account})`);
      const newest = Math.max(...news.map((m: any) => m.internalDate));
      updates.push({ id: ch.id, config: { ...cfg, lastSeenMs: newest } });
    }

    // Do mais antigo ao mais novo, entre todas as contas
    fresh.sort((a, b) => a.at - b.at);

    // Metadados (sem o corpo) para clientes que assinam email.received
    for (const m of fresh) this.webhooks.emit(workspaceId, "email.received", { account: m.account, id: m.id, from: m.de, subject: m.assunto });

    if (fresh.length) {
      // Avisa o dono do workspace, se ele tiver WhatsApp cadastrado e os serviços liberados
      const owner = await workspaceCommander(workspaceId);
      const instance = await assistantInstance(workspaceId);
      if (owner && can(owner, "assistant") && can(owner, "email") && instance) {
        const text = await this.menu.notifyNew(workspaceId, fresh);
        await this.assistant.sendToUser(owner, instance, text);
      } else if (!instance) {
        this.logger.warn(`Novo e-mail no workspace ${workspaceId}, mas não há WhatsApp para avisar.`);
      }
    }

    // Só avança o ponto de partida depois de tentar avisar
    for (const u of updates) await prisma.channel.update({ where: { id: u.id }, data: { config: u.config } });
  }
}
