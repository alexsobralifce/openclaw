import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "ROOT", services: [] as string[] }));
vi.mock("@magobox/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: h.role, services: h.services, name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const msg = (id: string, de: string, assunto: string, internalDate: number) => ({ id, de, assunto, data: "Mon, 29 Sep 2026 10:00:00 -0300", resumo: "", internalDate, labels: [], sinais: {} });
const FROM_MARCOS = "(from:(marcos) OR to:(marcos))";

function build(opts: { accounts?: string[]; search?: (query: string, acc: string) => any } = {}) {
  h.role = "ROOT";
  h.services = [];
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const gmailSearch = vi.fn(async (_ws: string, query: string, acc: string, _max: number) => {
    const r = opts.search ? opts.search(query, acc) : query.startsWith("(from:") ? [msg("m1", "Marcos Silva <marcos@x.com>", "Contrato assinado", 2000), msg("m2", "Marcos Silva <marcos@x.com>", "Reunião de quinta", 1000)] : [];
    if (r instanceof Error) throw r;
    return r;
  });
  const gmailMarkRead = vi.fn(async () => {});
  const contactsLookup = vi.fn(async () => []);
  const emailBookImport = vi.fn(async (_ws: string) => ({ total: 87, arquivos: 12, contas: accounts.length, destino: accounts.find((a) => a.endsWith("@gmail.com")) ?? accounts[0] }));
  const google = { listAccounts: async () => accounts, gmailSearch, gmailMarkRead, contactsLookup, emailBookImport };
  const memory = { promptBlock: async () => "", listRoutine: async () => [], removeRoutine: vi.fn(async () => true) };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, store, gmailSearch, gmailMarkRead, contactsLookup, emailBookImport };
}

