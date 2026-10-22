import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "ROOT", services: [] as string[] }));
vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: h.role, services: h.services, name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

function build(opts: { accounts?: string[]; hits?: any[]; appendError?: string; searchError?: string; jev?: { intent: string; confidence: number } | null } = {}) {
  h.role = "ROOT";
  h.services = [];
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const noteAppend = vi.fn(async (_ws: string, _text: string, _tz: string, _account?: string) => {
    if (opts.appendError) throw new Error(opts.appendError);
    return { nome: "2026-10-01.md", dia: "2026-10-01" };
  });
  const noteSearch = vi.fn(async (_ws: string, _terms: string[], _account?: string) => {
    if (opts.searchError) throw new Error(opts.searchError);
    return opts.hits ?? [];
  });
  const google = { listAccounts: async () => accounts, noteAppend, noteSearch, driveSearch: vi.fn(async () => []) };
  const memory = { promptBlock: async () => "", listRoutine: async () => [], removeRoutine: vi.fn(async () => true) };
  const intents = { enabled: () => true, classify: vi.fn(async () => opts.jev ?? null) };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any, undefined, undefined, undefined, intents as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, store, noteAppend, noteSearch, intents };
}

describe("menu: anotar no Drive", () => {
  it("'anota no obsidian: ...' grava na nota do dia", async () => {
    const { menu, noteAppend } = build();
    const out = (await menu.respond("w1", "anota no obsidian: ligar pro Marcos sobre o contrato")) as string;
    expect(noteAppend).toHaveBeenCalledWith("w1", "ligar pro Marcos sobre o contrato", expect.any(String), "pessoal@gmail.com");
    expect(out).toContain("Anotado");
    expect(out).toContain("2026-10-01.md");
  });

  it("'nota: ...' e 'salva no diário que ...' também", async () => {
    const { menu, noteAppend } = build();
    await menu.respond("w1", "nota: ideia de tela de relatório #projeto");
    await menu.respond("w1", "Salva no diário que a reunião foi remarcada");
    expect(noteAppend.mock.calls.map((c) => c[1])).toEqual(["ideia de tela de relatório #projeto", "a reunião foi remarcada"]);
  });

  it("o conteúdo da nota não aciona outros comandos (modo carro, clima)", async () => {
    const { menu, noteAppend, store } = build();
    const out = (await menu.respond("w1", "anota no obsidian: vou dirigir amanhã, ver se vai chover")) as string;
    expect(noteAppend).toHaveBeenCalledWith("w1", "vou dirigir amanhã, ver se vai chover", expect.any(String), "pessoal@gmail.com");
    expect(out).toContain("Anotado");
    expect(store.get("mode:w1")).toBeUndefined();
  });

  it("frase longa e natural, com data e hora, é nota quando diz 'no obsidian'", async () => {
    const { menu, noteAppend } = build({ jev: { intent: "agenda_add", confidence: 1 } });
    await menu.respond("w1", "quero anotar no obsidian que a reunião do colegiado foi remarcada para o dia 10 às 14h na sala de reuniões do bloco principal");
    expect(noteAppend).toHaveBeenCalledWith("w1", "que a reunião do colegiado foi remarcada para o dia 10 às 14h na sala de reuniões do bloco principal".replace(/^que /, ""), expect.any(String), "pessoal@gmail.com");
  });

  it("frase longa e natural, com data e hora, é nota quando diz 'no obsidian'", async () => {
    const { menu, noteAppend } = build({ jev: { intent: "agenda_add", confidence: 1 } });
    await menu.respond("w1", "quero anotar no obsidian que a reunião do colegiado foi remarcada para o dia 10 às 14h na sala de reuniões do bloco principal");
    expect(noteAppend).toHaveBeenCalledWith("w1", "que a reunião do colegiado foi remarcada para o dia 10 às 14h na sala de reuniões do bloco principal".replace(/^que /, ""), expect.any(String), "pessoal@gmail.com");
  });

  it("'anota' solto (compromisso de agenda) não vira nota", async () => {
    const { menu, noteAppend } = build();
    await menu.respond("w1", "anota consulta dia 10 às 14h");
    await menu.respond("w1", "anota ligar pro Marcos");
    expect(noteAppend).not.toHaveBeenCalled();
  });

  it("senha no texto: avisa e não grava", async () => {
    const { menu, noteAppend } = build();
    const out = (await menu.respond("w1", "anota no obsidian: a senha do banco é Abc12345!")) as string;
    expect(noteAppend).not.toHaveBeenCalled();
    expect(out).toContain("Não envie senhas");
  });

  it("sem conteúdo, pergunta o que anotar", async () => {
    const { menu, noteAppend } = build();
    const out = (await menu.respond("w1", "nota:")) as string | null;
    expect(noteAppend).not.toHaveBeenCalled();
    expect(out === null || /O que devo anotar/.test(out)).toBe(true);
  });

  it("sem Google conectado, orienta a conectar", async () => {
    const { menu, noteAppend } = build({ accounts: [] });
    const out = (await menu.respond("w1", "anota no obsidian: comprar café")) as string;
    expect(noteAppend).not.toHaveBeenCalled();
    expect(out).toMatch(/Google/);
  });

  it("com várias contas, grava sempre no Drive pessoal (@gmail.com), qualquer que seja a ordem", async () => {
    const { menu, noteAppend } = build({ accounts: ["ana@ifce.edu.br", "pessoal@gmail.com"] });
    const out = (await menu.respond("w1", "anota no obsidian: comprar café")) as string;
    await menu.respond("w1", "anota no obsidian do ifce: reunião de colegiado");
    expect(noteAppend.mock.calls.map((c) => c[3])).toEqual(["pessoal@gmail.com", "pessoal@gmail.com"]);
    expect(out).toContain("Pessoal");
  });

  it("sem conta @gmail.com, usa a primeira conectada", async () => {
    const { menu, noteAppend } = build({ accounts: ["ana@ifce.edu.br", "ana@outro.com"] });
    await menu.respond("w1", "anota no obsidian: comprar café");
    expect(noteAppend.mock.calls[0][3]).toBe("ana@ifce.edu.br");
  });

  it("falha do Drive vira mensagem clara, sem derrubar", async () => {
    const { menu } = build({ appendError: "Esta conta ainda não liberou gravar notas no Drive. Reconecte o Google em Canais → Conectar Google." });
    const out = (await menu.respond("w1", "anota no obsidian: comprar café")) as string;
    expect(out).toContain("Não consegui anotar");
    expect(out).toContain("Reconecte o Google");
  });

  it("sem o serviço Drive liberado, não mexe no Drive", async () => {
    const { menu, noteAppend } = build();
    h.role = "USER";
    h.services = [];
    await menu.respond("w1", "anota no obsidian: comprar café");
    expect(noteAppend).not.toHaveBeenCalled();
  });

  it("numa tela de digitação, o texto não é tratado como nota", async () => {
    const { menu, noteAppend } = build();
    await menu.respond("w1", "drive"); // abre a busca de arquivos (tela _input)
    await menu.respond("w1", "anota no obsidian: comprar café");
    expect(noteAppend).not.toHaveBeenCalled();
  });
});

