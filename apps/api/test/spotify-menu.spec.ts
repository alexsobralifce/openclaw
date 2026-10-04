import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { SpotifyError } from "../src/modules/channels/spotify/spotify.service";

const T = (name: string, artists = "Marinês") => ({ uri: `spotify:track:${name.replace(/\W/g, "")}`, name, artists, album: "Coletânea" });

function build(opts: { configured?: boolean; connected?: boolean; premium?: boolean; search?: any[] | ((q: string) => any[]); pick?: number | null; plan?: any; links?: any[] } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const search = vi.fn(async (_ws: string, q: string) => (typeof opts.search === "function" ? opts.search(q) : opts.search ?? [T("Catingueira")]));
  const spotify: any = {
    isConfigured: () => opts.configured ?? true,
    status: async () => ({ configured: opts.configured ?? true, connected: opts.connected ?? true, name: "Alexandre", premium: opts.premium ?? true }),
    search,
    searchLinks: vi.fn(async (_q: string, what: string) => (opts.links ?? [{ name: what === "track" ? "Catingueira" : "Forró Raiz", by: "Marinês", url: `https://open.spotify.com/${what}/abc` }])),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    setVolume: vi.fn(async () => {}),
    nowPlaying: vi.fn(async () => ({ name: "Catingueira", artists: "Marinês", album: "Coletânea", playing: true })),
    devices: vi.fn(async () => []),
    createPlaylist: vi.fn(async (_ws: string, name: string, _d: string, uris: string[]) => ({ id: "pl1", url: "https://open.spotify.com/playlist/pl1", added: uris.length })),
  };
  const google: any = { listAccounts: async () => ["a@gmail.com"], driveSearch: vi.fn(async () => []) };
  const weather: any = { forecast: vi.fn(async () => ({ temp: 29.4, feels: 31, humidity: 70, wind: 10, code: 0, isDay: true, max: 31, min: 25, rainProb: 10, rainNext6h: 10 })), geocode: vi.fn(), reverse: vi.fn() };
  const intents: any = { enabled: () => true, classify: async () => null, pickTrack: vi.fn(async () => opts.pick ?? null), pickFile: vi.fn(async () => null) };
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any, undefined, weather, undefined, intents, spotify);
  const ai = vi.spyOn(menu as any, "ai").mockResolvedValue(JSON.stringify(opts.plan ?? { nome: "Foco", consultas: ["lo-fi estudo", "piano relaxante"] }));
  const say = async (t: string) => String(await menu.respond("w1", t));
  return { say, spotify, search, google, ai, weather, intents, screen: () => store.get("menu:w1")?.screen };
}

describe("Spotify: buscar com link", () => {
  it("música e playlist voltam com o link, mesmo sem a conta conectada e sem Premium", async () => {
    const { say, spotify } = build({ connected: false, premium: false });
    const m = await say("buscar música catingueira");
    expect(m).toContain("Catingueira");
    expect(m).toContain("https://open.spotify.com/track/abc");
    expect(m).toContain("abrir no Spotify");
    expect(spotify.searchLinks).toHaveBeenCalledWith("catingueira", "track", 5);
    const p = await say("buscar playlist de forró");
    expect(p).toContain("https://open.spotify.com/playlist/abc");
    expect(spotify.searchLinks).toHaveBeenLastCalledWith("forro", "playlist", 5);
    expect(spotify.play).not.toHaveBeenCalled();
  });

  it("sem resultado avisa; falha do Spotify vira mensagem", async () => {
    expect(await build({ links: [] }).say("buscar playlist de nada")).toContain("Não achei");
    const b = build();
    b.spotify.searchLinks.mockRejectedValueOnce(new SpotifyError("rate_limit", "O Spotify pediu para esperar um pouco.", 5));
    expect(await b.say("buscar música forró")).toContain("esperar um pouco");
  });
});

