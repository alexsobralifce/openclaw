import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "ROOT", services: [] as string[] }));
vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: h.role, services: h.services, name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

function build(opts: { accounts?: string[]; contacts?: any; sendError?: string; ai?: string } = {}) {
  h.role = "ROOT";
  h.services = [];
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const gmailSend = vi.fn(async (..._a: any[]) => {
    if (opts.sendError) throw new Error(opts.sendError);
    return { ok: true };
  });
  const contactsLookup = vi.fn(async (_ws: string, _q: string) => opts.contacts ?? []);
  const google = { listAccounts: async () => accounts, gmailSend, gmailSearch: vi.fn(async () => []), contactsLookup };
  const memory = { promptBlock: async () => "", listRoutine: async () => [], removeRoutine: vi.fn(async () => true) };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any);
  const ai = vi.spyOn(menu as any, "ai");
  if (opts.ai !== undefined) ai.mockResolvedValue(opts.ai);
  else ai.mockRejectedValue(new Error("IA indisponível"));
  return { menu, store, gmailSend, contactsLookup, ai };
}

const BODY = "Olá, Fulana! O Fulano avisou que vai pagar o dinheiro de Fulanda hoje. Abraço.";

describe("menu: enviar e-mail, parte a parte", () => {
  it("fluxo completo: para, assunto, texto, rascunho e envio", async () => {
    const { menu, gmailSend, ai } = build({ ai: BODY });
    const step1 = (await menu.respond("w1", "enviar e-mail")) as string;
    expect(step1).toContain("Passo 1");
    expect(step1).toContain("para quem");
    const step2 = (await menu.respond("w1", "fulana@email.com")) as string;
    expect(step2).toContain("Passo 2");
    expect(step2).toContain("Para:* fulana@email.com");
    const step3 = (await menu.respond("w1", "assunto: fulano avisa que vai pagar dinheiro de fulanda hoje")) as string;
    expect(step3).toContain("Passo 3");
    expect(step3).toContain("Assunto:* fulano avisa que vai pagar dinheiro de fulanda hoje");
    const draft = (await menu.respond("w1", "avisa que o fulano vai pagar hoje")) as string;
    expect(ai).toHaveBeenCalledTimes(1);
    expect(draft).toContain("Rascunho do e-mail");
    expect(draft).toContain(BODY);
    expect(gmailSend).not.toHaveBeenCalled(); // nada sai antes de confirmar
    const sent = (await menu.respond("w1", "1")) as string;
    expect(gmailSend).toHaveBeenCalledWith("w1", "fulana@email.com", "fulano avisa que vai pagar dinheiro de fulanda hoje", BODY, "pessoal@gmail.com");
    expect(sent).toContain("E-mail enviado");
  });

  it("'texto: ...' envia exatamente o que foi escrito, sem chamar a IA", async () => {
    const { menu, gmailSend, ai } = build();
    await menu.respond("w1", "enviar e-mail");
    await menu.respond("w1", "ana@x.com");
    await menu.respond("w1", "Aviso");
    const draft = (await menu.respond("w1", "texto: Oi Ana, confirmo a reunião de quinta.")) as string;
    expect(ai).not.toHaveBeenCalled();
    expect(draft).toContain("Oi Ana, confirmo a reunião de quinta.");
    await menu.respond("w1", "1");
    expect(gmailSend.mock.calls[0][3]).toBe("Oi Ana, confirmo a reunião de quinta.");
  });

  it("se a IA estiver fora do ar, usa o texto dito como corpo", async () => {
    const { menu, gmailSend } = build();
    await menu.respond("w1", "enviar e-mail");
    await menu.respond("w1", "ana@x.com");
    await menu.respond("w1", "Aviso");
    await menu.respond("w1", "vou atrasar uns dez minutos");
    await menu.respond("w1", "1");
    expect(gmailSend.mock.calls[0][3]).toBe("vou atrasar uns dez minutos");
  });

  it("já trazendo destinatário e assunto, pula direto para o texto", async () => {
    const { menu } = build();
    const out = (await menu.respond("w1", "enviar e-mail para fulana@email.com assunto: fulano avisa que vai pagar hoje")) as string;
    expect(out).toContain("Passo 3");
    expect(out).toContain("fulana@email.com");
    expect(out).toContain("fulano avisa que vai pagar hoje");
  });

  it("só o destinatário no comando: pede o assunto", async () => {
    const { menu } = build();
    expect(((await menu.respond("w1", "enviar e-mail para fulana@email.com")) as string)).toContain("Passo 2");
  });

  it("vários destinatários saem juntos", async () => {
    const { menu, gmailSend } = build();
    await menu.respond("w1", "enviar e-mail");
    await menu.respond("w1", "a@x.com, b@y.com");
    await menu.respond("w1", "Aviso");
    await menu.respond("w1", "texto: oi");
    await menu.respond("w1", "1");
    expect(gmailSend.mock.calls[0][1]).toBe("a@x.com, b@y.com");
  });

  it("destinatário pelo nome: um contato com e-mail é usado direto", async () => {
    const { menu, contactsLookup } = build({ contacts: [{ nome: "Maria Souza", telefones: [], emails: ["maria@x.com"] }] });
    await menu.respond("w1", "enviar e-mail");
    const out = (await menu.respond("w1", "Maria")) as string;
    expect(contactsLookup).toHaveBeenCalledWith("w1", "Maria");
    expect(out).toContain("Passo 2");
    expect(out).toContain("maria@x.com");
  });

  it("vários contatos com o nome: pede para escolher", async () => {
    const { menu, gmailSend } = build({ contacts: [{ nome: "Maria Souza", telefones: [], emails: ["maria@x.com"] }, { nome: "Maria Lima", telefones: [], emails: ["lima@y.com", "ml@z.com"] }] });
    await menu.respond("w1", "enviar e-mail");
    const pick = (await menu.respond("w1", "maria")) as string;
    expect(pick).toContain("Qual deles?");
    expect(pick).toContain("maria@x.com");
    expect(pick).toContain("lima@y.com");
    const out = (await menu.respond("w1", "2")) as string;
    expect(out).toContain("Passo 2");
    expect(out).toContain("lima@y.com");
    expect(gmailSend).not.toHaveBeenCalled();
  });

  it("nome que não está nos contatos: pede o endereço e continua no mesmo passo", async () => {
    const { menu } = build({ contacts: [] });
    await menu.respond("w1", "enviar e-mail");
    const out = (await menu.respond("w1", "Fulaninho")) as string;
    expect(out).toContain("Não achei e-mail de");
    expect((await menu.respond("w1", "fulaninho@x.com")) as string).toContain("Passo 2");
  });

  it("sem o serviço Drive, não consulta contatos: pede o endereço", async () => {
    const { menu, contactsLookup } = build({ contacts: [{ nome: "Maria", telefones: [], emails: ["m@x.com"] }] });
    await menu.respond("w1", "enviar e-mail");
    h.role = "USER";
    h.services = ["email"];
    const out = (await menu.respond("w1", "Maria")) as string;
    expect(contactsLookup).not.toHaveBeenCalled();
    expect(out).toContain("endereço completo");
  });

  it("com duas contas, pergunta de qual sai e envia por ela", async () => {
    const { menu, gmailSend } = build({ accounts: ["pessoal@gmail.com", "ana@ifce.edu.br"] });
    const ask = (await menu.respond("w1", "enviar e-mail")) as string;
    expect(ask).toContain("De qual conta");
    const step1 = (await menu.respond("w1", "ifce")) as string;
    expect(step1).toContain("Passo 1");
    expect(step1).toContain("De:* ana@ifce.edu.br");
    await menu.respond("w1", "x@y.com");
    await menu.respond("w1", "Aviso");
    await menu.respond("w1", "texto: oi");
    await menu.respond("w1", "1");
    expect(gmailSend.mock.calls[0][4]).toBe("ana@ifce.edu.br");
  });

  it("refazer o texto e mudar o assunto mantêm o resto", async () => {
    const { menu, gmailSend } = build();
    await menu.respond("w1", "enviar e-mail");
    await menu.respond("w1", "x@y.com");
    await menu.respond("w1", "Aviso velho");
    await menu.respond("w1", "texto: primeira versão");
    expect(((await menu.respond("w1", "2")) as string)).toContain("de novo");
    await menu.respond("w1", "texto: segunda versão");
    expect(((await menu.respond("w1", "3")) as string)).toContain("novo *assunto*");
    const draft = (await menu.respond("w1", "Aviso novo")) as string; // já tem texto: vai direto ao rascunho
    expect(draft).toContain("Rascunho do e-mail");
    expect(draft).toContain("Aviso novo");
    expect(draft).toContain("segunda versão");
    await menu.respond("w1", "1");
    expect(gmailSend).toHaveBeenCalledWith("w1", "x@y.com", "Aviso novo", "segunda versão", "pessoal@gmail.com");
  });

  it("cancelar em qualquer passo não envia nada e volta à lista de e-mails", async () => {
    for (const steps of [["0"], ["x@y.com", "0"], ["x@y.com", "Aviso", "0"], ["x@y.com", "Aviso", "texto: oi", "0"]]) {
      const { menu, gmailSend } = build();
      await menu.respond("w1", "enviar e-mail");
      let out = "";
      for (const st of steps) out = (await menu.respond("w1", st)) as string;
      expect(out).toContain("E-mail cancelado");
      expect(gmailSend).not.toHaveBeenCalled();
    }
  });

  it("falha no envio mantém o rascunho para tentar de novo", async () => {
    const { menu, gmailSend } = build({ sendError: "Google API 500" });
    await menu.respond("w1", "enviar e-mail");
    await menu.respond("w1", "x@y.com");
    await menu.respond("w1", "Aviso");
    await menu.respond("w1", "texto: oi");
    const out = (await menu.respond("w1", "1")) as string;
    expect(out).toContain("Não consegui enviar");
    expect(out).toContain("Tentar de novo");
    await menu.respond("w1", "1");
    expect(gmailSend).toHaveBeenCalledTimes(2);
  });

  it("assunto vazio ou com quebra de linha é tratado", async () => {
    const { menu, gmailSend } = build();
    await menu.respond("w1", "enviar e-mail");
    await menu.respond("w1", "x@y.com");
    expect(((await menu.respond("w1", "assunto:")) as string)).toContain("Passo 2"); // pede de novo
    await menu.respond("w1", "Aviso\nBcc: invasor@z.com");
    await menu.respond("w1", "texto: oi");
    await menu.respond("w1", "1");
    expect(gmailSend.mock.calls[0][2]).toBe("Aviso Bcc: invasor@z.com");
    expect(gmailSend.mock.calls[0][1]).toBe("x@y.com");
  });

  it("pedido livre ('mande um e-mail pro Marcos dizendo...') continua com a IA", async () => {
    const { menu } = build();
    expect(await menu.respond("w1", "mande um e-mail pro Marcos dizendo que vou atrasar")).toBeNull();
    expect(await menu.respond("w1", "enviar e-mail para fulana@email.com dizendo que vou pagar hoje")).toBeNull();
  });

  it("sem o serviço de e-mail liberado, não abre o passo a passo", async () => {
    const { menu } = build();
    h.role = "USER";
    h.services = [];
    const out = await menu.respond("w1", "enviar e-mail");
    expect(out === null || !String(out).includes("Passo 1")).toBe(true);
  });

  it("sem Google conectado, orienta a conectar", async () => {
    const { menu } = build({ accounts: [] });
    expect(((await menu.respond("w1", "enviar e-mail")) as string)).toMatch(/Google/);
  });

  it("a lista de e-mails e a caixa limpa mostram como escrever um novo", async () => {
    const { menu } = build();
    expect(((await menu.respond("w1", "ler e-mails")) as string)).toContain("enviar e-mail");
  });
});
