import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { createHmac, timingSafeEqual } from "crypto";
import { openToken, sealToken } from "../../webhooks/crypto";

const SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];
const GRAPH = "https://graph.instagram.com";
const DAY_MS = 86_400_000;
// O token dura 60 dias; renovamos quando faltar menos que isto (a renovação exige token com mais de 24 h)
const REFRESH_WHEN_LEFT_MS = 15 * DAY_MS;
const REFRESH_EVERY_MS = 6 * 3_600_000;
// Só dá para responder até 24 h depois da última mensagem do cliente
export const REPLY_WINDOW_MS = 24 * 3_600_000;

export class InstagramApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

@Injectable()
export class InstagramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstagramService.name);
  private timer?: NodeJS.Timeout;

  private get appId() { return process.env.INSTAGRAM_APP_ID || ""; }
  private get appSecret() { return process.env.INSTAGRAM_APP_SECRET || ""; }
  private get version() { return process.env.INSTAGRAM_GRAPH_VERSION || "v23.0"; }
  private get redirectUri() {
    return process.env.INSTAGRAM_REDIRECT_URI || `${process.env.API_URL || "http://localhost:3001"}/api/v1/channels/instagram/callback`;
  }
  get verifyToken() { return process.env.INSTAGRAM_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || ""; }

  isConfigured() {
    return !!(this.appId && this.appSecret);
  }

  onModuleInit() {
    setTimeout(() => void this.refreshExpiring(), 30_000).unref();
    this.timer = setInterval(() => void this.refreshExpiring(), REFRESH_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Conexão (OAuth) ───────────────────────────────────────────

  authUrl(state: string) {
    const q = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  }

  /** Troca o código do OAuth por um token de 60 dias, ativa o webhook da conta e cria (ou atualiza) o canal. */
  async connect(workspaceId: string, code: string) {
    // O código pode voltar com "#_" no fim
    const cleanCode = code.replace(/#_$/, "");
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
        code: cleanCode,
      }),
    });
    if (!shortRes.ok) throw new Error(`Instagram token ${shortRes.status}: ${await shortRes.text()}`);
    const shortBody: any = await shortRes.json();
    // A resposta veio como { data: [{...}] } em versões novas e como objeto simples nas antigas
    const short = shortBody?.data?.[0] ?? shortBody;
    if (!short?.access_token) throw new Error("Instagram não devolveu access_token");

    const longRes = await fetch(
      `${GRAPH}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: this.appSecret, access_token: short.access_token })}`,
    );
    if (!longRes.ok) throw new Error(`Instagram long-lived ${longRes.status}: ${await longRes.text()}`);
    const long: any = await longRes.json();
    const token: string = long.access_token;

    // `user_id` é o id da conta profissional (o que vem no webhook); `id` é o id do usuário no app
    const me: any = await this.get(`/${this.version}/me`, token, { fields: "user_id,username,name" });
    const igUserId = String(me.user_id ?? me.id ?? short.user_id);
    const appScopedId = String(me.id ?? short.user_id ?? igUserId);
    const username: string = me.username ?? igUserId;

    const now = Date.now();
    const config = {
      provider: "instagram",
      igUserId,
      appScopedId,
      username,
      accessToken: sealToken(token),
      tokenExpiresAt: new Date(now + (Number(long.expires_in) || 60 * 24 * 3600) * 1000).toISOString(),
      tokenRefreshedAt: new Date(now).toISOString(),
    };

    // Sem isto o Instagram não manda as mensagens dessa conta para o nosso webhook
    await this.post(`/${this.version}/me/subscribed_apps`, token, { subscribed_fields: "messages" });

    const existing = await this.findByAccount(igUserId, appScopedId, workspaceId);
    const name = `Instagram (@${username})`;
    if (existing) {
      await prisma.channel.update({ where: { id: existing.id }, data: { name, isActive: true, config } });
      return { channelId: existing.id, username };
    }
    const created = await prisma.channel.create({ data: { workspaceId, name, type: "INSTAGRAM", config } });
    return { channelId: created.id, username };
  }

  /** Desliga o canal: apaga o token e para de aceitar mensagens. O histórico de conversas fica. */
  async disconnect(workspaceId: string, channelId: string) {
    const channel = await prisma.channel.findFirstOrThrow({ where: { id: channelId, workspaceId, type: "INSTAGRAM" } });
    const cfg = channel.config as any;
    if (cfg?.accessToken) {
      await this.delete(`/${this.version}/me/subscribed_apps`, openToken(cfg.accessToken)).catch(() => {});
    }
    const { accessToken: _drop, ...rest } = cfg ?? {};
    await prisma.channel.update({ where: { id: channel.id }, data: { isActive: false, config: { ...rest, disconnected: true } } });
  }

  /** Acha o canal pelo id da conta que vem no webhook (o id da conta profissional ou o do usuário no app). */
  async findByAccount(igId: string, appScopedId?: string, workspaceId?: string) {
    return prisma.channel.findFirst({
      where: {
        type: "INSTAGRAM",
        ...(workspaceId ? { workspaceId } : {}),
        OR: [
          { config: { path: ["igUserId"], equals: igId } },
          { config: { path: ["appScopedId"], equals: appScopedId ?? igId } },
        ],
      },
    });
  }

  // ─── Webhook ───────────────────────────────────────────────────

  /** Confere a assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com o app secret). */
  verifySignature(rawBody: Buffer | undefined, header?: string) {
    if (!this.appSecret || !rawBody || !header?.startsWith("sha256=")) return false;
    const expected = Buffer.from(createHmac("sha256", this.appSecret).update(rawBody).digest("hex"));
    const got = Buffer.from(header.slice("sha256=".length));
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  // ─── Graph API ─────────────────────────────────────────────────

  /** Token do canal já decifrado. Devolve null se o canal está desconectado. */
  tokenOf(channel: { config: unknown; isActive: boolean }) {
    const cfg = channel.config as any;
    if (!channel.isActive || !cfg?.accessToken) return null;
    return openToken(cfg.accessToken);
  }

  /** Nome e usuário de quem escreveu. Só para enfeitar o contato: se falhar, seguimos sem. */
  async profile(token: string, igsid: string): Promise<{ name?: string; username?: string }> {
    try {
      const p: any = await this.get(`/${this.version}/${igsid}`, token, { fields: "name,username" });
      return { name: p.name, username: p.username };
    } catch (e: any) {
      this.logger.warn(`Perfil do Instagram ${igsid} indisponível: ${e.message}`);
      return {};
    }
  }

  /** Responde a um cliente. Só funciona até 24 h depois da última mensagem dele. */
  async sendText(channel: { id: string; config: unknown; isActive: boolean }, igsid: string, text: string): Promise<string | undefined> {
    const token = this.tokenOf(channel);
    if (!token) throw new BadRequestException("Instagram desconectado. Reconecte o canal em Canais.");
    try {
      const res: any = await this.post(`/${this.version}/me/messages`, token, undefined, { recipient: { id: igsid }, message: { text } });
      return res?.message_id;
    } catch (e: any) {
      if (e instanceof InstagramApiError && (e.code === 190 || e.status === 401)) await this.markNeedsReconnect(channel.id);
      throw e;
    }
  }

  private async request(method: string, path: string, token: string, query?: Record<string, string>, json?: unknown) {
    const url = `${GRAPH}${path}?${new URLSearchParams({ ...query, access_token: token })}`;
    const res = await fetch(url, {
      method,
      ...(json !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) } : {}),
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const err = body?.error;
      throw new InstagramApiError(err?.message ?? `Instagram ${res.status}`, res.status, err?.code);
    }
    return body;
  }

  private get(path: string, token: string, query?: Record<string, string>) { return this.request("GET", path, token, query); }
  private post(path: string, token: string, query?: Record<string, string>, json?: unknown) { return this.request("POST", path, token, query, json); }
  private delete(path: string, token: string) { return this.request("DELETE", path, token); }

  // ─── Renovação do token ────────────────────────────────────────

  private async markNeedsReconnect(channelId: string) {
    const ch = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) return;
    await prisma.channel.update({ where: { id: ch.id }, data: { config: { ...(ch.config as any), needsReconnect: true } } });
  }

  /** Renova os tokens que vencem em breve; se algum já não serve, o canal pede para reconectar. */
  async refreshExpiring() {
    try {
      const channels = await prisma.channel.findMany({ where: { type: "INSTAGRAM", isActive: true } });
      for (const ch of channels) {
        const cfg = ch.config as any;
        if (!cfg?.accessToken) continue;
        const left = new Date(cfg.tokenExpiresAt ?? 0).getTime() - Date.now();
        const age = Date.now() - new Date(cfg.tokenRefreshedAt ?? 0).getTime();
        if (left > REFRESH_WHEN_LEFT_MS || age < DAY_MS) continue;
        try {
          const r: any = await this.get("/refresh_access_token", openToken(cfg.accessToken), { grant_type: "ig_refresh_token" });
          const now = Date.now();
          await prisma.channel.update({
            where: { id: ch.id },
            data: {
              config: {
                ...cfg,
                accessToken: sealToken(r.access_token),
                tokenExpiresAt: new Date(now + (Number(r.expires_in) || 60 * 24 * 3600) * 1000).toISOString(),
                tokenRefreshedAt: new Date(now).toISOString(),
                needsReconnect: false,
              },
            },
          });
          this.logger.log(`Token do Instagram @${cfg.username} renovado`);
        } catch (e: any) {
          this.logger.error(`Renovação do token do Instagram @${cfg.username} falhou: ${e.message}`);
          if (left <= 0 || (e instanceof InstagramApiError && e.code === 190)) await this.markNeedsReconnect(ch.id);
        }
      }
    } catch (e: any) {
      this.logger.error(`Renovação de tokens do Instagram falhou: ${e.message}`);
    }
  }
}
