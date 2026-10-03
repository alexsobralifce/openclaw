import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => ({
  choice: (instructions: unknown, criteria: unknown) => ({ type: "choice", instructions, criteria }),
  noul: (q: unknown) => ({ type: "noul", q }),
  TypeSafeClient: class {
    systemOne = systemOne;
  },
}));

import { Contact, fuzzyCandidates } from "../src/modules/channels/assistant/contacts";
import { IntentService } from "../src/modules/channels/assistant/intent.service";
import { emailSearchSpec } from "../src/modules/channels/assistant/email-search";

const c = (nome: string, email = ""): Contact => ({ nome, telefones: [], emails: email ? [email] : [] });

describe("candidatos parecidos (peneira antes do Jev)", () => {
  const list = [c("Arnaldo Pereira"), c("Maria Souza"), c("Arnaud Silva"), c("Joao Pedro"), c("Marcelo Arnoud")];
  const names = (q: string) => fuzzyCandidates(list, q).map((x) => x.nome);

  it("acha grafia parecida e põe os mais parecidos primeiro", () => {
    // "Arnaldo" é outro nome (3 letras de diferença): fica de fora
    expect(names("arnoud")).toEqual(["Marcelo Arnoud", "Arnaud Silva"]);
  });
  it("ignora sufixos e ligações do pedido", () => {
    expect(names("arnoud jr")).toEqual(names("arnoud"));
  });
  it("não devolve o que não tem nada a ver, nem palavras curtas demais", () => {
    expect(names("xyzkw")).toEqual([]);
    expect(names("jo")).toEqual([]);
    expect(fuzzyCandidates(list, "")).toEqual([]);
  });
  it("respeita o máximo", () => {
    expect(fuzzyCandidates(list, "arnoud", 1)).toHaveLength(1);
  });
});

describe("Jev escolhe a pessoa", () => {
  beforeEach(() => {
    systemOne.mockReset();
    process.env.TYPESAFE_API_KEY = "test";
  });
  afterEach(() => {
    delete process.env.TYPESAFE_API_KEY;
  });
  const cands = [{ nome: "Arnaud Silva", email: "arnaud@x.com" } as any, { nome: "Arnaldo Pereira" }];

  it("devolve o índice do candidato quando está seguro", async () => {
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "c0", confidence: 0.93 } } });
    expect(await new IntentService().pickPerson("arnoud jr", cands)).toBe(0);
    const sent = systemOne.mock.calls[0][0];
    expect(sent.state).toEqual({ pedido: "arnoud jr" });
    expect(JSON.stringify(sent)).not.toContain("arnaud@x.com"); // e-mail de contato nunca vai ao Jev
    expect(sent.questions.escolha.criteria).toMatchObject({ c0: "Arnaud Silva", c1: "Arnaldo Pereira", nenhum: expect.any(String) });
  });
  it("na dúvida, 'nenhum', erro ou sem chave: não escolhe ninguém", async () => {
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "c1", confidence: 0.6 } } });
    expect(await new IntentService().pickPerson("arnoud", cands)).toBeNull();
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "nenhum", confidence: 0.97 } } });
    expect(await new IntentService().pickPerson("arnoud", cands)).toBeNull();
    systemOne.mockRejectedValue(new Error("timeout"));
    expect(await new IntentService().pickPerson("arnoud", cands)).toBeNull();
    delete process.env.TYPESAFE_API_KEY;
    systemOne.mockClear();
    expect(await new IntentService().pickPerson("arnoud", cands)).toBeNull();
    expect(systemOne).not.toHaveBeenCalled();
  });
  it("manda no máximo 8 candidatos", async () => {
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "nenhum", confidence: 0.9 } } });
    await new IntentService().pickPerson("x", Array.from({ length: 20 }, (_, i) => ({ nome: `Fulano ${i}` })));
    expect(Object.keys(systemOne.mock.calls[0][0].questions.escolha.criteria)).toHaveLength(9);
  });
});

describe("e-mails de uma pessoa", () => {
  it("guarda o nome sem o sufixo para achar os endereços nos contatos", () => {
    expect(emailSearchSpec("buscar emails do arnaud jr")?.person).toBe("arnaud");
    expect(emailSearchSpec("emails sobre contrato")?.person).toBeUndefined();
  });
});
