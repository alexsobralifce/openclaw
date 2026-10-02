import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { isSealed, openToken, sealToken } from "../../webhooks/crypto";
import { nextDay } from "../../channels/assistant/agenda-events";
import { DriveKind, KIND_Q, wordVariants } from "../../channels/assistant/drive";
import { CONTACTS_FOLDER, Contact, fileOfLetter, findContacts, fromPerson, groupByLetter, parseLetterFile, renderLetterFile } from "../../channels/assistant/contacts";
import { appendEntry, dailyFileName, dayStamp, formatEntry, NOTES_FOLDER, snippets } from "../../channels/assistant/notes";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  // Lê qualquer arquivo (buscar e baixar), mas só grava nos arquivos que ele mesmo criou (notas em Assist.IA/); nunca apaga
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  // Só leitura dos contatos: viram arquivos Markdown por letra em Assist.IA/Contatos (importados na primeira conexão)
  "https://www.googleapis.com/auth/contacts.readonly",
  "openid",
  "email",
];

/** Nota maior que isto não é lida inteira (busca) nem recebe mais linhas. */
const NOTE_MAX_BYTES = 1024 * 1024;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const CONTACTS_TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";
/** Quanto tempo a lista de contatos lida do Drive fica em memória (as consultas seguidas não baixam tudo de novo). */
const CONTACTS_CACHE_MS = 5 * 60_000;
export interface NoteHit {
  id: string;
  nome: string;
  modificado?: string;
  link?: string;
  trechos: string[];
}

/** Limite de envio pelo WhatsApp (o arquivo passa em base64 pela Evolution API). */
export const DRIVE_MAX_BYTES = 15 * 1024 * 1024;
/** Arquivo pronto para enviar (base64) ou, quando não dá, o motivo e o link. */
export interface DriveFileResult {
  nome: string;
  mime: string;
  link?: string;
  base64?: string;
  motivo?: string;
}
const DRIVE_EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
};

const SIGNAL_HEADERS = new Set(["list-unsubscribe", "precedence", "auto-submitted", "x-spam-flag", "x-spam-status", "authentication-results"]);
const GMAIL_HEADERS = ["From", "Subject", "Date", "List-Unsubscribe", "Precedence", "Auto-Submitted", "X-Spam-Flag", "X-Spam-Status", "Authentication-Results"];

@Injectable()
export class GoogleService implements OnModuleInit {
  private readonly logger = new Logger(GoogleService.name);
  /** Pasta de notas por conta (só acelera: se o processo reiniciar, é uma busca a mais). */
  private noteFolders = new Map<string, string>();
  /** Fila por conta: ler-acrescentar-gravar duas notas ao mesmo tempo perderia uma delas. */
  private noteLocks = new Map<string, Promise<unknown>>();
  /** Contatos lidos do Drive por conta (consulta rápida). */
  private contactCache = new Map<string, { at: number; contacts: Contact[] }>();

