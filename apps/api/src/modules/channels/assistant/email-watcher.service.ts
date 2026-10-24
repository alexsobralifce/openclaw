import { classifyEmail, isHidden } from "./email-filter";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { GoogleService } from "../../integrations/google/google.service";
import { AssistantService } from "./assistant.service";
import { MenuService } from "./menu.service";
import { WebhooksService } from "../../webhooks/webhooks.service";
import { assistantInstance, can, workspaceCommander } from "./commander";

const INTERVAL_MS = Number(process.env.EMAIL_POLL_SECONDS || 60) * 1000;
const DIGEST_HOURS = [8, 12, 16, 22];
const TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";

/** Último horário de resumo já passado, no fuso do assistente (ex.: "2026-10-24-12"). */
export function digestSlot(now: number): string {
  const at = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { date: `${v("year")}-${v("month")}-${v("day")}`, hour: Number(v("hour")) };
  };
  const today = at(now);
  const h = [...DIGEST_HOURS].reverse().find((x) => x <= today.hour);
  if (h !== undefined) return `${today.date}-${h}`;
  return `${at(now - 24 * 3600_000).date}-22`;
}

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

      // Spam e promoções não avisam nem entram na fila (continuam no Gmail, intactos)
      let hidden = 0;
      for (const m of news) {
        const c = classifyEmail(m);
        if (isHidden(c.kind)) hidden++;
        else fresh.push({ account, id: m.id, de: m.de ?? "", assunto: m.assunto ?? "", at: m.internalDate, kind: c.kind === "auto" ? "auto" : "person" });
      }
      if (hidden) this.logger.log(`${hidden} e-mail(s) de spam/promoção não avisados (${account})`);
      const newest = Math.max(...news.map((m: any) => m.internalDate));
      updates.push({ id: ch.id, config: { ...cfg, lastSeenMs: newest } });
    }

    // Do mais antigo ao mais novo, entre todas as contas
    fresh.sort((a, b) => a.at - b.at);

    // Metadados (sem o corpo) para clientes que assinam email.received
    for (const m of fresh) this.webhooks.emit(workspaceId, "email.received", { account: m.account, id: m.id, from: m.de, subject: m.assunto });

    // E-mails novos vão para o resumo, sem aviso um a um
    if (fresh.length) await this.menu.digestAdd(workspaceId, fresh);

    // Resumo nos horários fixos (8h, 12h, 16h e 22h), mesmo que nenhum e-mail novo tenha chegado nesta volta
    const owner = await workspaceCommander(workspaceId);
    const instance = await assistantInstance(workspaceId);
    if (owner && can(owner, "assistant") && can(owner, "email") && instance) {
      const slot = digestSlot(Date.now());
      const text = await this.menu.digestText(workspaceId, slot);
      if (text) {
        await this.assistant.sendToUser(owner, instance, text);
        await this.menu.digestDone(workspaceId, slot);
      }
    } else if (fresh.length && !instance) {
      this.logger.warn(`Novo e-mail no workspace ${workspaceId}, mas não há WhatsApp para avisar.`);
    }

    // Só avança o ponto de partida depois de tentar avisar
    for (const u of updates) await prisma.channel.update({ where: { id: u.id }, data: { config: u.config } });
  }
}