describe("Spotify pelo assistente", () => {
  it("resultado claro toca na hora", async () => {
    const { say, spotify } = build({ search: [T("Catingueira"), T("Outra coisa", "Fulano")] });
    expect(await say("tocar catingueira")).toContain("Tocando");
    expect(spotify.play).toHaveBeenCalledWith("w1", { uris: [T("Catingueira").uri] });
  });

  it("na dúvida mostra a lista e o número toca; o Jev desempata antes de perguntar", async () => {
    const dup = [T("Evidências", "Legião Urbana"), T("Evidências", "Chitãozinho & Xororó")];
    const a = build({ search: dup });
    const list = await say(a, "tocar evidências");
    expect(list).toContain("mais de uma");
    expect(a.screen()).toBe("spotify_list");
    expect(a.spotify.play).not.toHaveBeenCalled();
    expect(await say(a, "2")).toContain("Tocando");
    expect(a.spotify.play).toHaveBeenCalledWith("w1", { uris: [dup[1].uri] });

    const b = build({ search: dup, pick: 1 });
    await say(b, "tocar evidências");
    expect(b.spotify.play).toHaveBeenCalledWith("w1", { uris: [dup[1].uri] });
  });

  it("controles: pausar, pular, volume e o que está tocando", async () => {
    const { say, spotify } = build();
    expect(await say("pausar")).toContain("Pausado");
    await say("pular música");
    await say("volume 40");
    expect(await say("o que está tocando")).toContain("Catingueira");
    expect(spotify.pause).toHaveBeenCalled();
    expect(spotify.next).toHaveBeenCalled();
    expect(spotify.setVolume).toHaveBeenCalledWith("w1", 40);
  });

  it("sem Premium, controlar é recusado e buscar/playlist continuam; sem conexão, manda conectar", async () => {
    const free = build({ premium: false });
    expect(await say(free, "pausar")).toContain("Premium");
    expect(free.spotify.pause).not.toHaveBeenCalled();
    expect(await say(free, "criar playlist para estudar")).toContain("Playlist criada");
    const off = build({ connected: false });
    expect(await say(off, "tocar catingueira")).toContain("não está conectado");
    expect(off.search).not.toHaveBeenCalled();
  });

  it("playlist: a IA sugere consultas, o Spotify acha as músicas e cria a playlist sem repetir", async () => {
    const { say, spotify, ai } = build({ search: (q) => (q.includes("lo-fi") ? [T("Foco 1", "A"), T("Foco 2", "B")] : [T("Foco 1", "A"), T("Piano 1", "C")]) });
    const out = await say("criar playlist para estudar");
    expect(ai.mock.calls[0][1]).toBe("estudar");
    const [, name, , uris] = spotify.createPlaylist.mock.calls[0];
    expect(name).toBe("Foco");
    expect(uris).toEqual([T("Foco 1", "A").uri, T("Foco 2", "B").uri, T("Piano 1", "C").uri]);
    expect(out).toContain("https://open.spotify.com/playlist/pl1");
  });

  it("clima: a IA recebe o tempo e o lugar e a resposta vira lista para escolher", async () => {
    const { say, ai, weather, screen } = build({ search: [T("Dia de sol", "X"), T("Verão", "Y")] });
    const out = await say("música para o clima de hoje");
    expect(weather.forecast).toHaveBeenCalled();
    expect(ai.mock.calls[0][1]).toMatch(/29°.*de dia/);
    expect(out).toContain("Pelo clima");
    expect(screen()).toBe("spotify_list");
  });

  it("falha da IA não derruba: pede o nome da música", async () => {
    const { say, ai } = build();
    ai.mockRejectedValue(new Error("IA fora do ar"));
    expect(await say("músicas sobre saudade")).toContain("Diga o nome");
  });

  it("convivência: 'quero a música X' continua sendo o arquivo do Drive; desligado, nada vai ao Spotify", async () => {
    const on = build();
    await say(on, "quero a música catingueira");
    expect(on.search).not.toHaveBeenCalled();
    expect(on.google.driveSearch).toHaveBeenCalled();
    const off = build({ configured: false });
    await say(off, "tocar catingueira");
    expect(off.search).not.toHaveBeenCalled();
  });

  it("o menu principal só oferece Spotify quando ele está configurado", async () => {
    expect(await say(build(), "menu")).toContain("Spotify");
    expect(await say(build({ configured: false }), "menu")).not.toContain("Spotify");
  });
});

async function say(ctx: { say: (t: string) => Promise<string> }, t: string) {
  return ctx.say(t);
}
