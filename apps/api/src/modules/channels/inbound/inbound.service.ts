import { QUOTA_NOTICE, quotaHit, trackUser } from "../assistant/usage";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma, Prisma } from "@openclaw/database";
import { AssistantService } from "../assistant/assistant.service";
import { findCommander, can } from "../assistant/commander";
import { WhatsappWorker } from "../workers/whatsapp.worker";
import { InstagramWorker } from "../workers/instagram.worker";
import { InstagramEvent, parseInstagramWebhook } from "../instagram/parse";
import { AutomationRunner } from "../../automations/automation-runner.service";
import { agendaMedia, commandText, isVoiceOrAudio, locationOf, quotedText, redactText } from "../whatsapp/parse";
import { isGroupOrBroadcast, phoneFromJid, samePhone, senderPhone } from "../whatsapp/phone";

// Retentativas: 5 s, 30 s, 2 min, 10 min, 1 h (depois disso o evento fica FAILED para inspeção)
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const TICK_MS = 2_000;
// Tempo reservado para um evento (transcrição + IA podem demorar); se o processo morrer, outro retoma depois
const CLAIM_MS = 5 * 60_000;
const BATCH = 20;
const KEEP_DONE_DAYS = 7;

// Eventos do Instagram usam "ig:<id da conta>" no lugar do nome da instância do Evolution
const IG_PREFIX = "ig:";

export const nextAttemptDelay = (attempts: number) => BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];

/**
 * Fila de mensagens recebidas do Evolution, guardada no Postgres.
 * O webhook só grava (com deduplicação por instância + id da mensagem) e responde na hora;
 * este worker processa em ordem de chegada, com retentativas.
 */
