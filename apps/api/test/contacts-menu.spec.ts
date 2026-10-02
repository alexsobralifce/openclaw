import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "ROOT", services: [] as string[] }));
vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: h.role, services: h.services, name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const marcos = { nome: "Marcos Silva", telefones: ["(85) 99999-0000"], emails: ["marcos@x.com"], empresa: "IFCE" };

function build(opts: { accounts?: string[]; lookup?: () => any; importResult?: () => any } = {}) {
  h.role = "ROOT";
  h.services = [];
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const contactsLookup = vi.fn(async (_ws: string, _q: string) => {
    const r = opts.lookup ? opts.lookup() : [marcos];
    if (r instanceof Error) throw r;
    return r;
  });
  const contactsImport = vi.fn(async (_ws: string) => {
    const r = opts.importResult ? opts.importResult() : { total: 1200, arquivos: 24, contas: accounts.length, destino: accounts.find((a) => a.endsWith("@gmail.com")) ?? accounts[0] };
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
    expect(contactsLookup).toHaveBeenCalledWith("w1", "marcos");
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
  it("importa uma vez, de todas as contas, e diz onde ficou", async () => {
    const { menu, contactsImport } = build({ accounts: ["ana@ifce.edu.br", "pessoal@gmail.com"] });
    const out = (await menu.respond("w1", "atualizar contatos")) as string;
    expect(contactsImport).toHaveBeenCalledTimes(1);
    expect(out).toContain("Contatos atualizados");
    expect(out).toContain("1200 contatos");
    expect(out).toContain("2 contas");
    expect(out).toContain("24 arquivos");
    expect(out).toContain("Drive Pessoal");
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

describe("menu: item Contatos", () => {
  it("aparece no menu principal dizendo o que dá para pedir", async () => {
    const { menu } = build();
    const out = (await menu.respond("w1", "menu")) as string;
    expect(out).toContain("📇 Contatos");
    expect(out).toContain("telefone ou e-mail do Marcos");
  });

  it("a tela de contatos mostra os dados do nome digitado e continua aberta para o próximo", async () => {
    const { menu, contactsLookup } = build();
    const entry = (await menu.respond("w1", "contatos")) as string;
    expect(entry).toContain("Diga o *nome* da pessoa");
    const found = (await menu.respond("w1", "Marcos")) as string;
    expect(contactsLookup).toHaveBeenCalledWith("w1", "Marcos");
    expect(found).toContain("(85) 99999-0000");
    expect(found).toContain("Diga outro nome");
    await menu.respond("w1", "telefone da Maria");
    expect(contactsLookup.mock.calls[1][1]).toBe("maria");
  });

  it("o número do item abre a tela (o item vem logo depois do Drive)", async () => {
    const { menu } = build();
    const main = (await menu.respond("w1", "menu")) as string;
    const line = main.split("\n").find((l) => l.includes("📇 Contatos"))!;
    const num = line.split(" ")[0];
    const digit = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"].indexOf(num);
    const out = (await menu.respond("w1", String(digit >= 0 ? digit : parseInt(num)))) as string;
    expect(out).toContain("Diga o *nome* da pessoa");
  });

  it("'atualizar contatos' funciona dentro da tela e 0 volta ao menu", async () => {
    const { menu, contactsImport } = build();
    await menu.respond("w1", "contatos");
    const out = (await menu.respond("w1", "atualizar contatos")) as string;
    expect(contactsImport).toHaveBeenCalledTimes(1);
    expect(out).toContain("Contatos atualizados");
    const back = (await menu.respond("w1", "0")) as string;
    expect(back).toContain("Menu principal");
  });

  it("sem Google conectado, o item nem aparece", async () => {
    const { menu } = build({ accounts: [] });
    const out = (await menu.respond("w1", "menu")) as string;
    expect(out).not.toContain("Contatos");
  });

  it("pode ser escondido pelo painel e continua funcionando se escrito", async () => {
    const { menu } = build();
    await menu.setHiddenItems("w1", ["contacts"]);
    expect(((await menu.respond("w1", "menu")) as string)).not.toContain("📇 Contatos");
    expect(((await menu.respond("w1", "contatos")) as string)).toContain("Diga o *nome* da pessoa");
  });
});
