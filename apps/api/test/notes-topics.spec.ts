import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "ROOT", services: [] as string[] }));
vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: h.role, services: h.services, name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { cleanTitle, cleanTopic, looksLikeNoteCaption, looksLikeNotesHome, noteFileName, noteWithTopic, parseNotePlan, pickTopic, renderNote, topicRequest } from "../src/modules/channels/assistant/notes";

describe("notas por assunto: lógica pura", () => {
  it("assunto e título viram nomes seguros", () => {
    expect(cleanTopic("  contratos/../x  ")).toBe("Contratos .. x");
    expect(cleanTopic("")).toBe("Geral");
    expect(cleanTopic(undefined)).toBe("Geral");
    expect(cleanTitle("a'b\"c\nd#e")).toBe("a b c d e");
    expect(noteFileName("2026-10-02", "Contrato: aluguel")).toBe("2026-10-02 Contrato aluguel.md");
  });

  it("renderNote põe propriedades no topo e o título", () => {
    const md = renderNote({ title: "Aluguel", topic: "Contratos", content: "- prazo dia 10" }, "2026-10-02", "arquivo");
    expect(md).toContain("assunto: Contratos");
    expect(md).toContain("tags: [contratos]");
    expect(md).toContain("# Aluguel\n\n- prazo dia 10");
  });

  it("parseNotePlan lê o JSON da IA e recusa resposta sem conteúdo", () => {
    const ok = parseNotePlan('```json\n{"titulo":"Aluguel","assunto":"contratos","conteudo":"Resumo","erro":null}\n```');
    expect(ok.note).toEqual({ title: "Aluguel", topic: "Contratos", content: "Resumo" });
    expect(parseNotePlan('{"conteudo":"","erro":"página em branco"}').error).toBe("página em branco");
    expect(parseNotePlan("lixo").error).toBeTruthy();
  });

  it("'nota sobre X: texto' traz assunto e texto; sem dois pontos não vira nota", () => {
    expect(noteWithTopic("nota sobre Contrato: o prazo vence dia 10")).toEqual({ topic: "Contrato", content: "o prazo vence dia 10" });
    expect(noteWithTopic("Criar nota de saúde - consulta com a Dra. Ana")).toEqual({ topic: "Saúde", content: "consulta com a Dra. Ana" });
    expect(noteWithTopic("notas sobre contrato")).toBeNull();
    expect(noteWithTopic("nota: ideia de tela")).toBeNull();
  });

  it("reconhece abrir notas, assunto pedido e legenda", () => {
    expect(looksLikeNotesHome("minhas notas")).toBe(true);
    expect(looksLikeNotesHome("notas")).toBe(true);
    expect(looksLikeNotesHome("notas de contrato")).toBe(false);
    expect(topicRequest("notas de contrato")).toBe("contrato");
    expect(topicRequest("ver notas sobre reuniao")).toBe("reuniao");
    expect(looksLikeNoteCaption("salvar como nota sobre contrato")).toBe(true);
    expect(looksLikeNoteCaption("convite da reuniao")).toBe(false);
  });

  it("pickTopic acha por nome sem acento ou parte do nome", () => {
    const t = [{ name: "Saúde" }, { name: "Contratos" }];
    expect(pickTopic(t, "saude")).toBe(t[0]);
    expect(pickTopic(t, "contrato")).toBe(t[1]);
    expect(pickTopic(t, "xyz")).toBeUndefined();
  });
});

function build(opts: { topics?: { id: string; name: string }[]; gemini?: string | null; createError?: string } = {}) {
  h.role = "ROOT";
  h.services = [];
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const noteCreate = vi.fn(async (_ws: string, d: any) => {
    if (opts.createError) throw new Error(opts.createError);
    return { assunto: d.topic, nome: "2026-10-02 x.md" };
  });
  const noteTopics = vi.fn(async () => opts.topics ?? []);
  const notesIn = vi.fn(async () => [{ id: "nota0001", name: "2026-10-02 Aluguel" }]);
  const noteRead = vi.fn(async () => ({ name: "2026-10-02 Aluguel", topic: "Contratos", content: "---\nassunto: Contratos\n---\n# Aluguel\n\nprazo dia 10" }));
  const google = { listAccounts: async () => ["a@ifce.edu.br", "pessoal@gmail.com"], noteCreate, noteTopics, notesIn, noteRead };
  const extract = vi.fn(async () => {
    if (opts.gemini === null) throw new Error("falhou");
    return opts.gemini ?? '{"titulo":"Aluguel","assunto":"Contratos","conteudo":"Resumo\\n- prazo dia 10","erro":null}';
  });
  const gemini = { enabled: () => true, extract };
  const memory = { promptBlock: async () => "", listRoutine: async () => [] };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any, gemini as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, store, google, noteCreate, noteTopics, notesIn, noteRead, extract };
}