@Injectable()
export class InboundService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboundService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private lastCleanup = 0;

  constructor(
    private assistant: AssistantService,
    private whatsapp: WhatsappWorker,
    private instagram: InstagramWorker,
    private automations: AutomationRunner,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Grava o evento na fila. Devolve false se não for uma mensagem ou se já estava na fila. */
  async enqueue(instance: string, body: any): Promise<boolean> {
    if (body?.event !== "messages.upsert") return false;
    const id: string | undefined = body?.data?.key?.id;
    if (!id) return false;
    // O arquivo em base64 (se a Evolution mandar) não fica na fila: o assistente baixa a mídia na hora de ler
    if (body.data?.message && "base64" in body.data.message) delete body.data.message.base64;
    const res = await prisma.inboundEvent.createMany({
      data: [{ instance, externalId: id, payload: body as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    if (res.count) void this.tick();
    return res.count > 0;
  }

  /** Grava as mensagens de um webhook do Instagram na mesma fila. Devolve quantas eram novas. */
  async enqueueInstagram(body: any): Promise<number> {
    const events = parseInstagramWebhook(body);
    if (!events.length) return 0;
    const res = await prisma.inboundEvent.createMany({
      data: events.map((e) => ({ instance: `${IG_PREFIX}${e.accountId}`, externalId: e.mid, payload: e as unknown as Prisma.InputJsonValue })),
      skipDuplicates: true,
    });
    if (res.count) void this.tick();
    return res.count;
  }

  private async tick() {
    // Se já estiver rodando, pede mais uma volta ao terminar (o evento novo não espera o próximo intervalo)
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        const due = await prisma.inboundEvent.findMany({
          where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
          orderBy: { createdAt: "asc" },
          take: BATCH,
        });
        for (const ev of due) {
          // Reserva o evento para este processo (evita processamento duplo entre instâncias)
          const claimed = await prisma.inboundEvent.updateMany({
            where: { id: ev.id, status: "PENDING", nextAttemptAt: ev.nextAttemptAt },
            data: { nextAttemptAt: new Date(Date.now() + CLAIM_MS), attempts: { increment: 1 } },
          });
          if (claimed.count) await this.run(ev.id, ev.instance, ev.payload, ev.attempts + 1);
        }
        if (due.length === BATCH) this.again = true;
      } while (this.again);
      await this.cleanup();
    } catch (e: any) {
      this.logger.error(`Fila de entrada falhou: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private async run(id: string, instance: string, payload: any, attempts: number) {
    try {
      const out = await this.process(instance, payload);
      // Mensagem com código do cofre: o texto não fica gravado no registro de entrada
      await prisma.inboundEvent.update({
        where: { id },
        data: { status: "DONE", lastError: null, ...(out && out.redact ? { payload: redactText(payload) as Prisma.InputJsonValue } : {}) },
      });
    } catch (e: any) {
      const error = String(e?.message ?? e).slice(0, 500);
      this.logger.error(`Evento ${id} falhou (tentativa ${attempts}): ${error}`);
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.inboundEvent.update({
        where: { id },
        data: { status: failed ? "FAILED" : "PENDING", lastError: error, nextAttemptAt: new Date(Date.now() + nextAttemptDelay(attempts)) },
      });
    }
  }

  /** Decide se a mensagem é um comando de um usuário para o assistente ou uma mensagem de cliente. */
  private async process(instance: string, body: any): Promise<{ redact?: boolean } | void> {
    if (instance.startsWith(IG_PREFIX)) return this.processInstagram(body as InstagramEvent);
    const data = body?.data;
    if (!data?.key) return;

    const channel = await prisma.channel.findFirst({ where: { config: { path: ["instanceName"], equals: instance } } });
    if (!channel) {
      this.logger.warn(`Canal não encontrado para instance: ${instance}`);
      return;
    }
    if (isGroupOrBroadcast(data.key.remoteJid)) return;

    const phone = senderPhone(data.key);
    const commander = phone ? await findCommander(phone, channel.workspaceId, instance) : null;
    if (commander) {
      if (await this.assistant.isOwnEcho(data.key.id)) return;
      // Mensagens enviadas pelo número conectado para o usuário (respostas, áudios) não são comandos,
      // a não ser que ele use o próprio número conectado ("mensagem para si mesmo").
      if (data.key.fromMe && !samePhone(phoneFromJid(body?.sender), commander.phone)) return;
      if (!can(commander, "assistant")) {
        await this.assistant.sendToUser(commander, instance, "🔒 O assistente não está liberado para sua conta. Fale com o administrador.");
        return;
      }

      // Modo "mensagem para si mesmo": as mensagens do dono também são do número conectado e podem ser apagadas na limpeza
      if (data.key.fromMe) await this.assistant.trackMessage(commander.workspaceId, instance, data.key);

      trackUser({ userId: commander.userId, workspaceId: commander.workspaceId, exempt: commander.role === "ROOT" || commander.role === "ADMIN" });
      let text = commandText(data.message);
      let heard = false;
      if (!text && isVoiceOrAudio(data.message)) {
        // Esperando o código do cofre: áudio não serve (iria para a transcrição de terceiros). Nada é baixado nem enviado.
        if (await this.assistant.awaitingPin(commander.workspaceId)) {
          await this.assistant.sendToUser(commander, instance, "🔢 Por segurança, digite o código de 4 dígitos por *texto*, não por áudio.");
          return;
        }
        try {
          text = await this.assistant.transcribe(instance, data.key);
          heard = true;
        } catch (err: any) {
          this.logger.error(`Transcrição falhou: ${err.message}`);
        }
        if (!text) {
          await this.assistant.sendToUser(commander, instance, quotaHit() ? `Não consegui ouvir o áudio.\n\n${QUOTA_NOTICE}` : "Não consegui entender o áudio. Pode tentar de novo ou escrever?");
          return;
        }
      }
      if (text) {
        const { redact } = await this.assistant.handle(commander, instance, text, { heard, quoted: quotedText(data.message) });
        // No modo "mensagem para si mesmo" dá para apagar também a mensagem do código do chat
        if (redact && data.key.fromMe) await this.assistant.wipeSoon(instance, data.key);
        return { redact };
      }
      // Imagem ou PDF (print de convite, cartaz, post encaminhado): o assistente tenta ler os compromissos
      const media = agendaMedia(data.message);
      if (media) {
        await this.assistant.handleAgendaMedia(commander, instance, data.key, media);
        return;
      }
      // Pin de localização: atualiza onde o dono está (clima do menu)
      const loc = locationOf(data.message);
      if (loc) await this.assistant.handleLocation(commander, instance, loc);
      return;
    }

    if (data.key.fromMe) return;

    const res = await this.whatsapp.process(channel.workspaceId, channel.id, body);
    if (res) await this.fireAutomations(channel.workspaceId, channel.id, res);
  }

  private async processInstagram(ev: InstagramEvent) {
    const res = await this.instagram.process(ev);
    if (res) await this.fireAutomations(res.channel.workspaceId, res.channel.id, res);
  }

  private async fireAutomations(
    workspaceId: string,
    channelId: string,
    res: { conversation: { id: string }; contact: { id: string; name: string; phone: string | null }; message: { body: string; type: string }; newConversation: boolean },
  ) {
    const ev = {
      workspaceId,
      conversation: { id: res.conversation.id, channelId },
      contact: { id: res.contact.id, name: res.contact.name, phone: res.contact.phone },
      message: { body: res.message.body, type: res.message.type },
    };
    if (res.newConversation) await this.automations.run("conversation.created", ev);
    await this.automations.run("message.received", ev);
  }

  private async cleanup() {
    if (Date.now() - this.lastCleanup < 3600_000) return;
    this.lastCleanup = Date.now();
    await prisma.inboundEvent.deleteMany({
      where: { status: "DONE", createdAt: { lt: new Date(Date.now() - KEEP_DONE_DAYS * 864e5) } },
    });
  }
}