describe("menu: buscar nas notas", () => {
  it("'o que anotei sobre X' mostra os trechos", async () => {
    const { menu, noteSearch } = build({ hits: [{ id: "n1", nome: "2026-09-30.md", modificado: "2026-09-30T12:00:00Z", trechos: ["- 09:00 Contrato do Marcos assinado", "- 11:00 Revisar contrato"] }] });
    const out = (await menu.respond("w1", "o que anotei sobre o contrato do Marcos?")) as string;
    expect(noteSearch).toHaveBeenCalledWith("w1", ["contrato", "marcos"], "pessoal@gmail.com");
    expect(out).toContain("2026-09-30.md");
    expect(out).toContain("Contrato do Marcos assinado");
  });

  it("sem resultado, avisa", async () => {
    const { menu } = build({ hits: [] });
    const out = (await menu.respond("w1", "o que anotei sobre viagem")) as string;
    expect(out).toContain("Não achei nada sobre");
  });

  it("sem palavras úteis, pergunta sobre o quê", async () => {
    const { menu, noteSearch } = build();
    const out = (await menu.respond("w1", "o que eu anotei?")) as string;
    expect(noteSearch).not.toHaveBeenCalled();
    expect(out).toContain("Sobre o quê");
  });

  it("erro na busca vira mensagem clara", async () => {
    const { menu } = build({ searchError: "Google API 500" });
    const out = (await menu.respond("w1", "o que anotei sobre o contrato")) as string;
    expect(out).toContain("Não consegui buscar nas notas");
  });

  it("junta as contas e mostra a mais recente primeiro", async () => {
    const { menu, noteSearch } = build({ accounts: ["a@gmail.com", "b@ifce.edu.br"] });
    noteSearch.mockImplementation(async (_w: string, _t: string[], acc?: string) =>
      acc === "a@gmail.com"
        ? [{ id: "1", nome: "velha.md", modificado: "2026-01-01T00:00:00Z", trechos: ["- contrato velho"] }]
        : [{ id: "2", nome: "nova.md", modificado: "2026-09-01T00:00:00Z", trechos: ["- contrato novo"] }],
    );
    const out = (await menu.respond("w1", "o que anotei sobre contrato")) as string;
    expect(out.indexOf("nova.md")).toBeGreaterThan(-1);
    expect(out.indexOf("nova.md")).toBeLessThan(out.indexOf("velha.md"));
  });
});