describe("menu: Notas por assunto", () => {
  it("o menu principal tem o item Notas e ele explica como pedir", async () => {
    const { menu } = build({ topics: [{ id: "t1abcdefgh", name: "Contratos" }] });
    const main = (await menu.respond("w1", "menu")) as string;
    expect(main).toContain("Notas");
    const n = main.split("\n").findIndex((l) => l.includes("📝 Notas"));
    expect(n).toBeGreaterThan(-1);
    const entry = (await menu.respond("w1", "notas")) as string;
    expect(entry).toContain("nota sobre");
    expect(entry).toContain("PDF");
    expect(entry).toContain("Contratos");
  });

  it("'nota sobre Contrato: ...' cria a nota no assunto, no Drive pessoal", async () => {
    const { menu, noteCreate } = build();
    const out = (await menu.respond("w1", "nota sobre contrato: o prazo vence dia 10")) as string;
    expect(noteCreate).toHaveBeenCalledWith("w1", { topic: "Contrato", content: "o prazo vence dia 10", title: "o prazo vence dia 10" }, expect.any(String), "pessoal@gmail.com", "whatsapp");
    expect(out).toContain("Nota criada");
    expect(out).toContain("Contrato");
  });

  it("nota com senha é recusada", async () => {
    const { menu, noteCreate } = build();
    await menu.respond("w1", "nota sobre acessos: a senha do wifi é Abc12345!");
    expect(noteCreate).not.toHaveBeenCalled();
  });

  it("navega: assunto pelo número → nota pelo número → conteúdo sem as propriedades", async () => {
    const { menu, notesIn, noteRead } = build({ topics: [{ id: "t1abcdefgh", name: "Contratos" }] });
    await menu.respond("w1", "notas");
    const list = (await menu.respond("w1", "1")) as string;
    expect(notesIn).toHaveBeenCalledWith("w1", "t1abcdefgh", "pessoal@gmail.com");
    expect(list).toContain("Aluguel");
    const view = (await menu.respond("w1", "1")) as string;
    expect(noteRead).toHaveBeenCalledWith("w1", "nota0001", "pessoal@gmail.com");
    expect(view).toContain("prazo dia 10");
    expect(view).not.toContain("assunto: Contratos");
  });

  it("'notas de saude' abre o assunto pelo nome; assunto inexistente volta à tela com aviso", async () => {
    const { menu } = build({ topics: [{ id: "t2abcdefgh", name: "Saúde" }] });
    expect(await menu.respond("w1", "notas de saude")).toContain("Saúde");
    const miss = (await menu.respond("w1", "notas de viagem")) as string;
    expect(miss).toContain("Não achei o assunto");
  });

  it("PDF na tela de Notas vira nota; a IA recebe os assuntos existentes e a legenda", async () => {
    const { menu, extract, noteCreate } = build({ topics: [{ id: "t1abcdefgh", name: "Contratos" }] });
    await menu.respond("w1", "notas");
    expect(await menu.agendaMediaIntent("w1", "")).toBe("note");
    const out = await menu.noteIngest("w1", { text: "nota sobre contrato", media: [{ mime: "application/pdf", base64: "AAAA" }] });
    expect(extract.mock.calls[0][0]).toContain("Contratos");
    expect(extract.mock.calls[0][1].text).toContain("nota sobre contrato");
    expect(noteCreate).toHaveBeenCalledWith("w1", { title: "Aluguel", topic: "Contratos", content: "Resumo\n- prazo dia 10" }, expect.any(String), "pessoal@gmail.com", "arquivo");
    expect(out).toContain("Nota criada");
  });

  it("legenda com 'nota' vira nota mesmo fora da tela; sem sinal, só orienta; agenda segue valendo", async () => {
    const { menu } = build();
    expect(await menu.agendaMediaIntent("w1", "salvar como nota")).toBe("note");
    expect(await menu.agendaMediaIntent("w1", "")).toBe("hint");
    expect(await menu.agendaMediaIntent("w1", "adicionar na agenda")).toBe("yes");
  });

  it("falha na leitura ou PDF sem texto não grava nada", async () => {
    const a = build({ gemini: null });
    expect(await a.menu.noteIngest("w1", { media: [{ mime: "application/pdf", base64: "AAAA" }] })).toContain("Não consegui ler");
    expect(a.noteCreate).not.toHaveBeenCalled();
    const b = build({ gemini: '{"conteudo":"","erro":"página em branco"}' });
    expect(await b.menu.noteIngest("w1", { media: [{ mime: "application/pdf", base64: "AAAA" }] })).toContain("página em branco");
    expect(b.noteCreate).not.toHaveBeenCalled();
  });

  it("erro do Drive ao criar é mostrado sem derrubar o fluxo", async () => {
    const { menu } = build({ createError: "Reconecte o Google" });
    expect(await menu.respond("w1", "nota sobre contrato: algo importante")).toContain("Reconecte o Google");
  });
});
