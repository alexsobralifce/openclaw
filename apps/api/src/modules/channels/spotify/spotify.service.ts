import { Injectable, Logger } from "@nestjs/common";
import { StateService } from "../../state/state.service";
import { openToken, sealToken } from "../../webhooks/crypto";

/**
 * Spotify do dono: login (OAuth), busca, controle do player (Premium) e playlists. Tudo desligado sem SPOTIFY_CLIENT_ID e
 * SPOTIFY_CLIENT_SECRET. Rotas conferidas na documentação do Spotify em 04/10/2026: playlists usam `/items` (o `/tracks` é obsoleto),
 * a busca devolve no máximo 10 por tipo e o controle do player só vale para conta Premium.
 */
export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-modify-private",
  "playlist-modify-public",
];

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const MAX_ITEMS_PER_ADD = 100;

export type SpotifyErrorCode = "not_connected" | "premium" | "no_device" | "rate_limit" | "not_allowed" | "api";

/** Erro com código, para o assistente responder em português claro. */
export class SpotifyError extends Error {
  constructor(public code: SpotifyErrorCode, message: string, public retryAfter?: number) {
    super(message);
  }
}

/** Resultado de busca com o link que abre no app do Spotify. */
export interface FoundLink {
  name: string;
  /** artistas (música) ou dono (playlist) */
  by: string;
  url: string;
}

export interface Track {
  uri: string;
  name: string;
  artists: string;
  album: string;
}

interface Stored {
  refresh: string;
  name: string;
  premium: boolean;
  at: number;
}

