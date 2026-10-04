import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { isSealed, openToken, sealToken } from "../../webhooks/crypto";
import { nextDay } from "../../channels/assistant/agenda-events";
import { DriveKind, KIND_Q, wordVariants } from "../../channels/assistant/drive";
import { buildBook, parseAddresses, SeenAddress } from "../../channels/assistant/email-book";
import { DOCS_FOLDER } from "../../channels/assistant/documents";
import { CONTACTS_FOLDER, Contact, EMAIL_BOOK_FOLDER, fileOfLetter, findContacts, fuzzyCandidates, fromPerson, groupByLetter, parseLetterFile, renderLetterFile } from "../../channels/assistant/contacts";
import { planOf } from "../../auth/plans";
import { appendEntry, dailyFileName, dayStamp, formatEntry, NoteDraft, noteFileName, NOTES_FOLDER, renderNote, snippets, storageAccount, TOPICS_FOLDER } from "../../channels/assistant/notes";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  // Só eventos da agenda principal (listar, criar e apagar); não mexe nas agendas em si
  "https://www.googleapis.com/auth/calendar.events",
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
export interface NoteTopic {
  id: string;
  name: string;
}
export interface NoteFile {
  id: string;
  name: string;
  modified?: string;
  link?: string;
}

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
  private contactCache = new Map<string, { at: number; contacts: Contact[] | null }>();

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

  /** Tela de consentimento só para entrar no MagoBox: identidade (e-mail e nome), sem acesso a Gmail, Agenda ou Drive. */
  loginUrl(state: string) {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /** Troca o código do login pelo e-mail da conta Google. O id_token vem direto do Google (TLS + segredo do app); ainda se confere o destinatário. */
  async loginIdentity(code: string): Promise<{ email: string; verified: boolean; name: string }> {
    const t = await this.tokenRequest({ code, grant_type: "authorization_code", redirect_uri: this.redirectUri });
    const claims = JSON.parse(Buffer.from(String(t.id_token ?? "").split(".")[1] ?? "", "base64url").toString() || "{}");
    if (claims.aud !== this.clientId || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss ?? "") || !claims.email) throw new Error("id_token do Google inválido");
    return { email: String(claims.email).toLowerCase(), verified: claims.email_verified === true || claims.email_verified === "true", name: String(claims.name ?? "") };
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

  /** Plano do dono do workspace limita quantas contas Google ele conecta; sem plano (ou root/admin), sem limite. */
  private async assertAccountLimit(workspaceId: string): Promise<void> {
    const owner = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: "OWNER" }, include: { user: true } });
    const plan = owner && owner.user.role === "USER" ? planOf(owner.user.plan) : null;
    if (!plan) return;
    const connected = (await this.listAccounts(workspaceId)).length;
    if (connected >= plan.googleAccounts) {
      throw new Error(`O plano ${plan.name} permite ${plan.googleAccounts} ${plan.googleAccounts === 1 ? "conta Google" : "contas Google"}. Remova uma em Canais ou troque de plano para conectar outra.`);
    }
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
    if (!existing) await this.assertAccountLimit(workspaceId);
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
    // DELETE do Calendar responde 204, sem corpo
    if (res.status === 204) return undefined as T;
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

  // ─── Notas por assunto: Assist.IA/Notas/<Assunto>/<AAAA-MM-DD título>.md ───

  /** Pasta "Notas" da conta; sem `create`, devolve undefined quando ainda não existe (consultar não cria nada). */
  private async topicsRoot(workspaceId: string, account: string | undefined, create: boolean): Promise<string | undefined> {
    if (create) return this.driveEnsureFolder(workspaceId, account, TOPICS_FOLDER, await this.noteFolder(workspaceId, account));
    const root = await this.driveFirst(workspaceId, account, `name='${NOTES_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    return root && (await this.driveFirst(workspaceId, account, `name='${TOPICS_FOLDER}' and mimeType='${FOLDER_MIME}' and '${root}' in parents and trashed=false`));
  }

  /** Cria a nota na pasta do assunto (criada se preciso). Nome repetido no mesmo dia ganha " (2)", nunca sobrescreve. */
  noteCreate(workspaceId: string, draft: NoteDraft, timeZone: string, account?: string, origin = "whatsapp", at = new Date()): Promise<{ assunto: string; nome: string }> {
    return this.serial(`${workspaceId}:${account ?? ""}`, async () => {
      try {
        const root = await this.topicsRoot(workspaceId, account, true);
        const folder = await this.driveEnsureFolder(workspaceId, account, draft.topic, root!);
        const existing = await this.driveFilesIn(workspaceId, account, folder);
        const day = dayStamp(at, timeZone);
        let nome = noteFileName(day, draft.title);
        for (let i = 2; existing.has(nome); i++) nome = noteFileName(day, `${draft.title} (${i})`);
        await this.driveWrite(workspaceId, account, folder, nome, renderNote(draft, day, origin));
        return { assunto: draft.topic, nome };
      } catch (e) {
        this.noteFolders.delete(`${workspaceId}:${account ?? ""}`);
        throw this.noteError(e);
      }
    });
  }

  /** Assuntos (subpastas de Notas), em ordem alfabética. */
  async noteTopics(workspaceId: string, account?: string): Promise<NoteTopic[]> {
    try {
      const root = await this.topicsRoot(workspaceId, account, false);
      if (!root) return [];
      const p = new URLSearchParams({ q: `'${root}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, pageSize: "100", orderBy: "name", fields: "files(id,name)", spaces: "drive" });
      const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
      return (r.files ?? []).map((f: any) => ({ id: String(f.id), name: String(f.name) }));
    } catch (e) {
      throw this.noteError(e);
    }
  }

  /** Notas de um assunto, as mais novas primeiro (o nome começa pela data). */
  async notesIn(workspaceId: string, topicId: string, account?: string): Promise<NoteFile[]> {
    if (!/^[\w-]{8,100}$/.test(topicId)) throw new Error("Assunto inválido.");
    try {
      const root = await this.topicsRoot(workspaceId, account, false);
      const meta = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(topicId)}?fields=parents,mimeType,trashed`);
      if (!root || meta.trashed || meta.mimeType !== FOLDER_MIME || !(meta.parents ?? []).includes(root)) throw new Error("Esse assunto não está nas suas notas.");
      const p = new URLSearchParams({ q: `'${topicId}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`, pageSize: "100", orderBy: "name desc", fields: "files(id,name,modifiedTime,webViewLink)", spaces: "drive" });
      const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
      return (r.files ?? []).map((f: any) => ({ id: String(f.id), name: String(f.name).replace(/\.md$/, ""), modified: f.modifiedTime, link: f.webViewLink }));
    } catch (e) {
      throw this.noteError(e);
    }
  }

  /** Lê uma nota; só vale arquivo dentro de Notas/<assunto>/ (o id vem do cliente, não se confia nele). */
  async noteRead(workspaceId: string, fileId: string, account?: string): Promise<{ name: string; topic: string; content: string; link?: string }> {
    if (!/^[\w-]{8,100}$/.test(fileId)) throw new Error("Nota inválida.");
    try {
      const root = await this.topicsRoot(workspaceId, account, false);
      const f = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,size,parents,trashed,webViewLink,mimeType`);
      const parent = f.parents?.[0];
      const up = parent ? await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parent)}?fields=name,parents`) : null;
      if (!root || f.trashed || f.mimeType === FOLDER_MIME || !up?.parents?.includes(root)) throw new Error("Essa nota não está nas suas notas.");
      if (Number(f.size ?? 0) > NOTE_MAX_BYTES) throw new Error("A nota é grande demais para abrir aqui; abra o arquivo no Drive.");
      const bytes = await this.gBytes(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
      return { name: String(f.name).replace(/\.md$/, ""), topic: String(up.name), content: bytes.toString("utf8"), link: f.webViewLink };
    } catch (e) {
      throw this.noteError(e);
    }
  }

  /**
   * Conclui uma nota apagando-a: vai para a LIXEIRA do Drive (dá para recuperar por 30 dias), nunca é apagada de vez.
   * Só mexe em arquivo que está dentro de um assunto da pasta de notas do usuário, e o escopo drive.file só permite arquivos
   * criados por este app: nota colocada à mão na pasta recebe um aviso claro.
   */
  async noteTrash(workspaceId: string, fileId: string, account?: string): Promise<{ name: string }> {
    if (!/^[\w-]{8,100}$/.test(fileId)) throw new Error("Nota inválida.");
    try {
      const root = await this.topicsRoot(workspaceId, account, false);
      const f = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,parents,trashed,mimeType`);
      const parent = f.parents?.[0];
      const up = parent ? await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parent)}?fields=name,parents`) : null;
      if (!root || f.trashed || f.mimeType === FOLDER_MIME || !up?.parents?.includes(root)) throw new Error("Essa nota não está nas suas notas.");
      await this.g(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
      return { name: String(f.name).replace(/\.md$/, "") };
    } catch (e: any) {
      if (/Google API 40[34]\b/.test(String(e?.message))) {
        throw new Error("Não tenho permissão para apagar essa nota (só apago as que eu mesmo criei). Apague pelo Google Drive.");
      }
      throw this.noteError(e);
    }
  }

  // ─── Documentos (PDFs) guardados em Assist.IA/Documentos ───────

  /** Guarda o PDF em Assist.IA/Documentos (a pasta é criada se preciso) e devolve o id do arquivo no Drive. */
  documentStore(workspaceId: string, bytes: Buffer, name: string, mime: string, account?: string): Promise<{ id: string; link?: string }> {
    return this.serial(`${workspaceId}:${account ?? ""}`, async () => {
      try {
        const folder = await this.driveEnsureFolder(workspaceId, account, DOCS_FOLDER, await this.noteFolder(workspaceId, account));
        const token = await this.accessToken(workspaceId, account);
        const boundary = `oc${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
          body: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--`)]),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const f: any = await res.json();
        return { id: String(f.id), link: f.webViewLink };
      } catch (e) {
        throw this.noteError(e);
      }
    });
  }

  /**
   * Manda um PDF guardado para a LIXEIRA do Drive (30 dias para recuperar). Só mexe em arquivo que está dentro de
   * Assist.IA/Documentos; com o escopo drive.file, só os que o próprio app criou.
   */
  async documentTrash(workspaceId: string, fileId: string, account?: string): Promise<void> {
    if (!/^[\w-]{8,100}$/.test(fileId)) throw new Error("Documento inválido.");
    try {
      const root = await this.driveFirst(workspaceId, account, `name='${NOTES_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
      const docs = root && (await this.driveFirst(workspaceId, account, `name='${DOCS_FOLDER}' and mimeType='${FOLDER_MIME}' and '${root}' in parents and trashed=false`));
      const f = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents,trashed,mimeType`);
      if (!docs || f.trashed || f.mimeType === FOLDER_MIME || !(f.parents ?? []).includes(docs)) throw new Error("Esse documento não está na sua pasta de documentos.");
      await this.g(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
    } catch (e: any) {
      if (/Google API 40[34]\b/.test(String(e?.message))) throw new Error("Não tenho permissão para apagar esse arquivo (só apago os que eu mesmo guardei). Apague pelo Google Drive.");
      throw this.noteError(e);
    }
  }

  // ─── Contatos do Google → Markdown por letra no Drive ─────────

  /** Erros da People API em português claro, com o endereço para ativar a API no Google Cloud. */
  private peopleError(e: any, account?: string): Error {
    const m = String(e?.message ?? e);
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project|API has not been used/i.test(m)) {
      const url = m.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"'\\)]+/)?.[0] ?? "https://console.cloud.google.com/apis/library/people.googleapis.com";
      return new Error(`A API de Contatos (People API) está desativada no projeto do Google Cloud. Ative em: ${url}`);
    }
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(m)) {
      return new Error(`${account ? `A conta ${account}` : "Esta conta"} ainda não liberou os contatos. Reconecte o Google em Canais → Conectar Google.`);
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
   * Importa os contatos de TODAS as contas para Assist.IA/Contatos/<letra>.md no Drive da conta de armazenamento (a pessoal).
   * Um arquivo por letra, reescrito por inteiro: rodar de novo não duplica nada, e letras que ficaram sem contatos viram um
   * arquivo vazio. Se uma conta falhar na leitura, nada é gravado (reescrever sem os contatos dela os apagaria).
   */
  contactsImport(workspaceId: string, at = new Date()): Promise<{ total: number; arquivos: number; contas: number; destino: string }> {
    return this.serial(`contacts:${workspaceId}`, async () => {
      try {
        const accounts = await this.listAccounts(workspaceId);
        const target = storageAccount(accounts);
        if (!target) throw new Error("Google não conectado");
        const lists = await Promise.all(accounts.map((a) => this.contactsFetch(workspaceId, a).catch((e) => { throw this.peopleError(e, a); })));
        const { grouped } = await this.writeBook(workspaceId, target, CONTACTS_FOLDER, lists.flat(), at, "Contatos");
        for (const a of accounts) await this.markContactsSynced(workspaceId, a, at);
        return { total: [...grouped.values()].reduce((n, cs) => n + cs.length, 0), arquivos: grouped.size, contas: accounts.length, destino: target };
      } catch (e) {
        throw this.peopleError(e);
      }
    });
  }

  /** Grava os contatos em Assist.IA/<pasta>/<letra>.md, um arquivo por letra, reescrito por inteiro (letra sem ninguém vira arquivo vazio). */
  private async writeBook(workspaceId: string, target: string, folderName: string, contacts: Contact[], at: Date, title: string) {
    const grouped = groupByLetter(contacts);
    const root = await this.noteFolder(workspaceId, target);
    const folder = await this.driveEnsureFolder(workspaceId, target, folderName, root);
    const existing = await this.driveFilesIn(workspaceId, target, folder);
    const day = dayStamp(at, CONTACTS_TZ);
    const jobs: { name: string; content: string }[] = [...grouped].map(([letter, cs]) => ({ name: fileOfLetter(letter), content: renderLetterFile(letter, cs, day, title) }));
    const written = new Set(jobs.map((j) => j.name));
    for (const name of existing.keys()) {
      const letter = name === fileOfLetter("#") ? "#" : name.match(/^([A-Z])\.md$/)?.[1];
      if (letter && !written.has(name)) jobs.push({ name, content: renderLetterFile(letter, [], day, title) });
    }
    // Poucos de cada vez, para não estourar o limite de requisições do Drive
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map((j) => this.driveWrite(workspaceId, target, folder, j.name, j.content, existing.get(j.name))));
    }
    this.contactCache.delete(`${workspaceId}:${target}:${folderName}`);
    return { grouped };
  }

  /** Lê os arquivos por letra de uma pasta (cache de 5 min). null = a pasta ainda não existe. */
  private async loadBook(workspaceId: string, account: string, folderName: string): Promise<Contact[] | null> {
    const key = `${workspaceId}:${account}:${folderName}`;
    const hit = this.contactCache.get(key);
    if (hit && Date.now() - hit.at < CONTACTS_CACHE_MS) return hit.contacts;
    const root = await this.driveFirst(workspaceId, account, `name='${NOTES_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const folder = root && (await this.driveFirst(workspaceId, account, `name='${folderName}' and mimeType='${FOLDER_MIME}' and '${root}' in parents and trashed=false`));
    if (!folder) {
      // Guarda também a ausência: sem a pasta, cada consulta repetiria as buscas no Drive
      this.contactCache.set(key, { at: Date.now(), contacts: null });
      return null;
    }
    const files = [...(await this.driveFilesIn(workspaceId, account, folder))].filter(([n]) => /^([A-Z]|Outros)\.md$/.test(n));
    const contacts: Contact[] = [];
    for (let i = 0; i < files.length; i += 6) {
      const parts = await Promise.all(
        files.slice(i, i + 6).map(async ([, id]) => parseLetterFile((await this.gBytes(workspaceId, account, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).toString("utf8"))),
      );
      parts.forEach((p) => contacts.push(...p));
    }
    this.contactCache.set(key, { at: Date.now(), contacts });
    return contacts;
  }

  /** Cabeçalhos From/To/Cc dos e-mails mais recentes que casam com a consulta (poucas requisições por vez). */
  private async gmailHeaders(workspaceId: string, account: string, query: string, max: number): Promise<{ from?: string; to?: string; cc?: string }[]> {
    const list = await this.g<any>(workspaceId, account, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(max, 500)}&q=${encodeURIComponent(query)}`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    const out: { from?: string; to?: string; cc?: string }[] = [];
    for (let i = 0; i < ids.length; i += 8) {
      const batch = await Promise.all(
        ids.slice(i, i + 8).map(async (id) => {
          const m = await this.g<any>(workspaceId, account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`).catch(() => null);
          const h = (n: string) => m?.payload?.headers?.find((x: any) => x.name === n)?.value as string | undefined;
          return m ? { from: h("From"), to: h("To"), cc: h("Cc") } : null;
        }),
      );
      out.push(...batch.filter((x): x is NonNullable<typeof x> => !!x));
    }
    return out;
  }

  /**
   * Monta o catálogo de endereços a partir do Gmail de todas as contas (recebidos: quem escreveu; enviados: para quem você escreveu)
   * e grava em Assist.IA/Emails/<letra>.md no Drive de armazenamento. Fica de fora quem já está nos contatos, endereços seus e automáticos.
   */
  emailBookImport(workspaceId: string, at = new Date(), perBox = 300): Promise<{ total: number; arquivos: number; contas: number; destino: string }> {
    return this.serial(`emailbook:${workspaceId}`, async () => {
      try {
        const accounts = await this.listAccounts(workspaceId);
        const target = storageAccount(accounts);
        if (!target) throw new Error("Google não conectado");
        const seen: SeenAddress[] = [];
        for (const a of accounts) {
          const [inbox, sent] = await Promise.all([this.gmailHeaders(workspaceId, a, "in:inbox", perBox), this.gmailHeaders(workspaceId, a, "in:sent", perBox)]);
          for (const m of inbox) for (const x of parseAddresses(m.from)) seen.push({ ...x, sent: false });
          for (const m of sent) for (const x of [...parseAddresses(m.to), ...parseAddresses(m.cc)]) seen.push({ ...x, sent: true });
        }
        const known = new Set((await this.loadBook(workspaceId, target, CONTACTS_FOLDER).catch(() => null))?.flatMap((c) => c.emails) ?? []);
        const book = buildBook(seen, { own: accounts, known });
        const { grouped } = await this.writeBook(workspaceId, target, EMAIL_BOOK_FOLDER, book, at, "Endereços de e-mail");
        return { total: book.length, arquivos: grouped.size, contas: accounts.length, destino: target };
      } catch (e) {
        throw this.noteError(e);
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
      const r = await this.contactsImport(workspaceId);
      this.logger.log(`Contatos importados para o Drive: ${r.total} em ${r.arquivos} arquivo(s)`);
    } catch (e: any) {
      this.logger.warn(`Importar contatos na conexão falhou: ${e.message}`);
    }
    // O catálogo de endereços é independente: falhar nele (ou nos contatos) não impede o outro
    try {
      const b = await this.emailBookImport(workspaceId);
      this.logger.log(`Catálogo de e-mails gravado no Drive: ${b.total} endereço(s) em ${b.arquivos} arquivo(s)`);
    } catch (e: any) {
      this.logger.warn(`Montar o catálogo de e-mails na conexão falhou: ${e.message}`);
    }
  }

  /** Quem escolhe entre nomes parecidos quando a busca exata não acha (o Jev, ligado pelo AssistantService); sem ele, só a busca exata. */
  private personPicker?: (query: string, candidates: Contact[]) => Promise<number | null>;
  setPersonPicker(fn: (query: string, candidates: Contact[]) => Promise<number | null>) {
    this.personPicker = fn;
  }

  /**
   * Contatos que casam com o nome: primeiro os do Google, depois os endereços do catálogo do Gmail (Drive de armazenamento).
   * Devolve null se nenhum dos dois foi importado ainda.
   */
  async contactsLookup(workspaceId: string, query: string, max = 5): Promise<Contact[] | null> {
    const account = storageAccount(await this.listAccounts(workspaceId));
    if (!account) return null;
    try {
      const [people, book] = await Promise.all([this.loadBook(workspaceId, account, CONTACTS_FOLDER), this.loadBook(workspaceId, account, EMAIL_BOOK_FOLDER)]);
      if (people === null && book === null) return null;
      // Os contatos do Google (com telefone) vêm antes dos endereços do catálogo
      const exact = [...findContacts(people ?? [], query, max), ...findContacts(book ?? [], query, max)].slice(0, max);
      if (exact.length || !this.personPicker) return exact;
      // Ninguém bate com o texto: peneira os nomes parecidos e o Jev escolhe (ou diz que nenhum é)
      const similar = fuzzyCandidates([...(people ?? []), ...(book ?? [])], query, 8);
      const picked = similar.length ? await this.personPicker(query, similar) : null;
      return picked !== null && similar[picked] ? [similar[picked]] : [];
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
      recorrente: !!e.recurringEventId,
    }));
  }

  /**
   * Apaga um evento da agenda principal da conta. Em evento que se repete, a lista traz cada ocorrência separada (singleEvents),
   * então só aquela ocorrência some. Evento que já não existe (404/410) conta como apagado.
   */
  async calendarDelete(workspaceId: string, eventId: string, account?: string): Promise<void> {
    if (!/^[\w-]{5,1024}$/.test(eventId)) throw new Error("Evento inválido.");
    try {
      await this.g(workspaceId, account, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE" });
    } catch (e: any) {
      if (/Google API (404|410)\b/.test(String(e?.message))) return;
      throw e;
    }
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
