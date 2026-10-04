import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpotifyController } from "../src/modules/channels/spotify/spotify.controller";
import { SPOTIFY_SCOPES, SpotifyError, SpotifyService } from "../src/modules/channels/spotify/spotify.service";

process.env.WEBHOOK_SECRET = "segredo-de-teste-spotify";

type Call = { method: string; url: string; body?: any; auth?: string };
let calls: Call[] = [];
let routes: [RegExp, (c: Call) => Response][] = [];
const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
const when = (method: string, re: RegExp, fn: (c: Call) => Response) => routes.push([new RegExp(`^${method} ${re.source}`), fn]);

function setup() {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  return { svc: new SpotifyService(state as any), store };
}
const connected = async () => {
  const ctx = setup();
  when("POST", /https:\/\/accounts\.spotify\.com\/api\/token/, () => reply(200, { access_token: "acc1", refresh_token: "ref1", expires_in: 3600 }));
  when("GET", /https:\/\/api\.spotify\.com\/v1\/me$/, () => reply(200, { id: "u1", display_name: "Alexandre", product: "premium" }));
  await ctx.svc.connect("w1", "codigo");
  calls = [];
  return ctx;
};

beforeEach(() => {
  calls = [];
  routes = [];
  process.env.SPOTIFY_CLIENT_ID = "cid";
  process.env.SPOTIFY_CLIENT_SECRET = "csecret";
  process.env.PUBLIC_API_URL = "https://api.magobox.com.br";
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const c: Call = { method: init.method ?? "GET", url: String(url), body: init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body, auth: init.headers?.Authorization };
    calls.push(c);
    const hit = routes.find(([re]) => re.test(`${c.method} ${c.url}`));
    return hit ? hit[1](c) : reply(500, { error: { message: `sem rota ${c.method} ${c.url}` } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "PUBLIC_API_URL"]) delete process.env[k];
});