describe("menu: 'anota ...' sem palavra explícita (Jev decide)", () => {
  it("Jev seguro de que é nota: grava", async () => {
    const { menu, noteAppend } = build({ jev: { intent: "note_add", confidence: 0.92 } });
    const out = (await menu.respond("w1", "anota ligar pro Marcos sobre o contrato")) as string;
    expect(noteAppend).toHaveBeenCalledWith("w1", "ligar pro Marcos sobre o contrato", expect.any(String), "pessoal@gmail.com");
    expect(out).toContain("Anotado");
  });

  it("Jev diz que é agenda: não vira nota", async () => {
    const { menu, noteAppend } = build({ jev: { intent: "agenda_add", confidence: 0.95 } });
    await menu.respond("w1", "anota consulta com o dentista dia 10 às 14h");
    expect(noteAppend).not.toHaveBeenCalled();
  });

  it("Jev inseguro (abaixo de 0,8) ou fora do ar: não grava", async () => {
    const unsure = build({ jev: { intent: "note_add", confidence: 0.7 } });
    await unsure.menu.respond("w1", "anota ligar pro Marcos sobre o contrato");
    expect(unsure.noteAppend).not.toHaveBeenCalled();
    const down = build({ jev: null });
    await down.menu.respond("w1", "anota ligar pro Marcos sobre o contrato");
    expect(down.noteAppend).not.toHaveBeenCalled();
  });

  it("mensagem que não começa como pedido de anotar nunca vira nota, mesmo que o Jev diga note_add", async () => {
    const { menu, noteAppend } = build({ jev: { intent: "note_add", confidence: 0.99 } });
    await menu.respond("w1", "preciso ligar pro Marcos sobre o contrato");
    expect(noteAppend).not.toHaveBeenCalled();
  });

  it("palavra explícita dispensa o Jev", async () => {
    const { menu, noteAppend, intents } = build({ jev: { intent: "agenda_add", confidence: 0.99 } });
    await menu.respond("w1", "anota no obsidian: reunião de colegiado dia 10");
    expect(noteAppend).toHaveBeenCalled();
    expect(intents.classify).not.toHaveBeenCalled();
  });

  it("senha com Jev também é barrada", async () => {
    const { menu, noteAppend } = build({ jev: { intent: "note_add", confidence: 0.95 } });
    const out = (await menu.respond("w1", "anota a senha do banco: Abc12345!")) as string;
    expect(noteAppend).not.toHaveBeenCalled();
    expect(out).toContain("Não envie senhas");
  });
});
