import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@openclaw/database";
import { SCOPES } from "./scopes";
import { limitsFor } from "./plan-limits";

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

@Injectable()
export class ApiKeysService {
  /** Cria uma chave; o valor completo só é devolvido aqui, uma única vez. */
  async create(workspaceId: string, data: { name: string; scopes: string[]; expiresAt?: string; rateLimit?: number }) {
    const invalid = data.scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
    if (invalid.length) throw new BadRequestException(`Escopos inválidos: ${invalid.join(", ")}`);
    if (!data.scopes.length) throw new BadRequestException("Informe ao menos um escopo");

    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { plan: true } });
    const limits = limitsFor(ws.plan);
    const active = await prisma.apiKey.count({ where: { workspaceId, revokedAt: null } });
    if (active >= limits.keys) throw new ForbiddenException(`Seu plano permite até ${limits.keys} chaves ativas. Revogue uma chave ou mude de plano.`);
    if ((data.rateLimit ?? 60) > limits.rateLimit) throw new BadRequestException(`Seu plano permite até ${limits.rateLimit} requisições por minuto por chave`);

    const raw = `oc_live_${randomBytes(32).toString("base64url")}`;
    const key = await prisma.apiKey.create({
      data: {
        workspaceId,
        name: data.name,
        keyHash: hash(raw),
        prefix: raw.slice(0, 12),
        scopes: data.scopes,
        rateLimit: data.rateLimit ?? 60,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
    return { ...this.view(key), key: raw };
  }

  async list(workspaceId: string) {
    const keys = await prisma.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    return keys.map((k) => this.view(k));
  }

  async revoke(workspaceId: string, id: string) {
    const res = await prisma.apiKey.updateMany({ where: { id, workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!res.count) throw new NotFoundException("Chave não encontrada");
    return { ok: true };
  }

  /** Retorna a chave válida (não revogada, não expirada) ou null. */
  async validate(raw: string) {
    return prisma.apiKey.findFirst({
      where: {
        keyHash: hash(raw),
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  touch(id: string) {
    return prisma.apiKey.update({ where: { id }, data: { lastUsed: new Date() } }).catch(() => undefined);
  }

  private view(k: any) {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      rateLimit: k.rateLimit,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      lastUsed: k.lastUsed,
      createdAt: k.createdAt,
    };
  }
}
