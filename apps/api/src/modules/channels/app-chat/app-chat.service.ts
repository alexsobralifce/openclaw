import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { randomBytes } from "crypto";
import { StateService } from "../../state/state.service";
import { openText, sealText } from "../../webhooks/crypto";
import { Commander } from "../assistant/commander";
import { AppChatGateway } from "./app-chat.gateway";
import { PushService } from "./push.service";

/** Quantos dias o histórico do chat fica guardado (APP_CHAT_RETENTION_DAYS, padrão 30). */
export const retentionDays = () => {
  const n = Math.trunc(Number(process.env.APP_CHAT_RETENTION_DAYS));
  return Number.isFinite(n) && n > 0 ? n : 30;
};

/** Arquivos enviados pelo assistente ao app ficam disponíveis por pouco tempo e têm teto de tamanho. */
export const FILE_TTL_MS = 60 * 60_000;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/** Arquivo de uma lista do Drive mostrada no chat: o app baixa na hora, direto do Drive (sem guardar cópia). */
export interface DriveListItem {
  id: string;
  account: string;
  nome: string;
  tipo: string;
  tamanho: number;
}

const MAX_LISTED_FILES = 8;

export interface ChatView {
  id: string;
  direction: "IN" | "OUT";
  kind: string;
  text: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** Texto curto e sem marcação para a notificação; mensagem com segredo nunca mostra o conteúdo. */
export function pushPreview(text: string, secret = false): string {
  if (secret) return "Nova mensagem do MagoBox (conteúdo protegido, abra o app).";
  const flat = text.replace(/[*_~`]/g, "").replace(/[━─]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 110 ? `${flat.slice(0, 109)}…` : flat || "Nova mensagem do MagoBox";
}

@Injectable()
export class AppChatService {
  private readonly logger = new Logger(AppChatService.name);

  constructor(private state: StateService, private gateway: AppChatGateway, private push: PushService) {}

  private view(m: any, workspaceId: string): ChatView {
    let text: string;
    try {
      text = openText(m.body, workspaceId);
    } catch {
      text = "[mensagem ilegível]";
    }
    return { id: m.id, direction: m.direction, kind: m.kind, text, meta: (m.meta as any) ?? null, createdAt: m.createdAt.toISOString() };
  }

  /** Guarda uma mensagem do chat, cifrada em repouso com a chave do workspace. */
  async store(c: Commander, direction: "IN" | "OUT", kind: string, text: string, meta?: Record<string, unknown>, expiresAt?: Date): Promise<ChatView> {
    const row = await prisma.appMessage.create({
      data: { workspaceId: c.workspaceId, userId: c.userId, direction, kind, body: sealText(text, c.workspaceId), meta: (meta as any) ?? undefined, expiresAt },
    });
    return this.view(row, c.workspaceId);
  }

  /** Mensagem do assistente para o usuário: guarda, entrega em tempo real e, se o app estiver fechado, avisa por notificação. */
  async deliver(c: Commander, text: string, opts: { wipeAfterMs?: number; file?: { nome: string; mime: string; base64: string }; files?: DriveListItem[] } = {}): Promise<ChatView> {
    let kind = "TEXT";
    let meta: Record<string, unknown> | undefined;
    if (opts.file) {
      const size = Math.floor(opts.file.base64.length * 0.75);
      if (size > MAX_FILE_BYTES) {
        text = `${text}\n\n📎 O arquivo *${opts.file.nome}* é grande demais para o app (${Math.round(size / 1024 / 1024)} MB; o limite é ${MAX_FILE_BYTES / 1024 / 1024} MB). Abra-o direto no Drive.`.trim();
      } else {
        const fileId = randomBytes(12).toString("hex");
        await this.state.set(`appfile:${fileId}`, { userId: c.userId, nome: opts.file.nome, mime: opts.file.mime, base64: opts.file.base64 }, FILE_TTL_MS);
        kind = "FILE";
        meta = { fileId, fileName: opts.file.nome, mime: opts.file.mime, size };
      }
    }
    if (!opts.file && opts.files?.length) {
      meta = { files: opts.files.slice(0, MAX_LISTED_FILES).map((f) => ({ id: f.id.slice(0, 100), account: f.account.slice(0, 120), nome: f.nome.slice(0, 120), tipo: f.tipo.slice(0, 80), tamanho: f.tamanho })) };
    }
    const view = await this.store(c, "OUT", kind, text, meta, opts.wipeAfterMs ? new Date(Date.now() + opts.wipeAfterMs) : undefined);
    this.gateway.emit(c.userId, "chat:typing", { on: false });
    this.gateway.emit(c.userId, "chat:message", view);
    if (!(await this.gateway.online(c.userId))) {
      this.push.notify(c.userId, { title: "MagoBox", body: pushPreview(text, !!opts.wipeAfterMs), url: "/dashboard/chat" }).catch((e) => this.logger.warn(`Push falhou: ${e.message}`));
    }
    return view;
  }

  typing(userId: string, on: boolean) {
    this.gateway.emit(userId, "chat:typing", { on });
  }

  /** Troca o texto de uma mensagem do usuário por pontos (ex.: o código do cofre digitado no chat). */
  async redact(id: string, c: Commander) {
    await prisma.appMessage.updateMany({ where: { id, userId: c.userId }, data: { body: sealText("••••", c.workspaceId) } });
    this.gateway.emit(c.userId, "chat:redacted", { id });
  }

  /** Apaga as mensagens com segredo que já venceram e as mais antigas que o prazo de retenção. */
  async prune(userId: string) {
    const cutoff = new Date(Date.now() - retentionDays() * 86_400_000);
    await prisma.appMessage.deleteMany({ where: { userId, OR: [{ expiresAt: { lt: new Date() } }, { createdAt: { lt: cutoff } }] } });
  }

  /** Histórico: as últimas `limit` mensagens, ou as posteriores a `after` (para o app buscar só o que é novo). */
  async list(userId: string, workspaceId: string, opts: { after?: string; limit?: number } = {}): Promise<ChatView[]> {
    await this.prune(userId);
    const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
    const after = opts.after ? new Date(opts.after) : null;
    if (after && !Number.isNaN(after.getTime())) {
      const rows = await prisma.appMessage.findMany({ where: { userId, createdAt: { gt: after } }, orderBy: { createdAt: "asc" }, take: limit });
      return rows.map((m) => this.view(m, workspaceId));
    }
    const rows = await prisma.appMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.reverse().map((m) => this.view(m, workspaceId));
  }

  /** Arquivo de uma mensagem; só o dono dele lê. */
  async file(userId: string, fileId: string): Promise<{ nome: string; mime: string; bytes: Buffer } | null> {
    if (!/^[a-f0-9]{24}$/.test(fileId)) return null;
    const f = await this.state.get<{ userId: string; nome: string; mime: string; base64: string }>(`appfile:${fileId}`);
    if (!f || f.userId !== userId) return null;
    return { nome: f.nome, mime: f.mime, bytes: Buffer.from(f.base64, "base64") };
  }
}
