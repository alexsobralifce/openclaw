import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { isSealed, openToken, sealToken } from "../../webhooks/crypto";
import { nextDay } from "../../channels/assistant/agenda-events";
import { DriveKind, KIND_Q, STRICT_KINDS, extQuery, isBook, nameHasExt, needsNameCheck, wordVariants } from "../../channels/assistant/drive";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  // Só eventos da agenda principal (listar, criar e apagar); não mexe nas agendas em si
  "https://www.googleapis.com/auth/calendar.events",
  // Só leitura: o assistente busca e baixa arquivos, nunca altera nem apaga nada no Drive
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
];

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
    const config = { provider: "google", email, refreshToken: sealToken(t.refresh_token) };
    if (existing) {
      await prisma.channel.update({ where: { id: existing.id }, data: { name: `Google (${email})`, config } });
    } else {
      await prisma.channel.create({
        data: { workspaceId, name: `Google (${email})`, type: "EMAIL", config },
      });
    }
    if (existing) this.tokenCache.delete(existing.id);
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

  /** Pastas com esse nome (e as subpastas, até 3 níveis, no máximo 40): é onde a busca "na pasta X" procura. */
  async driveFolderIds(workspaceId: string, account: string | undefined, name: string): Promise<string[]> {
    const esc = (w: string) => w.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const list = async (q: string) => {
      const p = new URLSearchParams({ q: `${q} and mimeType='application/vnd.google-apps.folder' and trashed=false`, pageSize: "50", fields: "files(id)", corpora: "allDrives", includeItemsFromAllDrives: "true", supportsAllDrives: "true" });
      const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
      return (r.files ?? []).map((f: any) => String(f.id));
    };
    const found = new Set<string>((await list(`name contains '${esc(name)}'`)).slice(0, 5));
    let level = [...found];
    for (let depth = 0; depth < 3 && level.length && found.size < 40; depth++) {
      const kids: string[] = (await list(`(${level.map((id) => `'${id}' in parents`).join(" or ")})`)).filter((id: string) => !found.has(id));
      kids.slice(0, 40 - found.size).forEach((id) => found.add(id));
      level = kids;
    }
    return [...found];
  }

  /**
   * Busca no Drive de uma conta. strict: o nome tem TODAS as palavras lembradas. fuzzy: o nome tem QUALQUER uma delas
   * (mais as variações/sinônimos), e, se ainda assim nada aparecer, procura dentro do texto dos arquivos.
   * Em fuzzy devolve até 25 candidatos para quem chamou ordenar por semelhança.
   */
  async driveSearch(
    workspaceId: string,
    spec: { terms: string[]; alternates?: string[]; kind?: DriveKind; ext?: string; folder?: string; author?: string[] },
    account?: string,
    max = 8,
    mode: "strict" | "fuzzy" = "strict",
  ) {
    const esc = (w: string) => w.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const kindQ = spec.kind ? KIND_Q[spec.kind] : "";
    // Filtros duros (valem em toda tentativa): extensão, autor (no nome ou no texto) e pasta. Os termos do nome é que afrouxam no fuzzy.
    const extQ = spec.ext ? extQuery(spec.ext) || `name contains '${esc(spec.ext)}'` : "";
    const authorQ = (spec.author ?? []).map((w) => `fullText contains '${esc(w)}'`).join(" and ");
    const hard = [extQ, authorQ];
    // O Drive não filtra por extensão nem sabe o que é "livro": o resto sai pelo nome, numa página maior
    const post = (f: { nome: string; tipo?: string }) => (spec.kind !== "book" || isBook(f)) && (!spec.ext || !needsNameCheck(spec.ext) || nameHasExt(f.nome, spec.ext));
    const needPost = spec.kind === "book" || (!!spec.ext && needsNameCheck(spec.ext));
    let parentQ = "";
    const run = async (cond: string, withKind: boolean) => {
      const q = [cond, ...hard, parentQ, "trashed=false", "mimeType!='application/vnd.google-apps.folder'", withKind && kindQ].filter(Boolean).join(" and ");
      const want = mode === "fuzzy" ? 25 : max;
      const p = new URLSearchParams({
        q,
        pageSize: String(needPost ? 100 : want),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
        corpora: "allDrives",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
      });
      const r = await this.g<any>(workspaceId, account, `https://www.googleapis.com/drive/v3/files?${p}`);
      return (r.files ?? [])
        .map((f: any) => ({ id: f.id, nome: f.name, tipo: f.mimeType, tamanho: f.size ? Number(f.size) : undefined, modificado: f.modifiedTime, link: f.webViewLink }))
        .filter(post)
        .slice(0, want);
    };
    try {
      if (spec.folder) {
        const ids = await this.driveFolderIds(workspaceId, account, spec.folder);
        if (!ids.length) return [];
        parentQ = `(${ids.map((id) => `'${id}' in parents`).join(" or ")})`;
      }
      if (mode === "strict") {
        if (!spec.terms.length && !kindQ && !extQ && !authorQ && !parentQ) return [];
        return await run(spec.terms.map((w) => `name contains '${esc(w)}'`).join(" and "), true);
      }
      const words = [...new Set([...spec.terms, ...(spec.alternates ?? [])].flatMap(wordVariants))].slice(0, 16);
      if (!words.length) return [];
      const byName = `(${words.map((w) => `name contains '${esc(w)}'`).join(" or ")})`;
      const byText = `(${words.map((w) => `fullText contains '${esc(w)}'`).join(" or ")})`;
      // Tipo estrito (livro): o filtro nunca é largado, senão a busca por conteúdo devolve código e notas
      const loose = !!kindQ && !(spec.kind && STRICT_KINDS.has(spec.kind));
      const attempts: [string, boolean][] = [[byName, true], ...(loose ? ([[byName, false]] as [string, boolean][]) : []), [byText, true], ...(loose ? ([[byText, false]] as [string, boolean][]) : [])];
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
