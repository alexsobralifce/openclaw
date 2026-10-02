import { describe, expect, it } from "vitest";
import { normalize } from "../src/modules/channels/assistant/voice";
import {
  appendEntry,
  dailyFileName,
  dayStamp,
  formatEntry,
  looksLikeNoteAdd,
  looksLikeNoteSearch,
  noteTerms,
  noteTextFrom,
  snippets,
} from "../src/modules/channels/assistant/notes";

const add = (t: string) => looksLikeNoteAdd(normalize(t));
const search = (t: string) => looksLikeNoteSearch(normalize(t));

describe("pedido de guardar nota", () => {
  it("reconhece quando há palavra explícita", () => {
    expect(add("anota no obsidian: ligar pro Marcos sobre o contrato")).toBe(true);
    expect(add("Salva no diário que a reunião foi remarcada")).toBe(true);
    expect(add("guarda isso no meu caderno: ideia de tela de relatório")).toBe(true);
    expect(add("nota: ideia de tela de relatório #projeto")).toBe(true);
    expect(add("por favor anota no obsidian comprar café")).toBe(true);
  });
  it("'anota' solto fica de fora (pode ser compromisso de agenda)", () => {
    expect(add("anota consulta dia 10 às 14h")).toBe(false);
    expect(add("anota ligar pro Marcos")).toBe(false);
    expect(add("marcar reunião amanhã")).toBe(false);
  });
  it("pergunta sobre notas não é pedido de guardar", () => {
    expect(add("o que anotei sobre o contrato")).toBe(false);
    expect(add("procura nas minhas notas o contrato")).toBe(false);
  });
});

describe("pedido de buscar nota", () => {
  it("reconhece perguntas sobre o que foi anotado", () => {
    expect(search("o que anotei sobre o contrato?")).toBe(true);
    expect(search("o que eu anotei ontem sobre o Marcos")).toBe(true);
    expect(search("procura nas minhas notas o contrato")).toBe(true);
    expect(search("buscar no obsidian reunião de quinta")).toBe(true);
  });
  it("não sequestra outros pedidos", () => {
    expect(search("o que tem na agenda hoje")).toBe(false);
    expect(search("buscar no drive o contrato")).toBe(false);
    expect(search("anota no obsidian: ligar pro Marcos")).toBe(false);
  });
});

describe("noteTextFrom", () => {
  it("tira o pedido e deixa o conteúdo", () => {
    expect(noteTextFrom("anota no obsidian: ligar pro Marcos sobre o contrato")).toBe("ligar pro Marcos sobre o contrato");
    expect(noteTextFrom("Salva no diário que a reunião foi remarcada")).toBe("a reunião foi remarcada");
    expect(noteTextFrom("guarda isso no meu caderno: ideia de tela #projeto")).toBe("ideia de tela #projeto");
    expect(noteTextFrom("nota: ideia de tela de relatório")).toBe("ideia de tela de relatório");
    expect(noteTextFrom("por favor anota no obsidian comprar café")).toBe("comprar café");
  });
  it("tira o lugar quando vem no fim", () => {
    expect(noteTextFrom("anota ligar pro Marcos no obsidian")).toBe("ligar pro Marcos");
  });
  it("limita o tamanho e junta quebras de linha", () => {
    expect(noteTextFrom(`nota: ${"a".repeat(2_000)}`)).toHaveLength(1_000);
    expect(noteTextFrom("nota: linha 1\n\nlinha 2")).toBe("linha 1 linha 2");
  });
});

describe("noteTerms", () => {
  it("deixa só as palavras úteis", () => {
    expect(noteTerms("o que anotei sobre o contrato do Marcos?")).toEqual(["contrato", "marcos"]);
    expect(noteTerms("procura nas minhas notas reunião de quinta")).toEqual(["reuniao", "quinta"]);
  });
  it("sem palavras úteis, devolve vazio", () => {
    expect(noteTerms("o que eu anotei?")).toEqual([]);
  });
});

describe("nota do dia", () => {
  // 2026-10-02 00:30 UTC = 21:30 do dia 1º em Fortaleza (UTC-3)
  const at = new Date("2026-10-02T00:30:00Z");
  const tz = "America/Fortaleza";

  it("o dia segue o fuso, não o UTC", () => {
    expect(dayStamp(at, tz)).toBe("2026-10-01");
    expect(dailyFileName(at, tz)).toBe("2026-10-01.md");
  });
  it("formata uma linha com a hora", () => {
    expect(formatEntry(at, "ligar pro Marcos", tz)).toBe("- 21:30 ligar pro Marcos");
    expect(formatEntry(at, "linha 1\nlinha 2", tz)).toBe("- 21:30 linha 1 linha 2");
  });
  it("nota nova começa com o título da data", () => {
    expect(appendEntry("", "- 21:30 a", "2026-10-01")).toBe("# 2026-10-01\n\n- 21:30 a\n");
  });
  it("nota existente recebe a linha no fim, sem linhas em branco extras", () => {
    const base = "# 2026-10-01\n\n- 09:00 a\n\n\n";
    expect(appendEntry(base, "- 21:30 b", "2026-10-01")).toBe("# 2026-10-01\n\n- 09:00 a\n- 21:30 b\n");
  });
});

describe("snippets", () => {
  const content = "# 2026-10-01\n\n- 09:00 Ligar pro Marcos sobre o contrato\n- 10:00 Comprar café\n- 11:00 Contrato assinado";
  it("acha linhas por palavra, sem acento nem maiúsculas, e ignora o título", () => {
    expect(snippets(content, ["contrato"])).toEqual(["- 09:00 Ligar pro Marcos sobre o contrato", "- 11:00 Contrato assinado"]);
  });
  it("respeita o máximo e corta linhas longas", () => {
    expect(snippets(content, ["contrato"], 1)).toHaveLength(1);
    expect(snippets(`- ${"x".repeat(300)} contrato`, ["contrato"], 3, 20)[0]).toHaveLength(20);
  });
  it("sem palavras ou sem acerto, devolve vazio", () => {
    expect(snippets(content, [])).toEqual([]);
    expect(snippets(content, ["viagem"])).toEqual([]);
  });
});
