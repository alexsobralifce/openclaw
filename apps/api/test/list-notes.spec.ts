import { describe, expect, it } from "vitest";
import { addItems, cleanItem, cleanNoteTitle, fmtRemind, looksLikeNotesHome, parseCheck, parseItems, parseNoteCreate, parseNumbers, parseRemindAt, removeItems, sanitizeItems, toggleItems } from "../src/modules/channels/assistant/list-notes";

const TZ = "America/Fortaleza"; // UTC-3, sem horário de verão
// ter., 06/10/2026 17:11 em Fortaleza
const NOW = new Date("2026-10-06T20:11:00Z");
const at = (text: string) => {
  const r = parseRemindAt(text, TZ, NOW);
  return r.ok ? r.at.toISOString() : r.error;
};

describe("itens da nota", () => {
  it("separa por linha ou por vírgula e limpa marcadores", () => {
    expect(parseItems("leite, pão; ovos")).toEqual(["leite", "pão", "ovos"]);
    expect(parseItems("- leite\n• pão\n3. ovos\n[ ] café\n☐ açúcar")).toEqual(["leite", "pão", "ovos", "café", "açúcar"]);
    expect(parseItems("  ")).toEqual([]);
    expect(cleanItem("*leite* _integral_")).toBe("leite integral");
  });

  it("título limpo, com a primeira maiúscula", () => {
    expect(cleanNoteTitle("  *compras* do mês ")).toBe("Compras do mês");
    expect(cleanNoteTitle("")).toBe("");
  });

  it("adiciona, marca e remove por número, respeitando o teto de 50", () => {
    let items = addItems([], ["a", "b", "c"]).items;
    expect(items.map((i) => i.text)).toEqual(["a", "b", "c"]);
    items = toggleItems(items, [2]);
    expect(items.map((i) => i.done)).toEqual([false, true, false]);
    items = toggleItems(items, [2, 3]);
    expect(items.map((i) => i.done)).toEqual([false, false, true]);
    expect(removeItems(items, [1, 3]).map((i) => i.text)).toEqual(["b"]);
    expect(parseNumbers("1, 3 e 9", 3)).toEqual([1, 3]);
    const full = addItems([], Array.from({ length: 60 }, (_, i) => `item ${i}`));
    expect(full.items).toHaveLength(50);
    expect(addItems(full.items, ["mais"]).added).toBe(0);
  });

  it("lê itens do banco com segurança", () => {
    expect(sanitizeItems([{ text: "ok", done: true }, { text: "" }, null, "x"])).toEqual([{ text: "ok", done: true }]);
    expect(sanitizeItems("lixo")).toEqual([]);
  });
});

describe("comandos escritos", () => {
  it("cria nota com título e itens", () => {
    expect(parseNoteCreate("nota compras: leite, pão, ovos")).toEqual({ title: "Compras", items: ["leite", "pão", "ovos"] });
    expect(parseNoteCreate("Criar lista de mercado: arroz; feijão")).toEqual({ title: "Mercado", items: ["arroz", "feijão"] });
    expect(parseNoteCreate("nova nota viagem:\n- passagem\n- hotel")).toEqual({ title: "Viagem", items: ["passagem", "hotel"] });
    expect(parseNoteCreate("nota compras")).toBeNull();
    expect(parseNoteCreate("nota: leite")).toBeNull();
  });

  it("abre a tela de notas e marca itens por número", () => {
    expect(looksLikeNotesHome("notas")).toBe(true);
    expect(looksLikeNotesHome("minhas listas")).toBe(true);
    expect(looksLikeNotesHome("notas de contrato")).toBe(false);
    expect(parseCheck("feito 2")).toEqual({ nums: [2] });
    expect(parseCheck("marcar 1 e 3")).toEqual({ nums: [1, 3] });
    expect(parseCheck("marcar o item 4")).toEqual({ nums: [4] });
    expect(parseCheck("feito")).toBeNull();
  });
});

describe("data e hora do lembrete (fuso de Fortaleza, agora: ter. 06/10/2026 17:11)", () => {
  it("hoje, amanhã e depois de amanhã com hora", () => {
    expect(at("hoje 18h")).toBe("2026-10-06T21:00:00.000Z");
    expect(at("amanhã 9h")).toBe("2026-10-07T12:00:00.000Z");
    expect(at("amanhã às 9:30")).toBe("2026-10-07T12:30:00.000Z");
    expect(at("depois de amanhã às 14h")).toBe("2026-10-08T17:00:00.000Z");
    expect(at("amanhã 9 da manhã")).toBe("2026-10-07T12:00:00.000Z");
    expect(at("amanhã 8 da noite")).toBe("2026-10-07T23:00:00.000Z");
    expect(at("amanhã meio dia")).toBe("2026-10-07T15:00:00.000Z");
  });

  it("data, dia do mês e dia da semana", () => {
    expect(at("15/10 às 14h")).toBe("2026-10-15T17:00:00.000Z");
    expect(at("15/10/2026 9h30")).toBe("2026-10-15T12:30:00.000Z");
    expect(at("dia 20 às 10h")).toBe("2026-10-20T13:00:00.000Z");
    expect(at("dia 2 às 10h")).toBe("2026-11-02T13:00:00.000Z"); // dia 2 já passou neste mês
    expect(at("sexta 8h")).toBe("2026-10-09T11:00:00.000Z");
    expect(at("terça-feira 8h")).toBe("2026-10-13T11:00:00.000Z"); // hoje é terça e 8h já passou: vale a próxima
    expect(at("05/10 9h")).toBe("2027-10-05T12:00:00.000Z"); // sem ano e já passou: ano que vem
  });

  it("só a hora: hoje se ainda não passou, senão amanhã", () => {
    expect(at("às 18h")).toBe("2026-10-06T21:00:00.000Z");
    expect(at("às 9h")).toBe("2026-10-07T12:00:00.000Z");
  });

  it("tempo relativo", () => {
    expect(at("daqui a 2 horas")).toBe("2026-10-06T22:11:00.000Z");
    expect(at("em 30 minutos")).toBe("2026-10-06T20:41:00.000Z");
  });

  it("recusa o que não dá para marcar", () => {
    expect(at("amanhã")).toMatch(/Faltou a hora/);
    expect(at("qualquer hora")).toMatch(/Não entendi/);
    expect(at("hoje 10h")).toMatch(/já passou/);
    expect(at("32/13 10h")).toMatch(/Não entendi essa data/);
    expect(at("")).toMatch(/Diga quando/);
  });

  it("mostra a data no fuso do dono", () => {
    expect(fmtRemind("2026-10-07T12:00:00Z", TZ)).toBe("qua., 07/10 às 09:00");
  });
});
