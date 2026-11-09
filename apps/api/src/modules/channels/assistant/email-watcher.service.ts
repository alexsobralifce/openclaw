import { classifyEmail, isHidden } from "./email-filter";
import { Inject, Injectable, Logger, forwardRef } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { GoogleService } from "../../integrations/google/google.service";
import { AssistantService } from "./assistant.service";
import { MenuService } from "./menu.service";
import { WebhooksService } from "../../webhooks/webhooks.service";
import { assistantInstance, can, workspaceCommander } from "./commander";
import { loadMute } from "./email-mute";
import { channelOfInstance } from "./channel-route";
import { StateService } from "../../state/state.service";
import { notifyOn } from "./notify-prefs";

/** Intervalo mínimo entre duas conferências do mesmo workspace (pedidos mais seguidos reaproveitam a última). */
const MIN_CHECK_MS = 30_000;

@Injectable()
export class EmailWatcherService {
  private readonly logger = new Logger(EmailWatcherService.name);
  private readonly running = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();

  constructor(
    private google: GoogleService,
    private assistant: AssistantService,
    @Inject(forwardRef(() => MenuService)) private menu: MenuService,
    private webhooks: WebhooksService,
    private state: StateService,
  ) {}

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

  /**
   * Confere os e-mails novos de um workspace e avisa, só quando o usuário pede (abrir a tela de e-mails ou o comando
   * "verificar e-mails"). Não há timer: nada roda sozinho. Um workspace não roda duas vezes ao mesmo tempo e não roda
   * de novo antes de 30 s. Erros são registrados aqui e não chegam a quem pediu.
   */
  checkNow(workspaceId: string): Promise<void> {
    const inFlight = this.running.get(workspaceId);
    if (inFlight) return inFlight;
    const last = this.lastStart.get(workspaceId);
    if (last !== undefined && Date.now() - last < MIN_CHECK_MS) return Promise.resolve();
    this.lastStart.set(workspaceId, Date.now());
    const job = this.runWorkspace(workspaceId)
      .then(() => {
        this.lastFailure.delete(workspaceId);
      })
      .catch((e) => this.logFailure(workspaceId, e))
      .finally(() => this.running.delete(workspaceId));
    this.running.set(workspaceId, job);
    return job;
  }

  private async runWorkspace(workspaceId: string) {
    const channels = await prisma.channel.findMany({
      where: { workspaceId, type: "EMAIL", config: { path: ["provider"], equals: "google" } },
    });
    if (channels.length) await this.checkWorkspace(workspaceId, channels);
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

    // Os mais recentes primeiro, entre todas as contas
    fresh.sort((a, b) => b.at - a.at);

    // Metadados (sem o corpo) para clientes que assinam email.received
    for (const m of fresh) this.webhooks.emit(workspaceId, "email.received", { account: m.account, id: m.id, from: m.de, subject: m.assunto });

    if (fresh.length) {
      // Avisa o dono do workspace, se ele tiver WhatsApp cadastrado e os serviços liberados
      const owner = await workspaceCommander(workspaceId);
      const instance = await assistantInstance(workspaceId);
      if (owner && can(owner, "assistant") && can(owner, "email") && instance) {
        // No app (web e celular) não há mensagem: o e-mail entra na fila e o menu mostra quantos não lidos há
        // Avisos de e-mail desligados no menu: a fila e o contador continuam, só não há push nem mensagem
        const loud = await notifyOn(this.state, workspaceId, "email");
        if (channelOfInstance(instance) === "app") await this.assistant.notifyUnread(owner, await this.menu.enqueueNew(workspaceId, fresh), loud);
        else if (loud) await this.assistant.sendToUser(owner, instance, await this.menu.notifyNew(workspaceId, fresh));
        else await this.menu.enqueueNew(workspaceId, fresh);
      } else if (!instance) {
        this.logger.warn(`Novo e-mail no workspace ${workspaceId}, mas não há WhatsApp para avisar.`);
      }
    }

    // Só avança o ponto de partida depois de tentar avisar
    for (const u of updates) await prisma.channel.update({ where: { id: u.id }, data: { config: u.config } });
  }
}
