import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { ALWAYS_VISIBLE, MENU_ITEMS, menuHiddenKey, sanitizeHidden } from "../src/modules/channels/assistant/menu-items";

function build(opts: { accounts?: string[] } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const google = { listAccounts: async () => accounts, calendarList: vi.fn(async () => []), gmailSearch: vi.fn(async () => []) };
  const memory = { promptBlock: async () => "", listRoutine: async () => [], removeRoutine: vi.fn(async () => true) };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, store };
}

describe("sanitizeHidden", () => {
  it("só aceita ids conhecidos, sem repetir, e nunca o item sempre visível", () => {
    expect(sanitizeHidden(["drive", "drive", "agenda", "inventado", "config", 3, null])).toEqual(["drive", "agenda"]);
    expect(sanitizeHidden("drive")).toEqual([]);
    expect(sanitizeHidden(undefined)).toEqual([]);
  });
  it("o catálogo tem ids únicos e o item de configurações é o sempre visível", () => {
    const ids = MENU_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ALWAYS_VISIBLE]).toEqual(["config"]);
    expect(ids).toContain("config");
  });
});

describe("menu principal com itens ocultos", () => {
  it("sem ocultar nada, mostra todos", async () => {
    const { menu } = build();
    const out = (await menu.respond("w1", "menu")) as string;
    for (const l of ["E-mails", "Google Agenda", "Conversas de clientes", "Perguntar à IA", "Minha memória", "Google Drive", "Minha rotina", "Cofre de senhas", "Configurações"]) expect(out).toContain(l);
    // o Modo carro está desativado por padrão, e a dica "Vai dirigir" não existe mais
    expect(out).not.toContain("Modo carro");
    expect(out).not.toContain("Vai dirigir");
  });

  it("com CAR_MODE=on o menu volta a listar o Modo carro", async () => {
    vi.stubEnv("CAR_MODE", "on");
    try {
      const out = (await build().menu.respond("w1", "menu")) as string;
      expect(out).toContain("Modo carro");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("item oculto some da lista e a numeração se ajusta", async () => {
    const { menu, store } = build();
    await menu.setHiddenItems("w1", ["memory", "car", "free"]);
    expect(store.get(menuHiddenKey("w1"))).toEqual(["memory", "car", "free"]);
    const out = (await menu.respond("w1", "menu")) as string;
    expect(out).not.toContain("Minha memória");
    expect(out).not.toContain("Modo carro");
    expect(out).not.toContain("Perguntar à IA");
    expect(out).toContain("Google Drive");
    // 7 itens visíveis (10 menos 3), numerados em sequência
    expect(out).toContain("7️⃣");
    expect(out).not.toContain("8️⃣");
  });

  it("o número escolhido abre o item certo depois de esconder outros", async () => {
    const { menu } = build();
    await menu.setHiddenItems("w1", ["email"]);
    await menu.respond("w1", "menu");
    const out = (await menu.respond("w1", "1")) as string;
    // Sem E-mails, o 1 passa a ser a Agenda
    expect(out).toMatch(/Agenda/);
    expect(out).not.toMatch(/E-mails não lidos/);
  });

  it("o item oculto continua funcionando quando é escrito", async () => {
    const { menu } = build();
    await menu.setHiddenItems("w1", ["agenda", "email"]);
    const out = (await menu.respond("w1", "agenda")) as string;
    expect(out).toMatch(/Agenda/);
  });

  it("'Configurações' nunca some, mesmo pedindo para ocultar tudo", async () => {
    const { menu } = build();
    const saved = await menu.setHiddenItems("w1", MENU_ITEMS.map((i) => i.id));
    expect(saved).not.toContain("config");
    const out = (await menu.respond("w1", "menu")) as string;
    expect(out).toContain("Configurações");
    expect(out).not.toContain("Google Drive");
  });

  it("a escolha é de cada workspace", async () => {
    const { menu } = build();
    await menu.setHiddenItems("w1", ["drive"]);
    expect(((await menu.respond("w1", "menu")) as string)).not.toContain("Google Drive");
    expect(((await menu.respond("w2", "menu")) as string)).toContain("Google Drive");
  });
});

describe("menuItems (tela do painel)", () => {
  it("lista o que o usuário pode ver, com o estado de cada item", async () => {
    const { menu } = build();
    await menu.setHiddenItems("w1", ["drive"]);
    const items = await menu.menuItems("w1");
    // "Modo carro" (CAR_MODE=on) e "Spotify" (precisa das chaves) só aparecem quando ligados
    expect(items.map((i) => i.id)).toEqual(MENU_ITEMS.filter((i) => i.id !== "car" && i.id !== "spotify").map((i) => i.id));
    expect(items.find((i) => i.id === "drive")).toMatchObject({ hidden: true, locked: false });
    expect(items.find((i) => i.id === "agenda")).toMatchObject({ hidden: false });
    expect(items.find((i) => i.id === "config")).toMatchObject({ locked: true, hidden: false });
  });

  it("com CAR_MODE=on o item Modo carro volta ao menu", async () => {
    vi.stubEnv("CAR_MODE", "on");
    try {
      const ids = (await build().menu.menuItems("w1")).map((i) => i.id);
      expect(ids).toContain("car");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sem Google conectado, e-mail, agenda e Drive não aparecem para escolher", async () => {
    const { menu } = build({ accounts: [] });
    const ids = (await menu.menuItems("w1")).map((i) => i.id);
    expect(ids).not.toContain("email");
    expect(ids).not.toContain("agenda");
    expect(ids).not.toContain("drive");
    expect(ids).toContain("clients");
  });
});
