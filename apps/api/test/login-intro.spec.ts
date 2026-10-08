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
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", list: async () => [] } as any, state);
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
