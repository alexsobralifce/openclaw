import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "ROOT", services: [] as string[] }));
vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: h.role, services: h.services, name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const marcos = { nome: "Marcos Silva", telefones: ["(85) 99999-0000"], emails: ["marcos@x.com"], empresa: "IFCE" };

function build(opts: { accounts?: string[]; lookup?: (acc: string) => any; importResult?: (acc: string) => any } = {}) {
  h.role = "ROOT";
  h.services = [];
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const contactsLookup = vi.fn(async (_ws: string, _q: string, acc: string) => {
    const r = opts.lookup ? opts.lookup(acc) : [marcos];
    if (r instanceof Error) throw r;
    return r;
  });
  const contactsImport = vi.fn(async (_ws: string, acc: string) => {
    const r = opts.importResult ? opts.importResult(acc) : { total: 1200, arquivos: 24 };
    if (r instanceof Error) throw r;
    return r;
  });
  const google = { listAccounts: async () => accounts, contactsLookup, contactsImport };
  const memory = { promptBlock: async () => "", listRoutine: async () => [], removeRoutine: vi.fn(async () => true) };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, contactsLookup, contactsImport };
}

describe("menu: telefone e e-mail de um contato", () => {
  it("'qual o telefone do Marcos?' mostra telefone, e-mail e empresa", async () => {
    const { menu, contactsLookup } = build();
    const out = (await menu.respond("w1", "qual o telefone do Marcos?")) as string;
    expect(contactsLookup).toHaveBeenCalledWith("w1", "marcos", "pessoal@gmail.com");
    expect(out).toContain("Marcos Silva");
    expect(out).toContain("(85) 99999-0000");
    expect(out).toContain("marcos@x.com");
    expect(out).toContain("IFCE");
  });

  it("'email da Maria' e 'contato do João' também", async () => {
    const { menu, contactsLookup } = build();
    await menu.respond("w1", "email da Maria Souza");
    await menu.respond("w1", "contato do João");
    expect(contactsLookup.mock.calls.map((c) => c[1])).toEqual(["maria souza", "joao"]);
  });

  it("junta as contas e limita a 5 resultados", async () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ nome: `Marcos ${i}`, telefones: [`8599990000${i}`], emails: [] }));
    const { menu } = build({ accounts: ["a@gmail.com", "b@ifce.edu.br"], lookup: () => many });
    const out = (await menu.respond("w1", "telefone do marcos")) as string;
    expect((out.match(/👤/g) ?? []).length).toBe(5);
    expect(out).toContain("5 contatos");
  });

  it("ainda não importou: orienta a dizer 'atualizar contatos'", async () => {
    const { menu } = build({ lookup: () => null });
    const out = (await menu.respond("w1", "telefone do marcos")) as string;
    expect(out).toContain("atualizar contatos");
  });

  it("importou mas não achou: avisa", async () => {
    const { menu } = build({ lookup: () => [] });
    const out = (await menu.respond("w1", "telefone do fulano")) as string;
    expect(out).toContain("Não achei nenhum contato");
  });

  it("erro do Drive vira mensagem clara", async () => {
    const { menu } = build({ lookup: () => new Error("Esta conta ainda não liberou o Drive. Reconecte o Google.") });
    const out = (await menu.respond("w1", "telefone do marcos")) as string;
    expect(out).toContain("Não consegui buscar nos contatos");
    expect(out).toContain("Reconecte o Google");
  });

  it("uma conta com erro não esconde o resultado da outra", async () => {
    const { menu } = build({ accounts: ["a@gmail.com", "b@ifce.edu.br"], lookup: (acc) => (acc === "a@gmail.com" ? new Error("falhou") : [marcos]) });
    const out = (await menu.respond("w1", "telefone do marcos")) as string;
    expect(out).toContain("Marcos Silva");
    expect(out).toContain("Uma conta falhou");
  });

  it("não sequestra os comandos de e-mail", async () => {
    const { menu, contactsLookup } = build();
    await menu.respond("w1", "e-mails de hoje");
    await menu.respond("w1", "ler e-mails");
    expect(contactsLookup).not.toHaveBeenCalled();
  });

  it("sem o serviço Drive liberado, não mexe nos contatos", async () => {
    const { menu, contactsLookup } = build();
    h.role = "USER";
    h.services = [];
    await menu.respond("w1", "telefone do marcos");
    expect(contactsLookup).not.toHaveBeenCalled();
  });
});

describe("menu: atualizar contatos", () => {
  it("importa de todas as contas e informa quantos", async () => {
    const { menu, contactsImport } = build({ accounts: ["a@gmail.com", "b@ifce.edu.br"], importResult: (acc) => (acc === "a@gmail.com" ? { total: 1, arquivos: 1 } : { total: 1200, arquivos: 24 }) });
    const out = (await menu.respond("w1", "atualizar contatos")) as string;
    expect(contactsImport).toHaveBeenCalledTimes(2);
    expect(out).toContain("Contatos atualizados");
    expect(out).toContain("1 contato");
    expect(out).toContain("1200 contatos");
    expect(out).toContain("Pessoal");
    expect(out).toContain("IFCE");
  });

  it("People API desativada: repassa o endereço para ativar", async () => {
    const url = "https://console.developers.google.com/apis/api/people.googleapis.com/overview?project=123456";
    const { menu } = build({ importResult: () => new Error(`A API de Contatos (People API) está desativada no projeto do Google Cloud. Ative em: ${url}`) });
    const out = (await menu.respond("w1", "atualizar contatos")) as string;
    expect(out).toContain("Não consegui atualizar");
    expect(out).toContain(url);
    expect(out).not.toContain("Contatos atualizados");
  });

  it("sem Google conectado, orienta a conectar", async () => {
    const { menu, contactsImport } = build({ accounts: [] });
    const out = (await menu.respond("w1", "atualizar contatos")) as string;
    expect(contactsImport).not.toHaveBeenCalled();
    expect(out).toMatch(/Google/);
  });
});
