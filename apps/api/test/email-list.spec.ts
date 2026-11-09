import { describe, expect, it, vi } from "vitest";

vi.mock("@magobox/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const T = (h: number) => Date.now() - h * 3600_000;
const inbox = [
  { id: "1", de: "Maria Souza <maria@empresa.com>", assunto: "Reunião de quinta", resumo: "Podemos remarcar?", internalDate: T(5), labels: ["INBOX", "UNREAD"], sinais: {} },
  { id: "2", de: "Loja <ofertas@loja.com>", assunto: "50% OFF só hoje", resumo: "aproveite", internalDate: T(4), labels: ["CATEGORY_PROMOTIONS"], sinais: {} },
  { id: "3", de: "GitHub <noreply@github.com>", assunto: "Novo commit no repo", resumo: "", internalDate: T(3), labels: [], sinais: {} },
  { id: "4", de: "premio@x.com", assunto: "VOCÊ GANHOU um prêmio exclusivo!!!", resumo: "clique aqui", internalDate: T(2), labels: [], sinais: {} },
  { id: "5", de: "João <joao@cliente.com>", assunto: "Proposta comercial", resumo: "segue anexa", internalDate: T(1), labels: [], sinais: {} },
];

function build() {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const google = { listAccounts: async () => ["pessoal@gmail.com"], gmailSearch: async () => inbox };
  const memory = { promptBlock: async () => "" };
  return { menu: new MenuService(google as any, {} as any, memory as any, state as any), store };
}

describe("lista de e-mails organizada", () => {
  it("esconde spam e promoção, agrupa pessoas e automáticos e avisa quantos ocultou", async () => {
    const { menu, store } = build();
    const out = (await (menu as any).emailList("w1", "pessoal@gmail.com")) as string;

    expect(out).toContain("Pessoas (2)");
    expect(out).toContain("Maria Souza");
    expect(out).toContain("João");
    expect(out).toContain("Automáticos (1)");
    expect(out).toContain("GitHub");
    expect(out).not.toContain("50% OFF");
    expect(out).not.toContain("GANHOU");
    expect(out).toContain("2 ocultos");

    // Pessoas primeiro, os mais recentes antes; a numeração segue a ordem da tela (João=1, Maria=2, GitHub=3)
    expect(out.indexOf("João")).toBeLessThan(out.indexOf("Maria"));
    expect(out.indexOf("Maria")).toBeLessThan(out.indexOf("GitHub"));
    const st = store.get("menu:w1");
    expect(st.data.items.map((m: any) => m.id)).toEqual(["5", "1", "3"]);
    expect(st.data.hidden.map((m: any) => m.id)).toEqual(["4", "2"]);
    console.log("\n" + out);
  });

  it("'ocultos' mostra o que foi escondido e por quê, sem apagar nada", async () => {
    const { menu } = build();
    await (menu as any).emailList("w1", "pessoal@gmail.com");
    const out = (await menu.respond("w1", "ocultos")) as string;
    expect(out).toContain("E-mails ocultados");
    expect(out).toContain("50% OFF");
    expect(out).toContain("GANHOU");
    expect(out).toMatch(/Promoções|spam|prêmio/i);
  });
});
