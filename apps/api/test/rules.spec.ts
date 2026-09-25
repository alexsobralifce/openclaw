import { describe, expect, it } from "vitest";
import { render, ruleMatches, validateRule, withinHours } from "../src/modules/automations/rules";

const ctx = (body: string, now = new Date("2026-09-24T15:00:00Z")) => ({ message: { body, type: "TEXT" }, channelId: "ch1", now, timeZone: "America/Fortaleza" });

describe("validação de automações", () => {
  it("normaliza um gatilho válido", () => {
    const r = validateRule(
      { event: "message.received", conditions: [{ field: "message.body", op: "contains", value: " preço " }] },
      [{ type: "send_message", text: "Olá {{contato.nome}}" }],
    );
    expect(r.trigger).toEqual({ event: "message.received", conditions: [{ field: "message.body", op: "contains", value: "preço" }], cooldownMinutes: 0 });
  });

  it("rejeita evento, condição e ação inválidos com mensagem clara", () => {
    expect(() => validateRule({ event: "x" }, [{ type: "send_message", text: "a" }])).toThrow(/evento inválido/);
    expect(() => validateRule({ event: "message.received", conditions: [{ field: "message.body", op: "matches", value: "(a+)+" }] }, [{ type: "send_message", text: "a" }])).toThrow(/operador inválido/);
    expect(() => validateRule({ event: "message.received" }, [])).toThrow(/ações/);
    expect(() => validateRule({ event: "message.received" }, [{ type: "delete_all" }])).toThrow(/tipo inválido/);
    expect(() => validateRule({ event: "message.received", conditions: [{ field: "time", op: "outside", value: { start: "8h", end: "18:00" } }] }, [{ type: "set_status", status: "PENDING" }])).toThrow(/HH:MM/);
  });
});

describe("avaliação", () => {
  it("texto sem diferenciar maiúsculas e acentos", () => {
    const { trigger } = validateRule({ event: "message.received", conditions: [{ field: "message.body", op: "contains", value: "preco" }] }, [{ type: "add_tag", tag: "lead" }]);
    expect(ruleMatches(trigger, "message.received", ctx("Qual o PREÇO?"))).toBe(true);
    expect(ruleMatches(trigger, "message.received", ctx("bom dia"))).toBe(false);
    expect(ruleMatches(trigger, "conversation.created", ctx("preço"))).toBe(false);
  });

  it("horário comercial no fuso do negócio", () => {
    const hours = { days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };
    // 24/09/2026 é quinta; 15:00Z = 12:00 em Fortaleza
    expect(withinHours(new Date("2026-09-24T15:00:00Z"), "America/Fortaleza", hours)).toBe(true);
    // 23:30Z = 20:30 em Fortaleza
    expect(withinHours(new Date("2026-09-24T23:30:00Z"), "America/Fortaleza", hours)).toBe(false);
    // sábado
    expect(withinHours(new Date("2026-09-26T15:00:00Z"), "America/Fortaleza", hours)).toBe(false);
    // janela que cruza a meia-noite
    expect(withinHours(new Date("2026-09-25T04:00:00Z"), "America/Fortaleza", { days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" })).toBe(true);
  });

  it("variáveis do contato", () => {
    expect(render("Oi {{contato.nome}}, seu número é {{ contato.telefone }}", { name: "Ana", phone: "5585" })).toBe("Oi Ana, seu número é 5585");
  });
});
