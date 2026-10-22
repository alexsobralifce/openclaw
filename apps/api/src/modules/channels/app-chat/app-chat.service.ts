// RECONSTRUÍDO: este arquivo foi perdido (nunca entrou no GitHub e não está no JS compilado do
// deploy de 13/10). Foi reescrito a partir do modelo AppMessage do Prisma, do contrato que o front
// consome (apps/web/src/lib/api.ts: ChatMessage) e dos usos no app-chat.controller.
// Comportamento não verificado contra produção: testar o chat do app antes de confiar nele.

import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { openField, sealField } from "../../webhooks/crypto";
import { Commander } from "../assistant/commander";
import { AppChatGateway } from "./app-chat.gateway";

/** Quanto tempo uma mensagem com segredo (senha do cofre) fica visível no chat. */
const SECRET_TTL_MS = 60_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Arquivo do Drive listado dentro de uma mensagem do chat (o usuário escolhe pelo número). */
export interface DriveListItem {
  id: string;
  account: string;
  nome: string;
  tipo: string;
  tamanho: number;
}

export interface AppChatMeta {
  fileId?: string;
  fileName?: string;
  mime?: string;
  size?: number;
  seconds?: number;
  files?: DriveListItem[];
}

export interface AppChatMessage {
  id: string;
  direction: "IN" | "OUT";
  kind: string;
  text: string;
  meta: AppChatMeta | null;
  createdAt: string;
}

@Injectable()
export class AppChatService {
  private readonly logger = new Logger(AppChatService.name);

  constructor(private gateway: AppChatGateway) {}

  /** O corpo é cifrado no banco, com o workspace como escopo (mesma regra dos outros campos sensíveis). */
  private view(row: { id: string; direction: string; kind: string; body: string; meta: unknown; createdAt: Date; workspaceId: string }): AppChatMessage {
    let text = "";
    try {
      text = openField(row.body, row.workspaceId);
    } catch {
      text = "";
      this.logger.warn(`Mensagem ${row.id} não pôde ser decifrada (WEBHOOK_SECRET mudou?).`);
    }
    return {
      id: row.id,
      direction: row.direction === "OUT" ? "OUT" : "IN",
      kind: row.kind,
      text,
      meta: (row.meta as AppChatMeta | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Histórico do usuário, do mais antigo para o mais novo; `after` continua de uma mensagem já vista. */
  async list(userId: string, workspaceId: string, opts: { after?: string; limit?: number } = {}): Promise<AppChatMessage[]> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const since = opts.after ? await prisma.appMessage.findFirst({ where: { id: opts.after, userId }, select: { createdAt: true } }) : null;
    const rows = await prisma.appMessage.findMany({
      where: {
        userId,
        workspaceId,
        ...(since ? { createdAt: { gt: since.createdAt } } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: since ? "asc" : "desc" },
      take: limit,
    });
    const ordered = since ? rows : rows.reverse();
    return ordered.map((r) => this.view(r));
  }

  /** Grava uma mensagem e avisa o app aberto na hora. */
  async store(c: Commander, direction: "IN" | "OUT", kind: string, text: string, meta?: AppChatMeta, expiresAt?: Date): Promise<AppChatMessage> {
    const row = await prisma.appMessage.create({
      data: {
        workspaceId: c.workspaceId,
        userId: c.userId,
        direction,
        kind,
        body: sealField(text, c.workspaceId),
        meta: (meta ?? undefined) as any,
        expiresAt: expiresAt ?? null,
      },
    });
    const msg = this.view(row);
    this.gateway.emit(c.userId, "chat:message", msg);
    return msg;
  }

  /** Resposta do assistente para o app. */
  async deliver(c: Commander, text: string, meta?: AppChatMeta): Promise<AppChatMessage> {
    return this.store(c, "OUT", "TEXT", text, meta);
  }

  /** Mensagem com segredo: marca para desaparecer e avisa o app. */
  async redact(messageId: string, c: Commander): Promise<void> {
    const expiresAt = new Date(Date.now() + SECRET_TTL_MS);
    await prisma.appMessage.updateMany({ where: { id: messageId, userId: c.userId }, data: { expiresAt } });
    this.gateway.emit(c.userId, "chat:redacted", { id: messageId, expiresAt: expiresAt.toISOString() });
  }

  /** "Digitando…" no app enquanto o assistente pensa. */
  typing(userId: string, on: boolean): void {
    this.gateway.emit(userId, "chat:typing", { on });
  }

  /** O app do usuário está aberto agora? Quem não está recebe notificação push. */
  online(userId: string): Promise<boolean> {
    return this.gateway.online(userId);
  }

  /** Limpeza das mensagens com segredo já vencidas. */
  async purgeExpired(now = new Date()): Promise<number> {
    const r = await prisma.appMessage.deleteMany({ where: { expiresAt: { lte: now } } });
    return r.count;
  }

  /**
   * Arquivo anexado a uma mensagem do chat, para download.
   * DESATIVADO NA RECUPERAÇÃO: o armazenamento do anexo vinha do trecho perdido.
   */
  async file(_userId: string, _messageId: string): Promise<{ mime: string; nome: string; bytes: Buffer } | null> {
    this.logger.warn("Recurso em recuperação acionado: download de anexo do chat");
    return null;
  }

}