describe("Spotify: conexão", () => {
  it("só fica ligado com as duas chaves; a URL de login traz escopos, retorno e state", () => {
    const { svc } = setup();
    expect(svc.isConfigured()).toBe(true);
    delete process.env.SPOTIFY_CLIENT_SECRET;
    expect(svc.isConfigured()).toBe(false);
    process.env.SPOTIFY_CLIENT_SECRET = "csecret";
    const u = new URL(svc.authUrl("estado123"));
    expect(u.origin + u.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.magobox.com.br/api/v1/integrations/spotify/callback");
    expect(u.searchParams.get("state")).toBe("estado123");
    expect(u.searchParams.get("scope")!.split(" ")).toEqual(SPOTIFY_SCOPES);
  });

  it("conectar guarda só o refresh token, cifrado, e informa se é Premium", async () => {
    const { svc, store } = setup();
    when("POST", /https:\/\/accounts\.spotify\.com\/api\/token/, () => reply(200, { access_token: "acc1", refresh_token: "ref-secreto", expires_in: 3600 }));
    when("GET", /https:\/\/api\.spotify\.com\/v1\/me$/, () => reply(200, { id: "u1", display_name: "Alexandre", product: "premium" }));
    expect(await svc.connect("w1", "codigo")).toEqual({ name: "Alexandre", premium: true });
    const saved = JSON.stringify(store.get("spotify:w1"));
    expect(saved).not.toContain("ref-secreto");
    expect(saved).not.toContain("acc1");
    expect(await svc.status("w1")).toMatchObject({ connected: true, name: "Alexandre", premium: true });
    expect(calls[0].auth).toMatch(/^Basic /);
    await svc.disconnect("w1");
    expect((await svc.status("w1")).connected).toBe(false);
  });

  it("sem conexão, qualquer chamada avisa para conectar", async () => {
    await expect(setup().svc.search("w1", "x")).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("Spotify: token e erros", () => {
  it("renova o token só quando vence e repete uma vez se o Spotify der 401", async () => {
    const { svc } = await connected();
    let me = 0;
    when("GET", /https:\/\/api\.spotify\.com\/v1\/me\/player\/devices/, () => (me++ === 0 ? reply(401, { error: { message: "expired" } }) : reply(200, { devices: [] })));
    await svc.devices("w1");
    const refreshes = calls.filter((c) => c.url.includes("/api/token"));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].body.toString()).toContain("grant_type=refresh_token");
    expect(calls.filter((c) => c.url.includes("/devices"))).toHaveLength(2);
  });

  it("refresh token recusado (invalid_grant) desconecta e pede para conectar de novo", async () => {
    const { svc } = await connected();
    (svc as any).cache.clear();
    routes.length = 0;
    when("POST", /https:\/\/accounts\.spotify\.com\/api\/token/, () => reply(400, { error: "invalid_grant" }));
    await expect(svc.search("w1", "x")).rejects.toMatchObject({ code: "not_connected" });
    expect((await svc.status("w1")).connected).toBe(false);
  });

  it("traduz os erros do Spotify: Premium, sem aparelho e limite de uso", async () => {
    const { svc } = await connected();
    when("PUT", /https:\/\/api\.spotify\.com\/v1\/me\/player\/pause/, () => reply(403, { error: { status: 403, reason: "PREMIUM_REQUIRED", message: "Premium required" } }));
    await expect(svc.pause("w1")).rejects.toMatchObject({ code: "premium" });
    when("POST", /https:\/\/api\.spotify\.com\/v1\/me\/player\/next/, () => reply(429, {}, { "retry-after": "7" }));
    await expect(svc.next("w1")).rejects.toMatchObject({ code: "rate_limit", retryAfter: 7 });
    expect(new SpotifyError("api", "x")).toBeInstanceOf(Error);
  });
});

describe("Spotify: busca, player e playlists", () => {
  it("busca limita a 10 e devolve nome, artistas e álbum", async () => {
    const { svc } = await connected();
    when("GET", /https:\/\/api\.spotify\.com\/v1\/search/, () => reply(200, { tracks: { items: [{ uri: "spotify:track:1", name: "Catingueira", artists: [{ name: "Marinês" }, { name: "Outro" }], album: { name: "Coletânea" } }, null] } }));
    expect(await svc.search("w1", "catingueira", 50)).toEqual([{ uri: "spotify:track:1", name: "Catingueira", artists: "Marinês, Outro", album: "Coletânea" }]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("type")).toBe("track");
  });

  it("tocar manda as músicas (ou o contexto); sem aparelho ativo, passa para o primeiro disponível", async () => {
    const { svc } = await connected();
    let tries = 0;
    when("PUT", /https:\/\/api\.spotify\.com\/v1\/me\/player\/play/, (c) => (c.url.includes("device_id") || tries++ > 0 ? reply(204) : reply(404, { error: { status: 404, reason: "NO_ACTIVE_DEVICE" } })));
    when("GET", /https:\/\/api\.spotify\.com\/v1\/me\/player\/devices/, () => reply(200, { devices: [{ id: "dev9", name: "Celular", is_active: false }] }));
    await svc.play("w1", { uris: ["spotify:track:1"] });
    const plays = calls.filter((c) => c.url.includes("/player/play"));
    expect(plays[0].body).toEqual({ uris: ["spotify:track:1"] });
    expect(plays[1].url).toContain("device_id=dev9");
    await svc.play("w1", { contextUri: "spotify:playlist:abc" });
    expect(calls.filter((c) => c.url.includes("/player/play")).pop()!.body).toEqual({ context_uri: "spotify:playlist:abc" });
  });

  it("sem nenhum aparelho, o erro é 'abra o Spotify'", async () => {
    const { svc } = await connected();
    when("PUT", /https:\/\/api\.spotify\.com\/v1\/me\/player\/play/, () => reply(404, { error: { status: 404, reason: "NO_ACTIVE_DEVICE" } }));
    when("GET", /https:\/\/api\.spotify\.com\/v1\/me\/player\/devices/, () => reply(200, { devices: [] }));
    await expect(svc.play("w1", { uris: ["spotify:track:1"] })).rejects.toMatchObject({ code: "no_device" });
  });

  it("volume fica entre 0 e 100", async () => {
    const { svc } = await connected();
    when("PUT", /https:\/\/api\.spotify\.com\/v1\/me\/player\/volume/, () => reply(204));
    await svc.setVolume("w1", 250);
    await svc.setVolume("w1", -5);
    expect(calls.map((c) => new URL(c.url).searchParams.get("volume_percent"))).toEqual(["100", "0"]);
  });

  it("playlist: cria privada e adiciona em /items, de 100 em 100, sem repetir música", async () => {
    const { svc } = await connected();
    when("POST", /https:\/\/api\.spotify\.com\/v1\/me\/playlists/, () => reply(201, { id: "pl1", external_urls: { spotify: "https://open.spotify.com/playlist/pl1" } }));
    when("POST", /https:\/\/api\.spotify\.com\/v1\/playlists\/pl1\/items/, () => reply(201, { snapshot_id: "s" }));
    const uris = [...Array.from({ length: 120 }, (_, i) => `spotify:track:${i}`), "spotify:track:0"];
    const r = await svc.createPlaylist("w1", "Estudar", "para focar", uris);
    expect(r).toEqual({ id: "pl1", url: "https://open.spotify.com/playlist/pl1", added: 120 });
    expect(calls[0].body).toMatchObject({ name: "Estudar", public: false });
    const adds = calls.filter((c) => c.url.endsWith("/items"));
    expect(adds.map((c) => c.body.uris.length)).toEqual([100, 20]);
    expect(calls.some((c) => c.url.includes("/tracks"))).toBe(false); // /tracks é obsoleto
  });
});

describe("Spotify: callback do painel", () => {
  const mk = () => {
    const spotify: any = { isConfigured: () => true, authUrl: (s: string) => `https://accounts.spotify.com/authorize?state=${s}`, connect: vi.fn(async () => ({})), disconnect: vi.fn(async () => {}), status: vi.fn(async () => ({})) };
    const jwt: any = { sign: vi.fn(() => "assinado"), verify: vi.fn((s: string) => { if (s !== "assinado") throw new Error("inválido"); return { workspaceId: "w1", purpose: "spotify-oauth" }; }) };
    const redirect = vi.fn();
    return { ctrl: new SpotifyController(spotify, jwt), spotify, redirect, res: { redirect } };
  };

  it("com state assinado conecta e volta ao painel; state falso ou erro do Spotify não conecta", async () => {
    const a = mk();
    await a.ctrl.callback("cod", "assinado", "", a.res);
    expect(a.spotify.connect).toHaveBeenCalledWith("w1", "cod");
    expect(a.redirect.mock.calls[0][0]).toMatch(/\/dashboard\/channels\?spotify=ok$/);
    const b = mk();
    await b.ctrl.callback("cod", "falso", "", b.res);
    await b.ctrl.callback("", "assinado", "access_denied", b.res);
    expect(b.spotify.connect).not.toHaveBeenCalled();
    expect(b.redirect.mock.calls.every((c) => /spotify=error$/.test(c[0]))).toBe(true);
  });

  it("o link de login só sai se o Spotify estiver configurado, e leva o state assinado do workspace", () => {
    const a = mk();
    expect(a.ctrl.authUrl({ user: { workspaces: [{ workspaceId: "w1" }] } }).url).toContain("state=assinado");
    const off = mk();
    off.spotify.isConfigured = () => false;
    expect(() => off.ctrl.authUrl({ user: { workspaces: [{ workspaceId: "w1" }] } })).toThrow("configurado");
  });
});