  /** Cifra os refresh tokens que ainda estão em texto puro (contas conectadas antes da cifragem). */
  async onModuleInit() {
    try {
      const chs = await prisma.channel.findMany({ where: { type: "EMAIL", config: { path: ["provider"], equals: "google" } } });
      let migrated = 0;
      for (const ch of chs) {
        const cfg = ch.config as any;
        if (!cfg?.refreshToken || isSealed(cfg.refreshToken)) continue;
        await prisma.channel.update({ where: { id: ch.id }, data: { config: { ...cfg, refreshToken: sealToken(cfg.refreshToken) } } });
        migrated++;
      }
      if (migrated) this.logger.warn(`${migrated} token(s) do Google passaram a ser guardados cifrados`);
    } catch (e: any) {
      this.logger.error(`Migração dos tokens do Google falhou: ${e.message}`);
    }
  }
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  private get clientId() { return process.env.GOOGLE_CLIENT_ID || ""; }
  private get clientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ""; }
  private get redirectUri() {
    return process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/v1/integrations/google/callback";
  }

  isConfigured() {
    return !!this.clientId && !this.clientId.startsWith("...") && !!this.clientSecret && this.clientSecret !== "...";
  }

  authUrl(state: string) {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent select_account",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...params }),
    });
    if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
    return (await res.json()) as any;
  }

  async connect(workspaceId: string, code: string) {
    const t = await this.tokenRequest({
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });
    if (!t.refresh_token) throw new Error("Google não retornou refresh_token. Remova o acesso do app na conta Google e tente de novo.");

    const info: any = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    }).then((r) => r.json());
    const email: string = info.email ?? "google";

    const existing = await this.findChannel(workspaceId, email);
    // Mantém o que já estava no canal (ex.: contactsSyncedAt) ao reconectar
    const config = { ...((existing?.config as object | undefined) ?? {}), provider: "google", email, refreshToken: sealToken(t.refresh_token) };
    if (existing) {
      await prisma.channel.update({ where: { id: existing.id }, data: { name: `Google (${email})`, config } });
    } else {
      await prisma.channel.create({
        data: { workspaceId, name: `Google (${email})`, type: "EMAIL", config },
      });
    }
    if (existing) this.tokenCache.delete(existing.id);
    // Primeira vez com contatos: importa em segundo plano, sem segurar a volta do OAuth
    void this.importContactsOnce(workspaceId, email);
    return email;
  }

  private async findChannel(workspaceId: string, email?: string) {
    return prisma.channel.findFirst({
      where: {
        workspaceId,
        type: "EMAIL",
        AND: [
          { config: { path: ["provider"], equals: "google" } },
          ...(email ? [{ config: { path: ["email"], equals: email } }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async listAccounts(workspaceId: string) {
    const chs = await prisma.channel.findMany({
      where: { workspaceId, type: "EMAIL", config: { path: ["provider"], equals: "google" } },
      orderBy: { createdAt: "asc" },
    });
    return chs.map((c) => (c.config as any).email as string);
  }

  async isConnected(workspaceId: string) {
    return !!(await this.findChannel(workspaceId));
  }

  private async accessToken(workspaceId: string, account?: string) {
    const channel = await this.findChannel(workspaceId, account);
    if (!channel) throw new Error(account ? `Conta Google ${account} não conectada` : "Google não conectado");
    const cached = this.tokenCache.get(channel.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const t = await this.tokenRequest({
      refresh_token: openToken((channel.config as any).refreshToken),
      grant_type: "refresh_token",
    });
    this.tokenCache.set(channel.id, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token as string;
  }

  private async g<T = any>(workspaceId: string, account: string | undefined, url: string, init?: RequestInit): Promise<T> {
    const token = await this.accessToken(workspaceId, account);
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  // ─── Gmail ────────────────────────────────────────────────────

  async gmailSearch(workspaceId: string, query: string, account?: string, max = 10) {
    const list = await this.g<any>(
      workspaceId,
      account,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
    );
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    return Promise.all(
      ids.map(async (id) => {
        const m = await this.g<any>(
          workspaceId,
          account,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&${GMAIL_HEADERS.map((n) => `metadataHeaders=${n}`).join("&")}`,
        );
        const h = (n: string) => m.payload?.headers?.find((x: any) => x.name === n)?.value;
        // Sinais para separar spam/promoção/automático (ver email-filter.ts); nomes em minúsculas
        const sinais: Record<string, string> = {};
        for (const x of m.payload?.headers ?? []) {
          const k = String(x.name).toLowerCase();
          if (SIGNAL_HEADERS.has(k) && x.value) sinais[k] = String(x.value).slice(0, 300);
        }
        return { id, de: h("From"), assunto: h("Subject"), data: h("Date"), resumo: m.snippet, internalDate: Number(m.internalDate), labels: m.labelIds ?? [], sinais };
      }),
    );
  }

  async gmailRead(workspaceId: string, id: string, account?: string) {
    const m = await this.g<any>(workspaceId, account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    const h = (n: string) => m.payload?.headers?.find((x: any) => x.name === n)?.value;
    const find = (part: any): string => {
      if (part?.mimeType === "text/plain" && part.body?.data) return part.body.data;
      for (const p of part?.parts ?? []) {
        const r = find(p);
        if (r) return r;
      }
      return "";
    };
    const data = find(m.payload) || m.payload?.body?.data || "";
    const body = Buffer.from(data, "base64url").toString("utf8").slice(0, 4000);
    return { id, de: h("From"), para: h("To"), assunto: h("Subject"), data: h("Date"), corpo: body };
  }

  async gmailMarkRead(workspaceId: string, id: string, account?: string) {
    await this.g(workspaceId, account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
    return { ok: true };
  }

  async gmailSpam(workspaceId: string, id: string, account?: string) {
    await this.g(workspaceId, account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ["SPAM"], removeLabelIds: ["INBOX", "UNREAD"] }),
    });
    return { ok: true };
  }

  async gmailTrash(workspaceId: string, id: string, account?: string) {
    await this.g(workspaceId, account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, { method: "POST" });
    return { ok: true };
  }

  async gmailSend(workspaceId: string, to: string, subject: string, text: string, account?: string) {
    const raw = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text,
    ].join("\r\n");
    await this.g(workspaceId, account, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
    });
    return { ok: true };
  }

  // ─── Drive (somente leitura) ──────────────────────────────────

  /** Erros do Drive em português claro: conta conectada antes do Drive, ou API desativada no Google Cloud. */
  private driveError(e: any): Error {
    const m = String(e?.message ?? e);
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(m)) {
      return new Error("Esta conta ainda não liberou o Drive. Reconecte o Google em Canais → Conectar Google.");
    }
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project/i.test(m)) {
      return new Error("A API do Google Drive está desativada no projeto do Google Cloud (ative \"Google Drive API\").");
    }
    return e instanceof Error ? e : new Error(m);
  }

  /**
   * Busca no Drive de uma conta. strict: o nome tem TODAS as palavras lembradas. fuzzy: o nome tem QUALQUER uma delas
   * (mais as variações/sinônimos), e, se ainda assim nada aparecer, procura dentro do texto dos arquivos.
   * Em fuzzy devolve até 25 candidatos para quem chamou ordenar por semelhança.
   */
  async driveSearch(workspaceId: string, spec: { terms: string[]; alternates?: string[]; kind?: DriveKind }, account?: string, max = 8, mode: "strict" | "fuzzy" = "strict") {
    const esc = (w: string) => w.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const kindQ = spec.kind ? KIND_Q[spec.kind] : "";
    const run = async (cond: string, withKind: boolean) => {
      const q = [cond, "trashed=false", "mimeType!='application/vnd.google-apps.folder'", withKind && kindQ].filter(Boolean).join(" and ");
      const p = new URLSearchParams({
        q,
        pageSize: String(mode === "fuzzy" ? 25 : max),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
        corpora: "allDrives",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
      });
      const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
      return (r.files ?? []).map((f: any) => ({ id: f.id, nome: f.name, tipo: f.mimeType, tamanho: f.size ? Number(f.size) : undefined, modificado: f.modifiedTime, link: f.webViewLink }));
    };
    try {
      if (mode === "strict") {
        if (!spec.terms.length && !kindQ) return [];
        return await run(spec.terms.map((w) => `name contains '${esc(w)}'`).join(" and "), true);
      }
      const words = [...new Set([...spec.terms, ...(spec.alternates ?? [])].flatMap(wordVariants))].slice(0, 16);
      if (!words.length) return [];
      const byName = `(${words.map((w) => `name contains '${esc(w)}'`).join(" or ")})`;
      const byText = `(${words.map((w) => `fullText contains '${esc(w)}'`).join(" or ")})`;
      const attempts: [string, boolean][] = [[byName, true], ...(kindQ ? ([[byName, false]] as [string, boolean][]) : []), [byText, true], ...(kindQ ? ([[byText, false]] as [string, boolean][]) : [])];
      for (const [cond, withKind] of attempts) {
        const found = await run(cond, withKind);
        if (found.length) return found;
      }
      return [];
    } catch (e) {
      throw this.driveError(e);
    }
  }

  /**
   * Baixa um arquivo do Drive para enviar ao dono. Documentos, planilhas e apresentações do Google são exportados
   * (PDF; planilha em XLSX). Arquivos acima do limite não são baixados: só devolve o link.
   */
  async driveFile(workspaceId: string, id: string, account?: string, maxBytes = DRIVE_MAX_BYTES): Promise<DriveFileResult> {
    try {
      const meta = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`);
      const native = String(meta.mimeType).startsWith("application/vnd.google-apps.");
      const exp = native ? DRIVE_EXPORTS[meta.mimeType] : undefined;
      const base = { nome: String(meta.name), link: meta.webViewLink as string | undefined };
      if (native && !exp) return { ...base, mime: meta.mimeType as string, motivo: "este tipo de arquivo do Google não pode ser baixado" };
      if (!native && meta.size && Number(meta.size) > maxBytes) return { ...base, mime: meta.mimeType as string, motivo: "arquivo grande demais para enviar pelo WhatsApp" };
      const url = exp
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exp.mime)}`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
      const bytes = await this.gBytes(workspaceId, account, url);
      if (bytes.length > maxBytes) return { ...base, mime: meta.mimeType as string, motivo: "arquivo grande demais para enviar pelo WhatsApp" };
      const nome = exp && !base.nome.toLowerCase().endsWith(exp.ext) ? `${base.nome}${exp.ext}` : base.nome;
      return { ...base, nome, mime: exp?.mime ?? (meta.mimeType as string), base64: bytes.toString("base64") };
    } catch (e) {
      throw this.driveError(e);
    }
  }

  private async gBytes(workspaceId: string, account: string | undefined, url: string): Promise<Buffer> {
    const token = await this.accessToken(workspaceId, account);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // ─── Notas em Markdown no Drive ───────────────────────────────

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.noteLocks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.noteLocks.set(key, run);
    run.then(
      () => this.noteLocks.get(key) === run && this.noteLocks.delete(key),
      () => this.noteLocks.get(key) === run && this.noteLocks.delete(key),
    );
    return run;
  }

  /** Erro de gravação em português claro: conta conectada antes do escopo de notas. */
  private noteError(e: any): Error {
    const m = String(e?.message ?? e);
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(m)) {
      return new Error("Esta conta ainda não liberou gravar notas no Drive. Reconecte o Google em Canais → Conectar Google.");
    }
    return this.driveError(e);
  }

  private async driveFirst(workspaceId: string, account: string | undefined, q: string): Promise<string | undefined> {
    const p = new URLSearchParams({ q, pageSize: "1", fields: "files(id)", spaces: "drive" });
    const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
    return r.files?.[0]?.id;
  }

  /** Acha (ou cria) a pasta de notas da conta. */
  private async noteFolder(workspaceId: string, account: string | undefined): Promise<string> {
    const key = `${workspaceId}:${account ?? ""}`;
    const cached = this.noteFolders.get(key);
    if (cached) return cached;
    let id = await this.driveFirst(workspaceId, account, `name='${NOTES_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    if (!id) {
      const created = await this.g<any>(workspaceId, account, "https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        body: JSON.stringify({ name: NOTES_FOLDER, mimeType: FOLDER_MIME }),
      });
      id = created.id as string;
    }
    this.noteFolders.set(key, id);
    return id;
  }

  private async driveUpload(workspaceId: string, account: string | undefined, method: "POST" | "PATCH", url: string, content: string, meta?: object): Promise<void> {
    const token = await this.accessToken(workspaceId, account);
    const boundary = `oc${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const body = meta
      ? `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`
      : content;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": meta ? `multipart/related; boundary=${boundary}` : "text/markdown; charset=UTF-8" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  /**
   * Acrescenta uma linha à nota do dia (Assist.IA/AAAA-MM-DD.md), criando a pasta e o arquivo se preciso.
   * Só mexe em arquivos que o próprio assistente criou (escopo drive.file).
   */
  noteAppend(workspaceId: string, text: string, timeZone: string, account?: string, at = new Date()): Promise<{ nome: string; dia: string }> {
    return this.serial(`${workspaceId}:${account ?? ""}`, async () => {
      try {
        const folder = await this.noteFolder(workspaceId, account);
        const dia = dayStamp(at, timeZone);
        const nome = dailyFileName(at, timeZone);
        const entry = formatEntry(at, text, timeZone);
        const esc = nome.replace(/'/g, "\\'");
        const id = await this.driveFirst(workspaceId, account, `name='${esc}' and '${folder}' in parents and trashed=false`);
        if (!id) {
          await this.driveUpload(workspaceId, account, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", appendEntry("", entry, dia), {
            name: nome,
            parents: [folder],
            mimeType: "text/markdown",
          });
          return { nome, dia };
        }
        const current = await this.gBytes(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
        if (current.length > NOTE_MAX_BYTES) throw new Error("a nota de hoje ficou grande demais; abra o arquivo no Drive");
        await this.driveUpload(workspaceId, account, "PATCH", `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, appendEntry(current.toString("utf8"), entry, dia));
        return { nome, dia };
      } catch (e) {
        // A pasta pode ter sido apagada no Drive: esquece o cache para achar ou recriar na próxima
        this.noteFolders.delete(`${workspaceId}:${account ?? ""}`);
        throw this.noteError(e);
      }
    });
  }

  /** Procura as palavras nos arquivos Markdown/texto do Drive e devolve os trechos que as citam (até `max` notas). */
  async noteSearch(workspaceId: string, terms: string[], account?: string, max = 5): Promise<NoteHit[]> {
    const esc = (w: string) => w.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const words = [...new Set(terms)].slice(0, 6);
    if (!words.length) return [];
    try {
      const q = [`(${words.map((w) => `fullText contains '${esc(w)}'`).join(" or ")})`, "(mimeType='text/markdown' or mimeType='text/plain')", "trashed=false"].join(" and ");
      const p = new URLSearchParams({
        q,
        pageSize: String(max),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,size,modifiedTime,webViewLink)",
        corpora: "allDrives",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
      });
      const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
      const hits = await Promise.all(
        (r.files ?? []).map(async (f: any): Promise<NoteHit | null> => {
          if (Number(f.size ?? 0) > NOTE_MAX_BYTES) return null;
          const bytes = await this.gBytes(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`).catch(() => null);
          if (!bytes) return null;
          const trechos = snippets(bytes.toString("utf8"), words.map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()));
          return trechos.length ? { id: f.id, nome: String(f.name), modificado: f.modifiedTime, link: f.webViewLink, trechos } : null;
        }),
      );
      return hits.filter((h): h is NoteHit => !!h);
    } catch (e) {
      throw this.driveError(e);
    }
  }

  // ─── Contatos do Google → Markdown por letra no Drive ─────────

  /** Erros da People API em português claro, com o endereço para ativar a API no Google Cloud. */
  private peopleError(e: any): Error {
    const m = String(e?.message ?? e);
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project|API has not been used/i.test(m)) {
      const url = m.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"'\\)]+/)?.[0] ?? "https://console.cloud.google.com/apis/library/people.googleapis.com";
      return new Error(`A API de Contatos (People API) está desativada no projeto do Google Cloud. Ative em: ${url}`);
    }
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(m)) {
      return new Error("Esta conta ainda não liberou os contatos. Reconecte o Google em Canais → Conectar Google.");
    }
    return this.noteError(e);
  }

  /** Todos os contatos salvos da conta (nome, telefones, e-mails, empresa), até ~25 mil. */
  private async contactsFetch(workspaceId: string, account: string | undefined): Promise<Contact[]> {
    const out: Contact[] = [];
    let pageToken = "";
    for (let page = 0; page < 25; page++) {
      const p = new URLSearchParams({ personFields: "names,emailAddresses,phoneNumbers,organizations", pageSize: "1000", sortOrder: "LAST_MODIFIED_DESCENDING" });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await this.g<any>(workspaceId, account, `https://people.googleapis.com/v1/people/me/connections?${p}`);
      for (const person of r.connections ?? []) {
        const c = fromPerson(person);
        if (c) out.push(c);
      }
      pageToken = r.nextPageToken ?? "";
      if (!pageToken) break;
    }
    return out;
  }

  /** Acha (ou cria) uma subpasta dentro de `parent`. */
  private async driveEnsureFolder(workspaceId: string, account: string | undefined, name: string, parent: string): Promise<string> {
    const esc = name.replace(/'/g, "\\'");
    const found = await this.driveFirst(workspaceId, account, `name='${esc}' and mimeType='${FOLDER_MIME}' and '${parent}' in parents and trashed=false`);
    if (found) return found;
    const created = await this.g<any>(workspaceId, account, "https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    });
    return created.id as string;
  }

  /** Arquivos de uma pasta (nome → id). */
  private async driveFilesIn(workspaceId: string, account: string | undefined, folder: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const p = new URLSearchParams({ q: `'${folder}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`, pageSize: "100", fields: "files(id,name)", spaces: "drive" });
    const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
    for (const f of r.files ?? []) out.set(String(f.name), String(f.id));
    return out;
  }

  /** Grava `content` no arquivo (atualiza se já existe, cria se não). */
  private async driveWrite(workspaceId: string, account: string | undefined, folder: string, name: string, content: string, id?: string): Promise<void> {
    if (id) return this.driveUpload(workspaceId, account, "PATCH", `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, content);
    await this.driveUpload(workspaceId, account, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", content, { name, parents: [folder], mimeType: "text/markdown" });
  }

  /**
   * Importa os contatos da conta para Assist.IA/Contatos/<letra>.md (um arquivo por letra, reescrito por inteiro: rodar de novo
   * não duplica nada). Letras que ficaram sem contatos viram um arquivo vazio, para não sobrar gente que foi apagada.
   */
  contactsImport(workspaceId: string, account?: string, at = new Date()): Promise<{ total: number; arquivos: number }> {
    return this.serial(`contacts:${workspaceId}:${account ?? ""}`, async () => {
      try {
        const people = await this.contactsFetch(workspaceId, account);
        const grouped = groupByLetter(people);
        const root = await this.noteFolder(workspaceId, account);
        const folder = await this.driveEnsureFolder(workspaceId, account, CONTACTS_FOLDER, root);
        const existing = await this.driveFilesIn(workspaceId, account, folder);
        const day = dayStamp(at, CONTACTS_TZ);
        const jobs: { name: string; content: string }[] = [...grouped].map(([letter, cs]) => ({ name: fileOfLetter(letter), content: renderLetterFile(letter, cs, day) }));
        const written = new Set(jobs.map((j) => j.name));
        for (const name of existing.keys()) {
          const letter = name === fileOfLetter("#") ? "#" : name.match(/^([A-Z])\.md$/)?.[1];
          if (letter && !written.has(name)) jobs.push({ name, content: renderLetterFile(letter, [], day) });
        }
        // Poucos de cada vez, para não estourar o limite de requisições do Drive
        for (let i = 0; i < jobs.length; i += 4) {
          await Promise.all(jobs.slice(i, i + 4).map((j) => this.driveWrite(workspaceId, account, folder, j.name, j.content, existing.get(j.name))));
        }
        this.contactCache.delete(`${workspaceId}:${account ?? ""}`);
        await this.markContactsSynced(workspaceId, account, at);
        return { total: people.length, arquivos: grouped.size };
      } catch (e) {
        throw this.peopleError(e);
      }
    });
  }

  private async markContactsSynced(workspaceId: string, account: string | undefined, at: Date) {
    const ch = await this.findChannel(workspaceId, account);
    if (ch) await prisma.channel.update({ where: { id: ch.id }, data: { config: { ...(ch.config as object), contactsSyncedAt: at.toISOString() } } });
  }

  /** Primeira conexão da conta: importa os contatos uma vez. Falhar não atrapalha a conexão; o comando "atualizar contatos" refaz. */
  async importContactsOnce(workspaceId: string, account: string): Promise<void> {
    try {
      const ch = await this.findChannel(workspaceId, account);
      if (!ch || (ch.config as any)?.contactsSyncedAt) return;
      const r = await this.contactsImport(workspaceId, account);
      this.logger.log(`Contatos importados para o Drive: ${r.total} em ${r.arquivos} arquivo(s)`);
    } catch (e: any) {
      this.logger.warn(`Importar contatos na conexão falhou: ${e.message}`);
    }
  }

  /** Contatos que casam com o nome, lidos dos arquivos do Drive. Devolve null se a conta ainda não importou contatos. */
  async contactsLookup(workspaceId: string, query: string, account?: string, max = 5): Promise<Contact[] | null> {
    const key = `${workspaceId}:${account ?? ""}`;
    const hit = this.contactCache.get(key);
    if (hit && Date.now() - hit.at < CONTACTS_CACHE_MS) return findContacts(hit.contacts, query, max);
    try {
      const root = await this.driveFirst(workspaceId, account, `name='${NOTES_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
      const folder = root && (await this.driveFirst(workspaceId, account, `name='${CONTACTS_FOLDER}' and mimeType='${FOLDER_MIME}' and '${root}' in parents and trashed=false`));
      if (!folder) return null;
      const files = [...(await this.driveFilesIn(workspaceId, account, folder))].filter(([n]) => /^([A-Z]|Outros)\.md$/.test(n));
      const contacts: Contact[] = [];
      for (let i = 0; i < files.length; i += 6) {
        const parts = await Promise.all(
          files.slice(i, i + 6).map(async ([, id]) => parseLetterFile((await this.gBytes(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).toString("utf8"))),
        );
        parts.forEach((p) => contacts.push(...p));
      }
      this.contactCache.set(key, { at: Date.now(), contacts });
      return findContacts(contacts, query, max);
    } catch (e) {
      throw this.driveError(e);
    }
  }

  // ─── Calendar ─────────────────────────────────────────────────

  async calendarList(workspaceId: string, timeMin: string, timeMax: string, account?: string) {
    const p = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "25" });
    const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
    return (r.items ?? []).map((e: any) => ({
      id: e.id,
      titulo: e.summary,
      inicio: e.start?.dateTime ?? e.start?.date,
      fim: e.end?.dateTime ?? e.end?.date,
      local: e.location,
    }));
  }

  async calendarCreate(
    workspaceId: string,
    ev: { title: string; start: string; end: string; description?: string | null; attendees?: string[] },
    account?: string,
  ) {
    // Sem hora ("2026-10-03"): evento de dia inteiro, cujo fim no Google é o dia seguinte
    const allDay = !ev.start.includes("T");
    const start = allDay ? { date: ev.start } : { dateTime: ev.start, timeZone: "America/Fortaleza" };
    const end = allDay ? { date: nextDay(ev.start) } : { dateTime: ev.end, timeZone: "America/Fortaleza" };
    const e = await this.g<any>(workspaceId, account, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify({
        summary: ev.title,
        description: ev.description ?? undefined,
        start,
        end,
        attendees: ev.attendees?.map((email) => ({ email })),
      }),
    });
    return { id: e.id, link: e.htmlLink };
  }
}
