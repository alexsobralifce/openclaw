import { BadRequestException, ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma } from "@openclaw/database";

const TTL_MS = 24 * 3600 * 1000;
const STALE_MS = 5 * 60 * 1000;

/**
 * Idempotência por chave de API. Com o cabeçalho Idempotency-Key, repetir a mesma
 * requisição devolve a resposta original em vez de executar de novo (ex.: enviar 2x).
 */
@Injectable()
export class IdempotencyService {
  async run<T>(apiKeyId: string, key: string | undefined, body: unknown, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
    if (!key) return { result: await fn(), replayed: false };
    if (!/^[\x21-\x7e]{8,128}$/.test(key)) throw new BadRequestException("Idempotency-Key deve ter de 8 a 128 caracteres visíveis");

    const requestHash = createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
    const now = new Date();
    // limpa registros expirados ou travados desta chave
    await prisma.idempotencyKey.deleteMany({
      where: { apiKeyId, key, OR: [{ expiresAt: { lt: now } }, { status: "IN_PROGRESS", createdAt: { lt: new Date(now.getTime() - STALE_MS) } }] },
    });

    try {
      await prisma.idempotencyKey.create({ data: { apiKeyId, key, requestHash, expiresAt: new Date(now.getTime() + TTL_MS) } });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
      const prev = await prisma.idempotencyKey.findUnique({ where: { apiKeyId_key: { apiKeyId, key } } });
      if (!prev) throw new ConflictException("Tente novamente");
      if (prev.requestHash !== requestHash) throw new UnprocessableEntityException("Idempotency-Key já usada com um corpo diferente");
      if (prev.status === "DONE") return { result: prev.response as T, replayed: true };
      throw new ConflictException("Uma requisição idêntica ainda está em andamento");
    }

    try {
      const result = await fn();
      await prisma.idempotencyKey.update({ where: { apiKeyId_key: { apiKeyId, key } }, data: { status: "DONE", response: result as any } });
      return { result, replayed: false };
    } catch (e) {
      // falhou: libera a chave para permitir nova tentativa
      await prisma.idempotencyKey.delete({ where: { apiKeyId_key: { apiKeyId, key } } }).catch(() => undefined);
      throw e;
    }
  }
}
