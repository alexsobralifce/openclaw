import { describe, expect, it, vi } from "vitest";

vi.mock("@magobox/database", () => ({ prisma: { workspaceMember: { findFirst: async () => null } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const items = [
  { id: "1", account: "pessoal@gmail.com", de: "Maria Souza <maria@empresa.com>", assunto: "Reunião de quinta" },
  { id: "2", account: "pessoal@gmail.com", de: "João <joao@cliente.com>", assunto: "Proposta comercial" },
  { id: "3", account: "pessoal@gmail.com", de: "GitHub <noreply@github.com>", assunto: "Novo commit no repo" },
];

function build(screen: "emails" | "emails_hidden" = "emails") {
  const store = new Map<string, any>();
  const state = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: any) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  };
  const gmailTrash = vi.fn(async () => ({ ok: true }));
  const google = { listAccounts: async () => ["pessoal@gmail.com"], gmailSearch: async () => [], gmailTrash };
  const memory = { promptBlock: async () => "" };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any);
  store.set("menu:w1", { screen, data: { account: "pessoal@gmail.com", items: items.map((i) => ({ ...i })), hidden: [] }, at: Date.now() });
  return { menu, store, gmailTrash };
}

describe("apagar e-mails em lote", () => {
  it("mostra confirmação com os itens certos e não apaga nada ainda", async () => {
    const { menu, store, gmailTrash } = build();
    const out = (await menu.respond("w1", "apagar emails 1,2")) as string;

    expect(out).toContain("Apagar 2 e-mails?");
    expect(out).toContain("Maria Souza");
    expect(out).toContain("João");
    expect(out).not.toContain("GitHub");
    expect(gmailTrash).not.toHaveBeenCalled();
    expect(store.get("menu:w1").screen).toBe("email_bulk_delete_confirm");
  });

  it("confirmando com '1' apaga os e-mails certos, na ordem, e mostra a lista atualizada", async () => {
    const { menu, gmailTrash } = build();
    await menu.respond("w1", "apagar emails 1,3");
    const out = (await menu.respond("w1", "1")) as string;

    expect(gmailTrash.mock.calls.map((c) => c[1])).toEqual(["1", "3"]);
    expect(out).toContain("2 e-mails apagados");
  });

  it("confirmando com a palavra 'apagar' também executa", async () => {
    const { menu, gmailTrash } = build();
    await menu.respond("w1", "apagar emails 2");
    await menu.respond("w1", "apagar");

    expect(gmailTrash).toHaveBeenCalledWith("w1", "2", "pessoal@gmail.com");
  });

  it("cancelar não apaga nada e volta para a lista", async () => {
    const { menu, gmailTrash, store } = build();
    await menu.respond("w1", "apagar emails 1,2");
    const out = (await menu.respond("w1", "cancelar")) as string;

    expect(gmailTrash).not.toHaveBeenCalled();
    expect(out).not.toContain("Apagar");
    expect(store.get("menu:w1").screen).toBe("emails");
  });

  it("números fora do range são avisados e ignorados, mantendo os válidos", async () => {
    const { menu } = build();
    const out = (await menu.respond("w1", "apagar emails 1,9")) as string;

    expect(out).toContain("Apagar 1 e-mail?");
    expect(out).toContain("Não achei o(s) e-mail(s) 9");
  });

  it("todos fora do range: mensagem de erro, sem trocar de tela", async () => {
    const { menu, store, gmailTrash } = build();
    const out = (await menu.respond("w1", "apagar emails 9,10")) as string;

    expect(out).toContain("Não encontrei esse(s) número(s)");
    expect(gmailTrash).not.toHaveBeenCalled();
    expect(store.get("menu:w1").screen).toBe("emails");
  });

  it("duplicados colapsam num único item", async () => {
    const { menu } = build();
    const out = (await menu.respond("w1", "apagar emails 1,1,1")) as string;
    expect(out).toContain("Apagar 1 e-mail?");
  });

  it("falha parcial é reportada junto com os que deram certo", async () => {
    const { menu, store } = build();
    const gmailTrash = vi.fn(async (_ws: string, id: string) => {
      if (id === "2") throw new Error("boom");
      return { ok: true };
    });
    (menu as any).google.gmailTrash = gmailTrash;
    store.set("menu:w1", { screen: "emails", data: { account: "pessoal@gmail.com", items: items.map((i) => ({ ...i })), hidden: [] }, at: Date.now() });

    await menu.respond("w1", "apagar emails 1,2");
    const out = (await menu.respond("w1", "1")) as string;

    expect(out).toContain("1 e-mail apagado");
    expect(out).toContain("Não consegui apagar: e-mail 2");
  });

  it("funciona a partir da tela emails_hidden", async () => {
    const { menu, gmailTrash, store } = build("emails_hidden");
    const out = (await menu.respond("w1", "apagar emails 1,2")) as string;

    expect(out).toContain("Apagar 2 e-mails?");
    await menu.respond("w1", "1");
    expect(gmailTrash.mock.calls.map((c) => c[1])).toEqual(["1", "2"]);
    expect(store.get("menu:w1").screen).toBe("emails");
  });
});
