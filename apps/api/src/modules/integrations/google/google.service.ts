import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { isSealed, openToken, sealToken } from "../../webhooks/crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
];

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
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        );
        const h = (n: string) => m.payload?.headers?.find((x: any) => x.name === n)?.value;
        return { id, de: h("From"), assunto: h("Subject"), data: h("Date"), resumo: m.snippet, internalDate: Number(m.internalDate) };
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
    ev: { title: string; start: string; end: string; description?: string; attendees?: string[] },
    account?: string,
  ) {
    const e = await this.g<any>(workspaceId, account, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify({
        summary: ev.title,
        description: ev.description,
        start: { dateTime: ev.start, timeZone: "America/Fortaleza" },
        end: { dateTime: ev.end, timeZone: "America/Fortaleza" },
        attendees: ev.attendees?.map((email) => ({ email })),
      }),
    });
    return { id: e.id, link: e.htmlLink };
  }
}
