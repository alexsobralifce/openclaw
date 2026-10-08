import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({
  prisma: {
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    channel: { findFirst: async () => null },
    conversation: { findMany: async () => [] },
  },
}));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

function setup() {
  const store = new Map<string, any>();
  const state: any = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: any) => void store.set(k, JSON.parse(JSON.stringify(v))),
    del: async (k: string) => void store.delete(k),
  };
  const google: any = { listAccounts: async () => [] };
  const weather: any = {
    reverse: async (lat: number) => (lat > 0 ? "Recife, Pernambuco" : "Fortaleza, Ceará"),
    geocode: async (n: string) => (/recife/i.test(n) ? { lat: -8.05, lng: -34.9, name: "Recife, Pernambuco" } : null),
    forecast: async () => ({ now: 28, code: 0, tomorrow: null }),
  };
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", list: async () => [] } as any, state, undefined, weather);
  return { menu, store, say: (t: string) => menu.respond("ws", t) };
}

describe("instruções ao entrar", () => {
  it("mostra como funciona e pergunta se quer ver de novo; 'sim' mantém e leva ao menu", async () => {
    const { menu, say, store } = setup();
    const out = (await menu.intro("ws"))!;
    expect(out).toContain("Como o MagoBox funciona");
    expect(out).toContain("de novo no próximo login");
    const next = (await say("1"))!;
    expect(next).toContain("mostro de novo");
    expect(next).toContain("Menu principal");
    expect(store.get("intro-off:ws")).toBeUndefined();
    expect(await menu.intro("ws")).not.toBeNull();
  });

  it("'não' pula nos próximos logins, e escrever 'instruções' mostra de novo", async () => {
    const { menu, say, store } = setup();
    await menu.intro("ws");
    const next = (await say("2"))!;
    expect(next).toContain("Menu principal");
    expect(store.get("intro-off:ws")).toBe(1);
    expect(await menu.intro("ws")).toBeNull();
    expect((await say("instruções"))!).toContain("Como o MagoBox funciona");
  });

  it("'menu' abre o menu mesmo na tela de instruções", async () => {
    const { menu, say } = setup();
    await menu.intro("ws");
    expect((await say("menu"))!).toContain("Sou o MagoBox");
  });
});

describe("localização no login", () => {
  it("GPS: só avisa no chat quando a cidade mudou", async () => {
    const { menu, store } = setup();
    const first = await menu.deviceLocation("ws", 8, -34); // padrão → Recife
    expect(first).toContain("Localização atualizada");
    expect(store.get("loc:ws").name).toBe("Recife, Pernambuco");
    expect(await menu.deviceLocation("ws", 8.1, -34.1)).toBeNull(); // mesma cidade: silêncio
  });

  it("sem GPS pergunta a cidade; digitar atualiza e abre o menu; cidade desconhecida repete", async () => {
    const { menu, say, store } = setup();
    expect(await menu.cityAsk("ws")).toContain("Onde você está agora?");
    expect((await say("xyzxyz"))!).toContain("Não achei");
    expect(store.get("menu:ws").screen).toBe("city_input");
    const ok = (await say("Recife"))!;
    expect(ok).toContain("Localização atualizada");
    expect(ok).toContain("Menu principal");
  });

  it("'1' mantém a cidade atual", async () => {
    const { menu, say } = setup();
    await menu.cityAsk("ws");
    expect((await say("1"))!).toContain("Menu principal");
  });

  it("durante as instruções a pergunta espera; respondê-las leva à pergunta da cidade", async () => {
    const { menu, say } = setup();
    await menu.intro("ws");
    expect(await menu.cityAskOrDefer("ws")).toBeNull();
    expect((await say("1"))!).toContain("Onde você está agora?");
  });
});
