import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => ({
  choice: (instructions: unknown, criteria: unknown) => ({ type: "choice", instructions, criteria }),
  TypeSafeClient: class {
    systemOne = systemOne;
  },
}));

import { IntentService, MIN_CONFIDENCE, acceptIntent } from "../src/modules/channels/assistant/intent.service";

describe("intenção com o Jev", () => {
  beforeEach(() => {
    systemOne.mockReset();
    process.env.TYPESAFE_API_KEY = "test";
  });
  afterEach(() => {
    delete process.env.TYPESAFE_API_KEY;
  });

  it("sem chave não chama o Jev e devolve null", async () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(await new IntentService().classify("põe a prova na agenda")).toBeNull();
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("devolve a escolha e a confiança do Jev", async () => {
    systemOne.mockResolvedValue({ answers: { intent: { choice: "agenda_add", confidence: 0.93 } } });
    expect(await new IntentService().classify("dia 10 tenho prova de cálculo às 8h, não deixa eu esquecer")).toEqual({ intent: "agenda_add", confidence: 0.93 });
  });

  it("erro ou demora do serviço vira null, sem derrubar o menu", async () => {
    systemOne.mockRejectedValue(new Error("timeout"));
    expect(await new IntentService().classify("qualquer coisa")).toBeNull();
  });

  it("só aceita a intenção pedida com confiança suficiente", () => {
    expect(acceptIntent({ intent: "drive_file", confidence: 0.9 }, "drive_file")).toBe(true);
    expect(acceptIntent({ intent: "drive_file", confidence: MIN_CONFIDENCE - 0.01 }, "drive_file")).toBe(false);
    expect(acceptIntent({ intent: "agenda_add", confidence: 0.99 }, "drive_file")).toBe(false);
    expect(acceptIntent({ intent: "other", confidence: 0.99 }, "agenda_add")).toBe(false);
    expect(acceptIntent(null, "agenda_add")).toBe(false);
  });

  it("note_add é uma intenção própria, separada da agenda", async () => {
    systemOne.mockResolvedValue({ answers: { intent: { choice: "note_add", confidence: 0.9 } } });
    const r = await new IntentService().classify("anota ligar pro Marcos sobre o contrato");
    expect(r).toEqual({ intent: "note_add", confidence: 0.9 });
    expect(acceptIntent(r, "note_add")).toBe(true);
    expect(acceptIntent(r, "agenda_add")).toBe(false);
    const criteria = systemOne.mock.calls[0][0].questions.intent.criteria;
    expect(Object.keys(criteria)).toEqual(expect.arrayContaining(["agenda_add", "drive_file", "note_add", "other"]));
    // "anotar" não pode puxar para a agenda
    expect(criteria.agenda_add).not.toMatch(/anotar/);
  });
});
