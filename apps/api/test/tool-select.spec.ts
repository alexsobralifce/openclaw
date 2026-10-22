
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