const key = (ws: string) => `spotify:${ws}`;

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);
  private cache = new Map<string, { token: string; exp: number }>();

  constructor(private state: StateService) {}

  private get clientId() { return process.env.SPOTIFY_CLIENT_ID || ""; }
  private get clientSecret() { return process.env.SPOTIFY_CLIENT_SECRET || ""; }
  get redirectUri() {
    const base = (process.env.PUBLIC_API_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3001")).replace(/\/$/, "");
    return process.env.SPOTIFY_REDIRECT_URI || `${base}/api/v1/integrations/spotify/callback`;
  }

  isConfigured() {
    return !!this.clientId && !!this.clientSecret;
  }

  authUrl(state: string): string {
    const p = new URLSearchParams({ client_id: this.clientId, response_type: "code", redirect_uri: this.redirectUri, scope: SPOTIFY_SCOPES.join(" "), state, show_dialog: "true" });
    return `${ACCOUNTS}/authorize?${p}`;
  }

  // ─── Conexão ──────────────────────────────────────────────────

  private async token(params: Record<string, string>): Promise<any> {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`Spotify token ${res.status}: ${j.error ?? ""}`), { invalidGrant: j.error === "invalid_grant" });
    return j;
  }

  /** Troca o código do login pelos tokens; guarda só o refresh token, cifrado. */
  async connect(ws: string, code: string): Promise<{ name: string; premium: boolean }> {
    const t = await this.token({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri });
    if (!t.refresh_token) throw new SpotifyError("api", "O Spotify não confirmou a autorização. Tente conectar de novo.");
    this.cache.set(ws, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) - 60) * 1000 });
    const me = await this.api<any>(ws, "GET", "/me");
    const info: Stored = { refresh: sealToken(t.refresh_token), name: String(me.display_name || me.id), premium: me.product === "premium", at: Date.now() };
    await this.state.set(key(ws), info);
    return { name: info.name, premium: info.premium };
  }

  async status(ws: string): Promise<{ configured: boolean; connected: boolean; name?: string; premium?: boolean }> {
    const info = await this.state.get<Stored>(key(ws));
    return { configured: this.isConfigured(), connected: !!info, name: info?.name, premium: info?.premium };
  }

  async disconnect(ws: string) {
    this.cache.delete(ws);
    await this.state.del(key(ws));
  }

  private async accessToken(ws: string): Promise<string> {
    const hit = this.cache.get(ws);
    if (hit && hit.exp > Date.now()) return hit.token;
    const info = await this.state.get<Stored>(key(ws));
    if (!info) throw new SpotifyError("not_connected", "O Spotify não está conectado. Conecte em Canais, no painel.");
    try {
      const t = await this.token({ grant_type: "refresh_token", refresh_token: openToken(info.refresh) });
      this.cache.set(ws, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) - 60) * 1000 });
      if (t.refresh_token) await this.state.set(key(ws), { ...info, refresh: sealToken(t.refresh_token) });
      return t.access_token;
    } catch (e: any) {
      if (e.invalidGrant) {
        await this.disconnect(ws);
        throw new SpotifyError("not_connected", "A conexão com o Spotify expirou. Conecte de novo em Canais, no painel.");
      }
      throw new SpotifyError("api", "Não consegui falar com o Spotify agora. Tente de novo em instantes.");
    }
  }

  // ─── Chamadas à API ───────────────────────────────────────────

  private async api<T = any>(ws: string, method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const token = await this.accessToken(ws);
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 && !retried) {
      this.cache.delete(ws); // token vencido antes da hora: renova uma vez e repete
      return this.api<T>(ws, method, path, body, true);
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    const text = await res.text();
    const j: any = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
    if (res.ok) return j as T;
    const reason = String(j?.error?.reason ?? "");
    if (res.status === 429) throw new SpotifyError("rate_limit", "O Spotify pediu para esperar um pouco. Tente de novo em instantes.", Number(res.headers.get("retry-after")) || undefined);
    if (res.status === 403 && /PREMIUM/i.test(reason + String(j?.error?.message))) throw new SpotifyError("premium", "Controlar a reprodução exige conta Spotify Premium.");
    // Modo de desenvolvimento do Spotify: só as contas cadastradas no painel do app (até 5) conseguem usar
    if (res.status === 403 && /not registered|allowlist|developer dashboard/i.test(String(j?.error?.message))) throw new SpotifyError("not_allowed", "O Spotify só libera contas cadastradas neste app (limite de 5 no modo de desenvolvimento). A sua ainda não foi liberada.");
    if (res.status === 404 && reason === "NO_ACTIVE_DEVICE") throw new SpotifyError("no_device", "Não há nenhum aparelho com o Spotify aberto. Abra o app no celular ou no computador e tente de novo.");
    this.logger.warn(`Spotify ${method} ${path.split("?")[0]} ${res.status}: ${String(j?.error?.message ?? text).slice(0, 160)}`);
    throw new SpotifyError("api", `O Spotify recusou o pedido (${res.status}).`);
  }

  // ─── Busca ────────────────────────────────────────────────────

  /** Músicas que casam com o texto (o Spotify aceita de 1 a 10). */
  async search(ws: string, query: string, limit = 5): Promise<Track[]> {
    const p = new URLSearchParams({ q: query.slice(0, 150), type: "track", limit: String(Math.min(Math.max(limit, 1), 10)), market: "from_token" });
    const j = await this.api<any>(ws, "GET", `/search?${p}`);
    return (j?.tracks?.items ?? []).filter(Boolean).map((t: any) => ({ uri: String(t.uri), name: String(t.name), artists: (t.artists ?? []).map((a: any) => a.name).join(", "), album: String(t.album?.name ?? "") }));
  }

  /**
   * Músicas ou playlists com o link público (open.spotify.com), que abre direto no app do Spotify.
   * Com `ws` e a conta conectada, busca com o login do usuário (mercado e idioma dele). Sem conta, ou se a conexão caiu, usa o token do
   * próprio app (client credentials): não precisa conectar nem ter Premium.
   */
  async searchLinks(query: string, what: "track" | "playlist", limit = 5, ws?: string): Promise<FoundLink[]> {
    if (!this.isConfigured()) throw new SpotifyError("api", "O Spotify ainda não está configurado no servidor.");
    const params = (market: string) => new URLSearchParams({ q: query.slice(0, 150), type: what, limit: String(Math.min(Math.max(limit, 1), 10)), market });
    if (ws && (await this.state.get(key(ws)))) {
      try {
        return this.links(await this.api<any>(ws, "GET", `/search?${params("from_token")}`), what);
      } catch (e: any) {
        if (!(e instanceof SpotifyError && e.code === "not_connected")) throw e; // conexão revogada: cai para a busca do app
      }
    }
    const exec = async (retried = false): Promise<Response> => {
      const res = await fetch(`${API}/search?${params("BR")}`, {
        headers: { Authorization: `Bearer ${await this.appToken()}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 && !retried) {
        this.appCache = undefined; // token do app vencido antes da hora: renova uma vez
        return exec(true);
      }
      return res;
    };
    let res: Response;
    try {
      res = await exec();
    } catch (e: any) {
      if (e instanceof SpotifyError) throw e;
      throw new SpotifyError("api", "Não consegui falar com o Spotify agora. Tente de novo em instantes.");
    }
    if (res.status === 429) throw new SpotifyError("rate_limit", "O Spotify pediu para esperar um pouco. Tente de novo em instantes.", Number(res.headers.get("retry-after")) || undefined);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.warn(`Spotify busca ${res.status}: ${String(j?.error?.message ?? "").slice(0, 160)}`);
      throw new SpotifyError("api", `O Spotify recusou a busca (${res.status}).`);
    }
    return this.links(j, what);
  }

  private links(j: any, what: "track" | "playlist"): FoundLink[] {
    const items: any[] = (what === "track" ? j?.tracks?.items : j?.playlists?.items) ?? [];
    return items
      .filter((t) => t?.id)
      .map((t) => ({
        name: String(t.name),
        by: what === "track" ? (t.artists ?? []).map((a: any) => a.name).join(", ") : String(t.owner?.display_name ?? ""),
        url: String(t.external_urls?.spotify ?? `https://open.spotify.com/${what}/${t.id}`),
      }));
  }

  private appCache?: { token: string; exp: number };
  private async appToken(): Promise<string> {
    if (this.appCache && this.appCache.exp > Date.now()) return this.appCache.token;
    const t = await this.token({ grant_type: "client_credentials" });
    this.appCache = { token: String(t.access_token), exp: Date.now() + (Number(t.expires_in) - 60) * 1000 };
    return this.appCache.token;
  }

  // ─── Player (Premium) ─────────────────────────────────────────

  devices(ws: string): Promise<{ id: string; name: string; active: boolean }[]> {
    return this.api<any>(ws, "GET", "/me/player/devices").then((j) => (j?.devices ?? []).map((d: any) => ({ id: String(d.id), name: String(d.name), active: !!d.is_active })));
  }

  async nowPlaying(ws: string): Promise<{ name: string; artists: string; album: string; playing: boolean } | null> {
    const j = await this.api<any>(ws, "GET", "/me/player/currently-playing?additional_types=track");
    const t = j?.item;
    return t ? { name: String(t.name), artists: (t.artists ?? []).map((a: any) => a.name).join(", "), album: String(t.album?.name ?? ""), playing: !!j.is_playing } : null;
  }

  /** Toca (ou retoma, sem argumentos). Sem aparelho ativo, passa a tocar no primeiro aparelho disponível. */
  async play(ws: string, what: { uris?: string[]; contextUri?: string } = {}): Promise<void> {
    const body = what.uris?.length ? { uris: what.uris } : what.contextUri ? { context_uri: what.contextUri } : undefined;
    try {
      await this.api(ws, "PUT", "/me/player/play", body ?? {});
    } catch (e) {
      if (!(e instanceof SpotifyError) || e.code !== "no_device") throw e;
      const first = (await this.devices(ws))[0];
      if (!first) throw e;
      await this.api(ws, "PUT", `/me/player/play?device_id=${encodeURIComponent(first.id)}`, body ?? {});
    }
  }

  pause(ws: string) { return this.api(ws, "PUT", "/me/player/pause"); }
  next(ws: string) { return this.api(ws, "POST", "/me/player/next"); }
  previous(ws: string) { return this.api(ws, "POST", "/me/player/previous"); }
  setVolume(ws: string, percent: number) { return this.api(ws, "PUT", `/me/player/volume?volume_percent=${Math.min(100, Math.max(0, Math.round(percent)))}`); }

  // ─── Playlists ────────────────────────────────────────────────

  /** Cria a playlist (privada) e põe as músicas, de 100 em 100. Devolve o link para abrir. */
  async createPlaylist(ws: string, name: string, description: string, uris: string[]): Promise<{ id: string; url: string; added: number }> {
    const p = await this.api<any>(ws, "POST", "/me/playlists", { name: name.slice(0, 100), description: description.slice(0, 280), public: false });
    const unique = [...new Set(uris)];
    for (let i = 0; i < unique.length; i += MAX_ITEMS_PER_ADD) await this.api(ws, "POST", `/playlists/${encodeURIComponent(p.id)}/items`, { uris: unique.slice(i, i + MAX_ITEMS_PER_ADD) });
    return { id: String(p.id), url: String(p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`), added: unique.length };
  }
}
// x
