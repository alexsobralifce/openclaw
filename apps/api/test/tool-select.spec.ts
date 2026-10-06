import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { TOOLS } from "../src/modules/channels/assistant/assistant.service";
import { GROUPED_TOOLS, selectToolNames } from "../src/modules/channels/assistant/tool-select";

const names = (t: string) => [...(selectToolNames(t) ?? [])].sort();

describe("ferramentas enviadas à IA livre", () => {
  it("toda ferramenta pertence a algum assunto (senão ela nunca seria enviada)", () => {
    const all = TOOLS.map((t) => t.function.name);
    expect(all.filter((n) => !GROUPED_TOOLS.has(n))).toEqual([]);
    expect([...GROUPED_TOOLS].filter((n) => !all.includes(n))).toEqual([]);
  });

  it("pedido de um assunto manda só as ferramentas dele", () => {
    expect(names("como está o tempo amanhã?")).toEqual(expect.arrayContaining(["get_weather", "set_location"]));
    expect(names("vai chover hoje?")).not.toContain("gmail_send");
    expect(names("anota que preciso comprar café")).toEqual(["note_add", "note_search"]);
    expect(names("o que anotei sobre o contrato?")).toEqual(expect.arrayContaining(["note_search"]));
  });

  it("lista, nota e lembrete trazem as ferramentas de notas em lista; anotar solto segue no diário", () => {
    expect(names("faz uma lista de compras: leite e pão")).toEqual(["note_create", "note_list", "note_update"]);
    expect(names("cria uma nota chamada viagem")).toEqual(expect.arrayContaining(["note_create"]));
    expect(names("me avisa amanhã às 9h para ligar pro banco")).toEqual(expect.arrayContaining(["note_create"]));
    expect(names("anota no obsidian que preciso ligar")).toEqual(["note_add", "note_search"]);
  });

  it("e-mail traz a busca de contatos; arquivo traz e-mail (pode ir anexo)", () => {
    expect(names("responde o email do Marcos")).toEqual(expect.arrayContaining(["gmail_read", "gmail_send", "contact_search"]));
    expect(names("manda o contrato pro Marcos")).toEqual(expect.arrayContaining(["drive_search", "drive_send_file", "gmail_send"]));
  });

  it("agenda reconhece criar e listar", () => {
    expect(names("marca uma reunião sexta às 10h")).toEqual(expect.arrayContaining(["calendar_create_event", "calendar_list_events"]));
  });

  it("sem assunto reconhecido, ou assunto demais, vão todas (null)", () => {
    expect(selectToolNames("oi, tudo bem?")).toBeNull();
    expect(selectToolNames("me explica como funciona a fotossíntese")).toBeNull();
    expect(selectToolNames("vê meus emails, a agenda, o clima, anota isso e lembra a rotina de academia")).toBeNull();
  });

  it("acento e maiúscula não atrapalham", () => {
    expect(names("QUAL É A MINHA AGENDA?")).toEqual(expect.arrayContaining(["calendar_list_events"]));
    expect(names("Previsão do tempo")).toEqual(expect.arrayContaining(["get_weather"]));
  });

  it("o conjunto escolhido é bem menor que o total", () => {
    const total = JSON.stringify(TOOLS).length;
    const some = TOOLS.filter((t) => selectToolNames("anota ligar pro Marcos")!.has(t.function.name));
    expect(JSON.stringify(some).length).toBeLessThan(total * 0.25);
  });
});

import { JEV_INCLUDE_MIN, JEV_NONE_MAX, pickTools } from "../src/modules/channels/assistant/tool-select";

const judged = (p: Record<string, number>) => async () => Object.entries(p).map(([id, v]) => ({ id, p: v }));
const base = { clientes: 0.01, memoria: 0.01, email: 0.01, drive: 0.01, contatos: 0.01, notas: 0.01, rotina: 0.01, clima: 0.01, agenda: 0.01 };

describe("ferramentas com o Jev (quando as palavras-chave não reconhecem assunto)", () => {
  it("palavras-chave resolvem: o Jev nem é consultado", async () => {
    const judge = vi.fn(judged(base));
    const picked = await pickTools("anota ligar pro Marcos", judge);
    expect(picked?.has("note_add")).toBe(true);
    expect(judge).not.toHaveBeenCalled();
  });

  it("sem palavra-chave, o assunto que o Jev aponta vale (e traz os acompanhantes)", async () => {
    const picked = await pickTools("cadê aquilo que a Ana me escreveu?", judged({ ...base, email: 0.9 }));
    expect(picked?.has("gmail_search")).toBe(true);
    expect(picked?.has("contact_search")).toBe(true);
    expect(picked?.has("calendar_create_event")).toBe(false);
  });

  it("margem: probabilidade a partir de 20% já inclui o assunto", async () => {
    const picked = await pickTools("hmm", judged({ ...base, agenda: JEV_INCLUDE_MIN, notas: JEV_INCLUDE_MIN - 0.01 }));
    expect(picked?.has("calendar_list_events")).toBe(true);
    expect(picked?.has("note_add")).toBe(false);
  });

  it("conversa geral só se o Jev tiver certeza (todos abaixo de 10%): vai o mínimo", async () => {
    const picked = await pickTools("qual a capital da França", judged(base));
    expect([...picked!].sort()).toEqual(["list_memories", "remember"]);
    expect(base.agenda).toBeLessThan(JEV_NONE_MAX);
  });

  it("no meio-termo (entre 10% e 20%) vão todas as ferramentas", async () => {
    expect(await pickTools("hmm", judged({ ...base, email: 0.15 }))).toBeNull();
  });

  it("assuntos demais, Jev fora do ar, erro ou resposta vazia: todas as ferramentas", async () => {
    expect(await pickTools("hmm", judged({ ...base, email: 0.9, agenda: 0.9, notas: 0.9, drive: 0.9, clima: 0.9 }))).toBeNull();
    expect(await pickTools("hmm", async () => null)).toBeNull();
    expect(await pickTools("hmm", async () => [])).toBeNull();
    expect(await pickTools("hmm", async () => { throw new Error("fora do ar"); })).toBeNull();
    expect(await pickTools("hmm", undefined)).toBeNull();
  });
});
