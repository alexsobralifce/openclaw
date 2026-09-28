import { describe, expect, it } from "vitest";
import { driveQueryFrom, looksLikeDriveRequest, parseDriveQuery, rankFiles, sanitizeAlternates, similarity, wordVariants } from "../src/modules/channels/assistant/drive";
import { describeCode, parseForecast, weatherLines, weatherTip } from "../src/modules/channels/assistant/weather";
import { isLocationQuery, isWeatherQuery, parseCityCommand } from "../src/modules/channels/assistant/location";
import { normalizeDays, sanitizeRoutine, todayItems, when } from "../src/modules/channels/assistant/routine";
import { normalize } from "../src/modules/channels/assistant/voice";
import { locationOf } from "../src/modules/channels/whatsapp/parse";

describe("pedido de arquivo do Drive", () => {
  it("reconhece o pedido e extrai só o nome", () => {
    expect(looksLikeDriveRequest(normalize("me manda o contrato de aluguel do drive"))).toBe(true);
    expect(looksLikeDriveRequest(normalize("drive relatório de vendas"))).toBe(true);
    expect(looksLikeDriveRequest(normalize("qual a capital da França"))).toBe(false);
    expect(driveQueryFrom("me manda o Contrato de Aluguel do meu drive, por favor")).toBe("Contrato Aluguel");
  });

  it("música e outros tipos viram filtro, não termo do nome", () => {
    expect(parseDriveQuery("me manda a música Evidências do drive")).toMatchObject({ terms: ["Evidências"], kind: "audio", alternates: ["música"] });
    expect(parseDriveQuery("planilha de gastos setembro")).toMatchObject({ terms: ["gastos", "setembro"], kind: "sheet" });
    expect(parseDriveQuery("contrato aluguel pdf")).toMatchObject({ terms: ["contrato", "aluguel"], kind: "pdf" });
    expect(parseDriveQuery("só o contrato").kind).toBeUndefined();
  });

  it("gera variações sem acento e no singular", () => {
    expect(wordVariants("Relatórios")).toEqual(expect.arrayContaining(["relatórios", "relatorios", "relatorio"]));
  });

  it("ordena por semelhança, tolerando 1 letra errada e palavras sugeridas", () => {
    const files = [
      { nome: "Fotos da viagem.zip", modificado: "2026-09-01" },
      { nome: "Contrato de locação - apto 12.pdf", modificado: "2026-01-01" },
      { nome: "Contrato aluguel casa.pdf", modificado: "2025-01-01" },
    ];
    const ranked = rankFiles(files, ["contrato", "aluguel"], ["locacao"]);
    expect(ranked[0].nome).toBe("Contrato aluguel casa.pdf");
    expect(ranked[1].nome).toContain("locação");
    expect(ranked[2].nome).toContain("Fotos");
    // erro de digitação: "contarto" não casa, mas "aluguél" com 1 letra a mais/menos sim
    expect(similarity("Aluguel casa.pdf", ["alugel"])).toBeGreaterThan(0);
    expect(similarity("Aluguel casa.pdf", ["xyz"])).toBe(0);
  });

  it("limpa as palavras sugeridas pela IA", () => {
    expect(sanitizeAlternates(["locação de imóvel", "rent!", "a", "aluguel", "aluguel"])).toEqual(["locação", "imóvel", "rent", "aluguel"]);
    expect(sanitizeAlternates("nada")).toEqual([]);
  });
});

describe("clima", () => {
  const api = {
    current: { temperature_2m: 27.4, apparent_temperature: 31, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 14, is_day: 1 },
    hourly: { precipitation_probability: [10, 20, 65, 30, 0, 0] },
    daily: { temperature_2m_max: [31, 30], temperature_2m_min: [25, 24], precipitation_probability_max: [55, 20], weather_code: [2, 61] },
  };

  it("interpreta a resposta e monta as linhas do menu", () => {
    const w = parseForecast(api);
    expect(w.rainNext6h).toBe(65);
    expect(w.tomorrow?.code).toBe(61);
    const lines = weatherLines(w).join("\n");
    expect(lines).toContain("27°");
    expect(lines).toContain("Parcialmente nublado");
    expect(lines).toContain("25°–31°");
    expect(lines).toContain("guarda-chuva");
  });

  it("resposta incompleta vira erro; dicas só quando cabem", () => {
    expect(() => parseForecast({})).toThrow();
    expect(weatherTip({ ...parseForecast(api), rainNext6h: 0, rainProb: 0, feels: 22, temp: 22 })).toBe("");
    expect(weatherTip({ ...parseForecast(api), rainNext6h: 0, rainProb: 0, feels: 38 })).toContain("Calor");
    expect(describeCode(0, false).icon).toBe("🌙");
  });
});

describe("localização", () => {
  it("entende comandos de cidade e ignora frases parecidas", () => {
    expect(parseCityCommand("minha cidade é Recife")).toBe("Recife");
    expect(parseCityCommand("Mudar localização para São Paulo, SP")).toBe("São Paulo, SP");
    expect(parseCityCommand("moro em Fortaleza")).toBe("Fortaleza");
    expect(parseCityCommand("me mudei para Sobral.")).toBe("Sobral");
    expect(parseCityCommand("moro em casa")).toBeNull();
    expect(parseCityCommand("estou em reunião")).toBeNull();
  });

  it("perguntas de clima e de local", () => {
    for (const t of ["clima", "como está o tempo", "vai chover hoje", "previsão do tempo"]) expect(isWeatherQuery(normalize(t))).toBe(true);
    expect(isWeatherQuery(normalize("tempo de entrega do pedido"))).toBe(false);
    expect(isLocationQuery(normalize("onde estou"))).toBe(true);
  });

  it("lê o pin do WhatsApp", () => {
    expect(locationOf({ locationMessage: { degreesLatitude: -8.05, degreesLongitude: -34.9, name: "Casa" } })).toEqual({ lat: -8.05, lng: -34.9, name: "Casa" });
    expect(locationOf({ conversation: "oi" })).toBeNull();
  });
});

describe("rotina", () => {
  it("normaliza dias falados", () => {
    expect(normalizeDays("segunda e quarta")).toEqual([1, 3]);
    expect(normalizeDays(["ter", "Quinta-feira", "sábado"])).toEqual([2, 4, 6]);
    expect(normalizeDays(["todos"])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(normalizeDays([9, "xyz"])).toEqual([]);
  });

  it("valida o item e normaliza a hora", () => {
    expect(sanitizeRoutine({ topic: "Aulas", description: "Cálculo", days: ["ter", "qui"], time: "19h" })).toEqual({ topic: "Aulas", description: "Cálculo", days: [2, 4], time: "19:00" });
    expect(sanitizeRoutine({ topic: "Academia", description: "musculação", time: "6:30" })?.time).toBe("06:30");
    expect(sanitizeRoutine({ topic: "", description: "x" })).toBeNull();
    expect(sanitizeRoutine({ topic: "X", description: "y", time: "25:00" })?.time).toBeUndefined();
  });

  it("itens de hoje, pela hora", () => {
    const items = [
      { topic: "Aulas", description: "", days: [2, 4], time: "19:00" },
      { topic: "Academia", description: "", days: [1, 2, 3], time: "06:00" },
      { topic: "Reunião", description: "", days: [5] },
    ];
    expect(todayItems(items, 2).map((i) => i.topic)).toEqual(["Academia", "Aulas"]);
    expect(when(items[0])).toBe("ter, qui · 19:00");
  });
});
