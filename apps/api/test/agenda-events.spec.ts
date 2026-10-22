import { describe, expect, it } from "vitest";
import { extractUrls, looksLikeAgendaIntent, nextDay, parseEventsPlan } from "../src/modules/channels/assistant/agenda-events";
import { normalize } from "../src/modules/channels/assistant/voice";

// 2026-09-28 12:00 em Fortaleza
const NOW = Date.parse("2026-09-28T12:00:00-03:00");
const json = (eventos: any[], erro: string | null = null) => JSON.stringify({ eventos, erro });

describe("parseEventsPlan", () => {
  it("lê vários eventos, ordena por data e completa o fim com 1 hora", () => {
    const plan = parseEventsPlan(
      json([
        { titulo: "Dentista", inicio: "2026-10-05T09:00:00-03:00", fim: null },
        { titulo: "Reunião", inicio: "2026-10-01T14:00:00-03:00", fim: "2026-10-01T15:30:00-03:00", descricao: "Sala 2" },
      ]),
      NOW,
    );
    expect(plan.events.map((e) => e.title)).toEqual(["Reunião", "Dentista"]);
    expect(plan.events[0]).toMatchObject({ end: "2026-10-01T15:30:00-03:00", description: "Sala 2" });
    expect(plan.events[1].end).toBe("2026-10-05T10:00:00-03:00");
  });

  it("evento sem hora vira dia inteiro", () => {
    const plan = parseEventsPlan(json([{ titulo: "Prazo do TCC", inicio: "2026-10-10" }]), NOW);
    expect(plan.events[0]).toMatchObject({ start: "2026-10-10", end: "2026-10-10" });
  });

  it("descarta sem título, data inválida, muito antigo ou distante, e repetidos", () => {
    const plan = parseEventsPlan(
      json([
        { titulo: "", inicio: "2026-10-01" },
        { titulo: "Sem dia", inicio: "amanhã" },
        { titulo: "Dia que não existe", inicio: "2026-02-31" },
        { titulo: "Antigo", inicio: "2026-08-01T10:00:00-03:00" },
        { titulo: "Longe", inicio: "2031-01-01" },
        { titulo: "Ok", inicio: "2026-10-02T08:00:00-03:00" },
        { titulo: "ok", inicio: "2026-10-02T08:00:00-03:00" },
      ]),
      NOW,
    );
    expect(plan.events.map((e) => e.title)).toEqual(["Ok"]);
    expect(plan.skipped).toHaveLength(4);
  });

  it("fim antes do início é corrigido; aceita cerca ```json e texto em volta", () => {
    const raw = "Aqui está:\n```json\n" + json([{ titulo: "A", inicio: "2026-10-02T10:00:00-03:00", fim: "2026-10-02T09:00:00-03:00" }]) + "\n```";
    const plan = parseEventsPlan(raw, NOW);
    expect(plan.events[0].end).toBe("2026-10-02T11:00:00-03:00");
  });

  it("respeita o teto de eventos e conta os que ficaram de fora", () => {
    const eventos = Array.from({ length: 25 }, (_, i) => ({ titulo: `E${i}`, inicio: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00-03:00` }));
    const plan = parseEventsPlan(json(eventos), NOW);
    expect(plan.events).toHaveLength(20);
    expect(plan.truncated).toBe(5);
  });

  it("sem eventos devolve o motivo; JSON quebrado não estoura", () => {
    expect(parseEventsPlan(json([], "só tem propaganda"), NOW).error).toBe("só tem propaganda");
    expect(parseEventsPlan("isso não é json", NOW).events).toEqual([]);
  });
});

describe("links e intenção", () => {
  it("extrai links sem a pontuação colada, sem repetir", () => {
    expect(extractUrls("veja https://site.com/evento, e (https://outro.com/a). https://site.com/evento")).toEqual(["https://site.com/evento", "https://outro.com/a"]);
    expect(extractUrls("sem link")).toEqual([]);
  });

  it("reconhece pedidos para pôr na agenda, mas não perguntas", () => {
    for (const t of ["Adicione esses compromissos na agenda", "cria os eventos no calendário", "marque na agenda: dentista dia 5"]) expect(looksLikeAgendaIntent(normalize(t))).toBe(true);
    for (const t of ["o que tenho na agenda amanhã", "mostre a agenda", "oi"]) expect(looksLikeAgendaIntent(normalize(t))).toBe(false);
  });

  it("nextDay passa de mês e de ano", () => {
    expect(nextDay("2026-10-10")).toBe("2026-10-11");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});
