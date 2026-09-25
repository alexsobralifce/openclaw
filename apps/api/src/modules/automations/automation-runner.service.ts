import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { EvolutionService } from "../channels/evolution/evolution.service";
import { InboxService } from "../inbox/inbox.service";
import { StateService } from "../state/state.service";
import { assistantInstance, can, ECHO_TTL_MS, echoKey, workspaceCommander } from "../channels/assistant/commander";
import { effectiveServices } from "../auth/permissions";
import { Action, render, ruleMatches, Trigger, TriggerEvent } from "./rules";

const TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";

export interface AutomationEvent {
  workspaceId: string;
  conversation: { id: string; channelId: string };
  contact: { id: string; name: string; phone: string | null };
  message: { body: string; type: string };
}

/** Executa as automações ativas do workspace para eventos de entrada. */
@Injectable()
export class AutomationRunner {
  private readonly logger = new Logger(AutomationRunner.name);

  constructor(
    private evolution: EvolutionService,
    private inbox: InboxService,
    private state: StateService,
  ) {}

  /** Nunca lança: falhas ficam registradas na própria automação (lastError). */
  async run(event: TriggerEvent, ev: AutomationEvent) {
    try {
      const owner = await prisma.workspaceMember.findFirst({ where: { workspaceId: ev.workspaceId, role: "OWNER" }, include: { user: true } });
      if (!owner || owner.user.status !== "ACTIVE" || !effectiveServices(owner.user.role, owner.user.services).includes("automations")) return;

      const rules = await prisma.automation.findMany({ where: { workspaceId: ev.workspaceId, isActive: true }, orderBy: { createdAt: "asc" } });
      const ctx = { message: ev.message, channelId: ev.conversation.channelId, now: new Date(), timeZone: TZ };
      for (const rule of rules) {
        const trigger = rule.trigger as unknown as Trigger;
        if (!ruleMatches(trigger, event, ctx)) continue;
        const cooldownKey = `auto:${rule.id}:${ev.conversation.id}`;
        if (trigger.cooldownMinutes && (await this.state.get(cooldownKey))) continue;
        if (trigger.cooldownMinutes) await this.state.set(cooldownKey, 1, trigger.cooldownMinutes * 60_000);

        let error: string | null = null;
        for (const action of rule.actions as unknown as Action[]) {
          try {
            await this.apply(action, ev);
          } catch (e: any) {
            error = `${action.type}: ${String(e.message ?? e).slice(0, 200)}`;
            this.logger.error(`Automação ${rule.id} falhou em ${error}`);
            break;
          }
        }
        await prisma.automation.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date(), lastError: error } });
      }
    } catch (e: any) {
      this.logger.error(`Automações do workspace ${ev.workspaceId} falharam: ${e.message}`);
    }
  }

  private async apply(a: Action, ev: AutomationEvent) {
    const vars = { name: ev.contact.name, phone: ev.contact.phone };
    switch (a.type) {
      case "send_message": {
        const channel = await prisma.channel.findUniqueOrThrow({ where: { id: ev.conversation.channelId } });
        const instance = (channel.config as any)?.instanceName;
        if (channel.type !== "WHATSAPP" || !instance || !ev.contact.phone) throw new Error("canal da conversa não permite envio automático");
        const text = render(a.text, vars);
        const res = await this.evolution.sendText(instance, ev.contact.phone, text);
        await this.inbox.recordOutbound(ev.workspaceId, ev.conversation.id, text, res?.key?.id, undefined, { automation: true });
        return;
      }
      case "set_status":
        await this.inbox.updateStatus(ev.workspaceId, ev.conversation.id, a.status);
        return;
      case "add_tag": {
        const tag = await prisma.tag.upsert({
          where: { workspaceId_name: { workspaceId: ev.workspaceId, name: a.tag } },
          create: { workspaceId: ev.workspaceId, name: a.tag },
          update: {},
        });
        await prisma.contactTag.upsert({
          where: { contactId_tagId: { contactId: ev.contact.id, tagId: tag.id } },
          create: { contactId: ev.contact.id, tagId: tag.id },
          update: {},
        });
        return;
      }
      case "assign": {
        const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: ev.workspaceId, userId: a.userId } });
        if (!member) throw new Error("usuário não pertence ao workspace");
        await prisma.conversationAssignee.upsert({
          where: { conversationId_userId: { conversationId: ev.conversation.id, userId: a.userId } },
          create: { conversationId: ev.conversation.id, userId: a.userId },
          update: {},
        });
        return;
      }
      case "notify_owner": {
        const owner = await workspaceCommander(ev.workspaceId);
        const instance = await assistantInstance(ev.workspaceId);
        if (!owner || !instance || !can(owner, "assistant")) throw new Error("dono sem WhatsApp cadastrado ou sem o serviço de assistente");
        const text = `🤖 *Automação*\n${render(a.text, vars)}\n👤 ${ev.contact.name}: _${ev.message.body.slice(0, 200)}_`;
        const res = await this.evolution.sendText(instance, owner.phone, text);
        if (res?.key?.id) await this.state.set(echoKey(res.key.id), 1, ECHO_TTL_MS);
        return;
      }
    }
  }
}
