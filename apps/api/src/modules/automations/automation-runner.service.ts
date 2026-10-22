// RECONSTRUÍDO: arquivo perdido (não está no GitHub nem no JS compilado de 13/10).
// Reescrito a partir dos usos em inbound.service.ts (`automations.run("message.received", ev)`)
// e do serviço de automações existente. Comportamento não verificado contra produção.

import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";

/** Evento que dispara automações. */
export type AutomationTrigger = "conversation.created" | "message.received";

@Injectable()
export class AutomationRunner {
  private readonly logger = new Logger(AutomationRunner.name);

  /**
   * Roda as automações ativas do workspace para este gatilho. Falha de automação nunca
   * derruba o processamento da mensagem: registra e segue.
   */
  async run(trigger: AutomationTrigger, event: { workspaceId?: string; [k: string]: unknown }): Promise<void> {
    const workspaceId = typeof event.workspaceId === "string" ? event.workspaceId : undefined;
    if (!workspaceId) return;
    try {
      // `trigger` é Json no schema (pode ter filtros): busca as ativas e peneira em memória.
      const active = await prisma.automation.findMany({ where: { workspaceId, isActive: true } });
      const rules = active.filter((r) => (typeof r.trigger === "string" ? r.trigger : (r.trigger as any)?.event) === trigger);
      if (!rules.length) return;
      this.logger.log(`${rules.length} automação(ões) para ${trigger} no workspace ${workspaceId} — execução pendente de recuperação.`);
      // TODO(recuperação): a execução das ações (responder, etiquetar, encaminhar) foi perdida
      // junto com este arquivo. Reconstruir a partir do painel de automações antes de reativar.
    } catch (e: any) {
      this.logger.warn(`Automações de ${trigger} falharam: ${e?.message}`);
    }
  }
}