describe("menu: buscar e-mails no Gmail", () => {
  it("'buscar e-mails do Marcos' lista os resultados com remetente e assunto", async () => {
    const { menu, gmailSearch } = build();
    const out = (await menu.respond("w1", "buscar e-mails do Marcos")) as string;
    expect(gmailSearch).toHaveBeenCalledWith("w1", FROM_MARCOS, "pessoal@gmail.com", expect.any(Number));
    expect(out).toContain("E-mails encontrados");
    expect(out).toContain("de marcos");
    expect(out).toContain("Contrato assinado");
    expect(out).toContain("Reunião de quinta");
    expect(out.indexOf("Contrato assinado")).toBeLessThan(out.indexOf("Reunião de quinta")); // mais novo primeiro
  });

  it("'e-mails sobre contrato' busca por assunto, sem filtrar por remetente", async () => {
    const { menu, gmailSearch } = build({ search: () => [msg("m1", "Ana <ana@x.com>", "Contrato", 1)] });
    await menu.respond("w1", "e-mails sobre contrato");
    expect(gmailSearch.mock.calls[0][1]).toBe("contrato");
  });

  it("junta as contas e mostra a mais recente primeiro", async () => {
    const { menu } = build({
      accounts: ["pessoal@gmail.com", "ana@ifce.edu.br"],
      search: (_q, acc) => (acc === "pessoal@gmail.com" ? [msg("a", "X <x@x.com>", "Antigo", 1000)] : [msg("b", "Y <y@y.com>", "Recente", 9000)]),
    });
    const out = (await menu.respond("w1", "procurar emails do Marcos")) as string;
    expect(out.indexOf("Recente")).toBeGreaterThan(-1);
    expect(out.indexOf("Recente")).toBeLessThan(out.indexOf("Antigo"));
  });

  it("sem resultado, avisa", async () => {
    const { menu } = build({ search: () => [] });
    const out = (await menu.respond("w1", "buscar e-mails do Fulano")) as string;
    expect(out).toContain("Não achei e-mails de fulano");
  });

  it("falha em tudo vira mensagem clara; falha em uma conta não esconde o resultado da outra", async () => {
    const all = build({ search: () => new Error("Google API 500") });
    expect(((await all.menu.respond("w1", "buscar e-mails do Marcos")) as string)).toContain("Não consegui buscar no Gmail");
    const some = build({ accounts: ["a@gmail.com", "b@ifce.edu.br"], search: (_q, acc) => (acc === "a@gmail.com" ? new Error("falhou") : [msg("b", "Y <y@y.com>", "Achei", 5)]) });
    const out = (await some.menu.respond("w1", "buscar e-mails do Marcos")) as string;
    expect(out).toContain("Achei");
    expect(out).toContain("Uma conta falhou");
  });

  it("não sequestra 'e-mails de hoje', 'ler e-mails' nem 'email do Marcos' (contato)", async () => {
    const { menu, gmailSearch, contactsLookup } = build();
    await menu.respond("w1", "e-mails de hoje");
    await menu.respond("w1", "ler e-mails");
    await menu.respond("w1", "email do Marcos");
    expect(gmailSearch.mock.calls.some((c) => String(c[1]).startsWith("(from:"))).toBe(false);
    expect(contactsLookup).toHaveBeenCalledTimes(1);
  });

  it("sem o serviço de e-mail liberado, não busca", async () => {
    const { menu, gmailSearch } = build();
    h.role = "USER";
    h.services = [];
    await menu.respond("w1", "buscar e-mails do Marcos");
    expect(gmailSearch).not.toHaveBeenCalled();
  });

  it("depois da busca, 'marque 1 como lido' atualiza a própria busca (não a lista de não lidos)", async () => {
    const { menu, gmailSearch, gmailMarkRead } = build();
    await menu.respond("w1", "buscar e-mails do Marcos");
    const out = (await menu.respond("w1", "marque 1 como lido")) as string;
    expect(gmailMarkRead).toHaveBeenCalledWith("w1", "m1", "pessoal@gmail.com");
    expect(out).toContain("marcado como lido");
    expect(out).toContain("E-mails encontrados");
    expect(gmailSearch.mock.calls.filter((c) => c[1] === FROM_MARCOS)).toHaveLength(2);
  });

  it("0 volta ao menu principal", async () => {
    const { menu } = build();
    await menu.respond("w1", "buscar e-mails do Marcos");
    expect(((await menu.respond("w1", "0")) as string)).toContain("Menu principal");
  });
});

describe("menu: atualizar banco de e-mails", () => {
  it("remonta o catálogo e diz onde ficou", async () => {
    const { menu, emailBookImport } = build({ accounts: ["ana@ifce.edu.br", "pessoal@gmail.com"] });
    const out = (await menu.respond("w1", "atualizar banco de e-mails")) as string;
    expect(emailBookImport).toHaveBeenCalledTimes(1);
    expect(out).toContain("Banco de e-mails atualizado");
    expect(out).toContain("87 endereços");
    expect(out).toContain("Assist.IA/Emails");
    expect(out).toContain("Drive Pessoal");
  });

  it("funciona dentro da tela de Contatos", async () => {
    const { menu, emailBookImport } = build();
    await menu.respond("w1", "contatos");
    const out = (await menu.respond("w1", "atualizar banco de e-mails")) as string;
    expect(emailBookImport).toHaveBeenCalledTimes(1);
    expect(out).toContain("Banco de e-mails atualizado");
  });

  it("erro vira mensagem clara", async () => {
    const { menu, emailBookImport } = build();
    emailBookImport.mockRejectedValue(new Error("Gmail fora do ar"));
    const out = (await menu.respond("w1", "atualizar banco de e-mails")) as string;
    expect(out).toContain("Não consegui atualizar o banco de e-mails");
    expect(out).toContain("Gmail fora do ar");
  });

  it("a tela de Contatos avisa que acha também quem já escreveu por e-mail", async () => {
    const { menu } = build();
    expect(((await menu.respond("w1", "contatos")) as string)).toContain("quem já te escreveu por e-mail");
  });
});
