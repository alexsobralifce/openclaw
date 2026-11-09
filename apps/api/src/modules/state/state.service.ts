import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma, Prisma } from "@magobox/database";

const CLEANUP_MS = 10 * 60_000;

/**
 * Estado compartilhado com expiração, guardado no Postgres.
 * Sobrevive a reinícios e vale para todas as instâncias da API (ao contrário de Maps em memória).
 */
@Injectable()
export class StateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StateService.name);
  private timer?: NodeJS.Timeout;

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async get<T = any>(key: string): Promise<T | null> {
    const row = await prisma.kvEntry.findUnique({ where: { key } });
    if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    return row.value as T;
  }

  async set(key: string, value: unknown, ttlMs?: number) {
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;
    const v = value as Prisma.InputJsonValue;
    await prisma.kvEntry.upsert({ where: { key }, create: { key, value: v, expiresAt }, update: { value: v, expiresAt } });
  }

  async del(key: string) {
    await prisma.kvEntry.deleteMany({ where: { key } });
  }

  /** Incrementa um contador de forma atômica e devolve o novo valor. */
  async incr(key: string, ttlMs: number): Promise<number> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const rows = await prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO "KvEntry" ("key", "value", "expiresAt") VALUES (${key}, '1'::jsonb, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "value" = CASE WHEN "KvEntry"."expiresAt" <= now() THEN '1'::jsonb
                       ELSE to_jsonb(("KvEntry"."value" #>> '{}')::int + 1) END,
        "expiresAt" = CASE WHEN "KvEntry"."expiresAt" <= now() THEN ${expiresAt} ELSE "KvEntry"."expiresAt" END
      RETURNING ("value" #>> '{}')::int AS value`;
    return Number(rows[0]?.value ?? 1);
  }

  private async cleanup() {
    try {
      await prisma.kvEntry.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    } catch (e: any) {
      this.logger.error(`Limpeza do estado falhou: ${e.message}`);
    }
  }
}
