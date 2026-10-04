import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => ({
  choice: (instructions: unknown, criteria: unknown) => ({ type: "choice", instructions, criteria }),
  noul: (q: unknown) => ({ type: "noul", q }),
  TypeSafeClient: class {
    systemOne = systemOne;
  },
}));

import { IntentService } from "../src/modules/channels/assistant/intent.service";
import { MenuService } from "../src/modules/channels/assistant/menu.service";

const file = (id: string, nome: string, tipo = "audio/mpeg") => ({ id, nome, tipo, modificado: "2026-09-01T10:00:00Z", tamanho: 2048 });

function build(opts: { strict?: any[]; fuzzy?: any[]; topics?: { id: string; name: string }[]; pickFile?: number | null; pickTopic?: number | null } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const driveSearch = vi.fn(async (_ws: string, _spec: any, _acc: string, _max: number, mode: string) => (mode === "fuzzy" ? opts.fuzzy : opts.strict) ?? []);
  const driveFile = vi.fn(async (_ws: string, id: string) => ({ nome: `arquivo-${id}`, mime: "audio/mpeg", base64: "QUJD", link: "x" }));
  const notesIn = vi.fn(async () => []);
  const google = { listAccounts: async () => ["pessoal@gmail.com"], driveSearch, driveFile, noteTopics: async () => opts.topics ?? [], notesIn };
  const intents = {
    enabled: () => true,
    classify: async () => null,
    pickFile: vi.fn(async () => opts.pickFile ?? null),
    pickNoteTopic: vi.fn(async () => opts.pickTopic ?? null),
  };
  const memory = { promptBlock: async () => "", listRoutine: async () => [] };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any, undefined, undefined, undefined, intents as any);
  const fileSender = vi.fn(async () => {});
  menu.setFileSender(fileSender);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, intents, fileSender, driveFile, notesIn, store };
}

describe("música e arquivo: o Jev escolhe entre os achados", () => {
  const two = [file("a1", "Legião Urbana - Evidências.mp3"), file("a2", "Evidências (ao vivo).mp3")];

  it("com certeza do Jev, envia o escolhido e deixa os outros para corrigir pelo número", async () => {
    const { menu, intents, fileSender, driveFile } = build({ strict: two, pickFile: 0 });
    const out = (await menu.respond("w1", "me manda a música evidencias legiao do drive")) as string;
    expect(intents.pickFile).toHaveBeenCalledTimes(1);
    expect(driveFile).toHaveBeenCalledWith("w1", "a1", "pessoal@gmail.com");
    expect(fileSender).toHaveBeenCalledTimes(1);
    expect(out).toContain("Enviei");
    expect(out).toContain("Não era esse?");
    expect(out).toContain("Evidências (ao vivo)");
    // o número da lista corrige a escolha
    await menu.respond("w1", "2");
    expect(driveFile).toHaveBeenLastCalledWith("w1", "a2", "pessoal@gmail.com");
  });

  it("na dúvida do Jev, mostra a lista e não envia nada", async () => {
    const { menu, fileSender } = build({ strict: two, pickFile: null });
    const out = (await menu.respond("w1", "drive evidencias")) as string;
    expect(out).toContain("Achei 2 arquivos");
    expect(fileSender).not.toHaveBeenCalled();
  });

  it("achado aproximado também passa pelo Jev", async () => {
    const { menu, intents, fileSender } = build({ strict: [], fuzzy: two, pickFile: 1 });
    const out = (await menu.respond("w1", "drive evidensias")) as string;
    expect(intents.pickFile).toHaveBeenCalled();
    expect(fileSender).toHaveBeenCalledTimes(1);
    expect(out).toContain("Enviei");
  });

  it("um único resultado exato é enviado sem gastar o Jev", async () => {
    const { menu, intents, fileSender } = build({ strict: [two[0]] });
    await menu.respond("w1", "me manda a música evidencias do drive");
    expect(intents.pickFile).not.toHaveBeenCalled();
    expect(fileSender).toHaveBeenCalledTimes(1);
  });
});

describe("assunto de nota: o Jev escolhe quando o nome não bate", () => {
  const topics = [{ id: "t1", name: "Moradia" }, { id: "t2", name: "Reuniões" }];

  it("'notas de aluguel' abre 'Moradia' quando o Jev tem certeza", async () => {
    const { menu, intents, notesIn } = build({ topics, pickTopic: 0 });
    await menu.respond("w1", "notas de aluguel");
    expect(intents.pickNoteTopic).toHaveBeenCalledTimes(1);
    expect(notesIn).toHaveBeenCalled();
  });

  it("nome que casa por texto não gasta o Jev; na dúvida mostra a lista de assuntos", async () => {
    const a = build({ topics });
    await a.menu.respond("w1", "notas de reunioes");
    expect(a.intents.pickNoteTopic).not.toHaveBeenCalled();
    expect(a.notesIn).toHaveBeenCalled();

    const b = build({ topics, pickTopic: null });
    const out = (await b.menu.respond("w1", "notas de aluguel")) as string;
    expect(out).toContain("Não achei o assunto");
    expect(b.notesIn).not.toHaveBeenCalled();
  });
});

describe("o que vai ao Jev", () => {
  beforeEach(() => {
    systemOne.mockReset();
    process.env.TYPESAFE_API_KEY = "test";
  });
  afterEach(() => {
    delete process.env.TYPESAFE_API_KEY;
  });

  it("arquivo: só o pedido e os nomes (até 8), e aceita só com confiança alta", async () => {
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "c1", confidence: 0.9 } } });
    const files = Array.from({ length: 12 }, (_, i) => ({ nome: `Faixa ${i}.mp3`, id: `id${i}`, account: "pessoal@gmail.com" }));
    expect(await new IntentService().pickFile("evidencias", files)).toBe(1);
    const sent = systemOne.mock.calls[0][0];
    expect(Object.keys(sent.questions.escolha.criteria)).toHaveLength(9); // 8 nomes + "nenhum"
    expect(JSON.stringify(sent)).not.toMatch(/id\d|pessoal@gmail/);
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "c1", confidence: 0.7 } } });
    expect(await new IntentService().pickFile("evidencias", files)).toBeNull();
  });

  it("música do Spotify: ao Jev vai só 'nome — artista', nunca o identificador nem o álbum", async () => {
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "c1", confidence: 0.9 } } });
    const tracks = [{ name: "Evidências", artists: "Legião Urbana", uri: "spotify:track:abc", album: "Álbum X" }, { name: "Evidências", artists: "Chitãozinho & Xororó", uri: "spotify:track:def", album: "Álbum Y" }];
    expect(await new IntentService().pickTrack("evidencias", tracks)).toBe(1);
    const sent = JSON.stringify(systemOne.mock.calls[0][0]);
    expect(sent).toContain("Evidências — Legião Urbana");
    expect(sent).not.toMatch(/spotify:track|Álbum/);
  });

  it("assunto de nota: devolve o índice ou null", async () => {
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "c0", confidence: 0.95 } } });
    expect(await new IntentService().pickNoteTopic("aluguel", [{ name: "Moradia" }])).toBe(0);
    systemOne.mockResolvedValue({ answers: { escolha: { choice: "nenhum", confidence: 0.99 } } });
    expect(await new IntentService().pickNoteTopic("aluguel", [{ name: "Moradia" }])).toBeNull();
  });
});
