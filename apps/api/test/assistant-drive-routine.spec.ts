import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const WEATHER = { temp: 27, feels: 30, humidity: 70, wind: 10, code: 2, isDay: true, max: 31, min: 25, rainProb: 20, rainNext6h: 10 };

function build(opts: { accounts?: string[]; strict?: any[][]; fuzzy?: any[][]; routine?: any[]; driveFile?: any; searchError?: string; ai?: string } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const accounts = opts.accounts ?? ["pessoal@gmail.com"];
  const driveSearch = vi.fn(async (_ws: string, _spec: any, account: string, _max: number, mode: string) => {
    if (opts.searchError) throw new Error(opts.searchError);
    const table = mode === "fuzzy" ? opts.fuzzy : opts.strict;
    return (table ?? [])[accounts.indexOf(account)] ?? [];
  });
  const driveFile = vi.fn(async () => opts.driveFile ?? { nome: "Evidências.mp3", mime: "audio/mpeg", base64: "QUJD", link: "https://drive/x" });
  const google = { listAccounts: async () => accounts, driveSearch, driveFile };
  const memory = {
    promptBlock: async () => "",
    listRoutine: async () => opts.routine ?? [],
    removeRoutine: vi.fn(async () => true),
  };
  const weather = {
    forecast: vi.fn(async () => WEATHER),
    geocode: vi.fn(async (name: string) => (name.startsWith("Recife") ? { lat: -8.05, lng: -34.9, name: "Recife, Pernambuco" } : null)),
  };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any, undefined, weather as any);
  const fileSender = vi.fn(async () => {});
  menu.setFileSender(fileSender);
  // Nunca chama a IA de verdade: sem `ai` no cenário, ela "está fora do ar"
  const ai = vi.spyOn(menu as any, "ai");
  if (opts.ai !== undefined) ai.mockResolvedValue(opts.ai);
  else ai.mockRejectedValue(new Error("IA indisponível"));
  return { menu, store, driveSearch, driveFile, fileSender, memory, weather };
}

const file = (id: string, nome: string, tipo = "application/pdf", modificado = "2026-09-01T10:00:00Z") => ({ id, nome, tipo, modificado, tamanho: 2048 });

describe("menu: hora, lugar, clima e rotina do dia", () => {
  it("mostra hora, cidade, clima e o que tem hoje na rotina", async () => {
    const weekday = new Date(new Date().toLocaleString("en-US", { timeZone: process.env.ASSISTANT_TZ || "America/Fortaleza" })).getDay();
    const { menu } = build({ routine: [{ id: "1", topic: "Aulas", description: "Cálculo", days: [weekday], time: "19:00" }] });
    const out = (await menu.respond("w1", "menu")) as string;
    expect(out).toContain("Fortaleza, Ceará");
    expect(out).toContain("(padrão)");
    expect(out).toContain("27°");
    expect(out).toContain("Hoje:");
    expect(out).toContain("19:00 Aulas");
    expect(out).toContain("Google Drive");
    expect(out).toContain("Minha rotina");
  });

  it("clima indisponível não derruba o menu", async () => {
    const { menu, weather } = build();
    weather.forecast.mockRejectedValue(new Error("timeout"));
    const out = (await menu.respond("w1", "menu")) as string;
    expect(out).toContain("O que vamos ver agora?");
    expect(out).not.toContain("27°");
  });

  it("'minha cidade é Recife' guarda o lugar e mostra o clima; cidade desconhecida avisa", async () => {
    const { menu, store } = build();
    const ok = (await menu.respond("w1", "minha cidade é Recife")) as string;
    expect(ok).toContain("Recife, Pernambuco");
    expect(store.get("loc:w1")).toMatchObject({ name: "Recife, Pernambuco", source: "city" });
    const menuOut = (await menu.respond("w1", "menu")) as string;
    expect(menuOut).toContain("Recife, Pernambuco");
    expect(menuOut).not.toContain("(padrão)");

    const bad = (await menu.respond("w1", "moro em Xyzlândia")) as string;
    expect(bad).toContain("Não achei a cidade");
  });

  it("'clima' mostra a previsão completa", async () => {
    const { menu } = build();
    const out = (await menu.respond("w1", "como está o tempo")) as string;
    expect(out).toContain("Sensação");
    expect(out).toContain("Open-Meteo");
  });
});

