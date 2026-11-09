import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { StateService } from "../../state/state.service";
import { AssistantService } from "./assistant.service";
import { MenuService } from "./menu.service";
import { assistantInstance, Commander, workspaceCommander } from "./commander";
import { claimReminder, dueReminders, updateNote } from "./list-notes-store";
import { AssistantConfig, CLEAN_MIN_AGE_MS, configKey, idleKey } from "./chat-clean";

import { EventReminder, eventReminderText, notifyOn } from "./notify-prefs";

const TICK_MS = 20_000;
const TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";
/** Lembrete que falhou no envio (WhatsApp fora do ar, por exemplo) é tentado de novo até esta idade; depois disso desiste. */
const REMINDER_RETRY_MS = 6 * 3_600_000;

/**
 * Tarefas de fundo do assistente, lidas do banco (sobrevivem a reinícios e a mais de uma instância):
 * - volta ao menu principal quando o dono não responde a tempo;
 * - limpa as mensagens do chat no intervalo que ele escolheu em Configurações;
 * - manda os lembretes das notas na data e hora marcadas.
 */
@Injectable()
export class AssistantSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private assistant: AssistantService,
    private menu: MenuService,
    private state: StateService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.wipeDue(now);
      await this.returnIdle(now);
      await this.cleanDue(now);
      await this.remindersDue(now);
      await this.eventRemindersDue(now);
    } catch (e: any) {
      this.logger.error(`Tarefas do assistente falharam: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private async live(prefix: string, now: number) {
    const rows = await prisma.kvEntry.findMany({ where: { key: { startsWith: prefix } } });
    return rows.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now);
  }

  /** Apaga do chat as respostas com senha que já passaram do prazo. */
  private async wipeDue(now: number) {
    for (const r of await this.live("wipe:", now)) {
      const v = r.value as { due?: number; instance?: string; key?: { id: string; remoteJid: string; fromMe: boolean } } | null;
      if (!v?.due || v.due > now || !v.instance || !v.key) continue;
      try {
        if (await this.assistant.wipeMessage(v.instance, v.key)) await this.state.del(r.key);
      } catch (e: any) {
        this.logger.warn(`Apagar resposta com senha falhou: ${e.message}`);
      }
    }
  }

  private async returnIdle(now: number) {
    for (const r of await this.live("idle:", now)) {
      const v = r.value as { due?: number; instance?: string; c?: Commander } | null;
      if (!v?.due || v.due > now) continue;
      // Apaga antes de agir: mesmo que o envio falhe, o aviso nunca se repete
      await this.state.del(r.key);
      if (!v.c || !v.instance) continue;
      try {
        const text = await this.menu.idleReturn(r.key.slice("idle:".length));
        if (text) await this.assistant.sendToUser(v.c, v.instance, text);
      } catch (e: any) {
        this.logger.warn(`Retorno ao menu falhou (${r.key}): ${e.message}`);
      }
    }
  }

  /** Lembretes de compromissos da agenda, escolhidos por quem agendou. Apaga a reserva antes de enviar: nunca repete. */
  private async eventRemindersDue(now: number) {
    for (const row of await this.live("evrem:", now)) {
      const r = row.value as EventReminder | null;
      if (!r?.at || r.at > now) continue;
      await this.state.del(row.key);
      const ws = row.key.split(":")[1];
      try {
        if (!(await notifyOn(this.state, ws, "agenda"))) continue;
        const owner = await workspaceCommander(ws);
        const instance = owner ? await assistantInstance(ws, owner) : null;
        if (owner && instance) await this.assistant.sendToUser(owner, instance, eventReminderText(r, TZ));
        else this.logger.warn(`Lembrete de evento: sem canal para avisar o workspace ${ws}.`);
      } catch (e: any) {
        this.logger.warn(`Lembrete de evento falhou: ${e.message}`);
      }
    }
  }

  /** Manda a nota como lembrete. Reserva o envio antes (nunca repete); se o envio falha, devolve a vez por algumas horas. */
  private async remindersDue(now: number) {
    for (const n of await dueReminders(new Date(now))) {
      if (!n.remindAt || !(await claimReminder(n.id, n.remindAt, new Date(now)))) continue;
      if (!(await notifyOn(this.state, n.workspaceId, "notes"))) continue; // avisos de notas desligados: o lembrete é descartado
      let sent = false;
      try {
        const owner = await workspaceCommander(n.workspaceId);
        const instance = owner ? await assistantInstance(n.workspaceId, owner) : null;
        if (owner && instance) {
          await this.assistant.sendToUser(owner, instance, this.menu.reminderText(n));
          sent = true;
        } else {
          this.logger.warn(`Lembrete da nota ${n.id}: sem canal para avisar o workspace ${n.workspaceId}.`);
        }
      } catch (e: any) {
        this.logger.warn(`Lembrete da nota ${n.id} falhou: ${e.message}`);
      }
      // Não enviou e ainda está na janela: solta a reserva para tentar na próxima volta
      if (!sent && now - n.remindAt.getTime() < REMINDER_RETRY_MS) await updateNote(n.workspaceId, n.id, { remindAt: n.remindAt });
    }
  }

  private async cleanDue(now: number) {
    for (const r of await this.live("cfg:", now)) {
      const cfg = r.value as AssistantConfig | null;
      if (!cfg?.cleanMinutes || cfg.cleanMinutes <= 0) continue;
      const ws = r.key.slice("cfg:".length);
      const next = now + cfg.cleanMinutes * 60_000;
      if (!cfg.nextCleanAt) {
        await this.state.set(configKey(ws), { ...cfg, nextCleanAt: next });
        continue;
      }
      if (cfg.nextCleanAt > now) continue;
      // O dono está conversando agora (retorno ao menu ainda pendente): tenta na próxima volta
      if (await this.state.get(idleKey(ws))) continue;
      try {
        await this.assistant.cleanChat(ws, CLEAN_MIN_AGE_MS);
      } catch (e: any) {
        this.logger.warn(`Limpeza do chat falhou (${ws}): ${e.message}`);
      }
      await this.state.set(configKey(ws), { ...cfg, nextCleanAt: next });
    }
  }
}
