import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { sealField } from "../webhooks/crypto";

const BATCH = 200;
const START_DELAY_MS = 60_000; // deixa o boot terminar antes de mexer no banco
const PAUSE_MS = 250;

// Texto já cifrado começa com um destes prefixos (ver `sealText`)
const SEALED = ["chat1:", "chat2:"];
const notSealed = (field: string) => ({ AND: SEALED.map((p) => ({ NOT: { [field]: { startsWith: p } } })) });
const isSealedValue = (v: string) => SEALED.some((p) => v.startsWith(p));
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

/**
 * Cifra, em segundo plano e em lotes, o que foi gravado antes da cifra de mensagens, memórias e notas em lista.
 * A leitura já aceita os dois formatos, então isto só fecha a lacuna dos registros antigos. Depois de rodar uma vez,
 * as próximas execuções acham zero linhas. Cada atualização confere o valor lido (`updateMany` com o texto antigo),
 * então não atropela uma edição que aconteça no meio.
 */
@Injectable()
export class EncryptionBackfillService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionBackfillService.name);

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.ENCRYPTION_BACKFILL === "off") return;
    setTimeout(() => this.run().catch((e) => this.logger.error(`Cifra dos registros antigos falhou: ${e.message}`)), START_DELAY_MS).unref();
  }

  async run() {
    const done = { mensagens: await this.messages(), memorias: await this.memories(), notas: await this.notes() };
    if (done.mensagens || done.memorias || done.notas) {
      this.logger.warn(`Registros antigos passaram a ser guardados cifrados: ${done.mensagens} mensagem(ns), ${done.memorias} memória(s), ${done.notas} nota(s)`);
    }
    return done;
  }

  async messages(): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await prisma.message.findMany({
        where: notSealed("body"),
        select: { id: true, body: true, conversation: { select: { workspaceId: true } } },
        take: BATCH,
      });
      if (!rows.length) return total;
      let changed = 0;
      for (const r of rows) {
        const res = await prisma.message.updateMany({ where: { id: r.id, body: r.body }, data: { body: sealField(r.body, r.conversation.workspaceId) } });
        changed += res.count;
      }
      total += changed;
      if (!changed) return total; // nada avançou (disputa com edição): tenta de novo no próximo boot
      await pause();
    }
  }

  async memories(): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await prisma.memory.findMany({ where: notSealed("content"), select: { id: true, content: true, workspaceId: true }, take: BATCH });
      if (!rows.length) return total;
      let changed = 0;
      for (const r of rows) {
        const res = await prisma.memory.updateMany({ where: { id: r.id, content: r.content }, data: { content: sealField(r.content, r.workspaceId) } });
        changed += res.count;
      }
      total += changed;
      if (!changed) return total;
      await pause();
    }
  }

  async notes(): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await prisma.listNote.findMany({ where: notSealed("title"), select: { id: true, title: true, items: true, workspaceId: true }, take: BATCH });
      if (!rows.length) return total;
      let changed = 0;
      for (const r of rows) {
        const items = typeof r.items === "string" && isSealedValue(r.items) ? r.items : sealField(JSON.stringify(r.items ?? []), r.workspaceId);
        const res = await prisma.listNote.updateMany({ where: { id: r.id, title: r.title }, data: { title: sealField(r.title, r.workspaceId), items } });
        changed += res.count;
      }
      total += changed;
      if (!changed) return total;
      await pause();
    }
  }
}