describe("Drive", () => {
  it("música pelo nome: filtra por áudio, acha em uma conta e já envia o arquivo", async () => {
    const { menu, driveSearch, fileSender, store } = build({ strict: [[file("a1", "Evidências.mp3", "audio/mpeg")]] });
    const out = (await menu.respond("w1", "me manda a música Evidências do drive")) as string;
    expect(driveSearch.mock.calls[0][1]).toMatchObject({ terms: ["Evidências"], kind: "audio" });
    expect(fileSender).toHaveBeenCalledWith("w1", expect.objectContaining({ nome: "Evidências.mp3", mime: "audio/mpeg", base64: "QUJD" }));
    expect(out).toContain("Enviei");
    expect(store.get("menu:w1").screen).toBe("drive");
  });

  it("busca em TODAS as contas vinculadas e mostra a lista com a conta de cada arquivo", async () => {
    const { menu, driveSearch, fileSender } = build({
      accounts: ["pessoal@gmail.com", "aluno@ifce.edu.br"],
      strict: [[file("a1", "Contrato aluguel casa.pdf")], [file("b1", "Contrato de estágio.pdf", "application/pdf", "2026-09-20T10:00:00Z")]],
    });
    const out = (await menu.respond("w1", "drive contrato")) as string;
    expect(driveSearch).toHaveBeenCalledTimes(2);
    expect(out).toContain("Achei 2 arquivos");
    expect(out).toContain("Pessoal");
    expect(out).toContain("IFCE");
    expect(fileSender).not.toHaveBeenCalled();

    await menu.respond("w1", "2");
    expect(fileSender).toHaveBeenCalledTimes(1);
  });

  it("não lembra o nome: sem achado exato, usa palavras parecidas (IA) e mostra a lista para escolher", async () => {
    const { menu, driveSearch, fileSender } = build({
      strict: [[]],
      fuzzy: [[file("c1", "Contrato de locação - apto 12.pdf"), file("c2", "Fotos viagem.zip", "application/zip")]],
      ai: JSON.stringify({ palavras: ["locação", "aluguel", "rent"] }),
    });
    const out = (await menu.respond("w1", "drive papel da casa que aluguei")) as string;
    const fuzzyCall = driveSearch.mock.calls.find((c) => c[4] === "fuzzy")!;
    expect(fuzzyCall[1].alternates).toEqual(expect.arrayContaining(["locação", "aluguel"]));
    expect(out).toContain("Não achei igual");
    expect(out.indexOf("locação")).toBeLessThan(out.indexOf("Fotos")); // mais parecido primeiro
    expect(fileSender).not.toHaveBeenCalled(); // aproximado nunca envia sozinho
  });

  it("sem IA a busca aproximada ainda roda com as variações das palavras", async () => {
    const { menu, driveSearch } = build({ strict: [[]], fuzzy: [[file("d1", "Relatorio vendas.pdf")]] });
    const out = (await menu.respond("w1", "drive relatórios")) as string;
    expect(driveSearch.mock.calls.some((c) => c[4] === "fuzzy")).toBe(true);
    expect(out).toContain("Relatorio vendas");
  });

  it("nada encontrado volta a pedir outras palavras", async () => {
    const { menu, store } = build({ strict: [[]], fuzzy: [[]] });
    const out = (await menu.respond("w1", "drive xyzabc")) as string;
    expect(out).toContain("Não achei nada parecido");
    expect(store.get("menu:w1").screen).toBe("drive_input");
  });

  it("conta sem permissão do Drive mostra o motivo em vez de 'nada encontrado'", async () => {
    const { menu } = build({ searchError: "Esta conta ainda não liberou o Drive. Reconecte o Google em Canais → Conectar Google." });
    const out = (await menu.respond("w1", "drive contrato")) as string;
    expect(out).toContain("Reconecte o Google");
  });

  it("arquivo grande demais devolve o link em vez de falhar", async () => {
    const { menu } = build({ strict: [[file("z", "Show.wav", "audio/wav")]], driveFile: { nome: "Show.wav", mime: "audio/wav", motivo: "arquivo grande demais para enviar pelo WhatsApp", link: "https://drive/show" } });
    const out = (await menu.respond("w1", "drive show")) as string;
    expect(out).toContain("grande demais");
    expect(out).toContain("https://drive/show");
  });
});

describe("rotina", () => {
  it("lista os itens e o número remove", async () => {
    const { menu, memory, store } = build({ routine: [{ id: "r1", topic: "Aulas", description: "Cálculo", days: [2, 4], time: "19:00" }] });
    const list = (await menu.respond("w1", "minha rotina")) as string;
    expect(list).toContain("Aulas");
    expect(list).toContain("ter, qui · 19:00");
    expect(store.get("menu:w1").screen).toBe("routine");

    const out = (await menu.respond("w1", "1")) as string;
    expect(memory.removeRoutine).toHaveBeenCalledWith("w1", "r1");
    expect(out).toContain("Removi da rotina");
  });

  it("texto livre na tela da rotina vai para a IA (que atualiza com routine_set)", async () => {
    const { menu } = build({ routine: [{ id: "r1", topic: "Aulas", description: "Cálculo", days: [2] }] });
    await menu.respond("w1", "rotina");
    expect(await menu.respond("w1", "agora minha aula é quarta às 20h")).toBeNull();
  });
});
