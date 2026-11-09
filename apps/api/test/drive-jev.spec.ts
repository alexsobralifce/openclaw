import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@magobox/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

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

function build(opts: { driveRequest?: any; strict?: any[]; fuzzy?: any[]; topics?: { id: string; name: string }[]; pickFile?: number | null; pickTopic?: number | null } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const driveSearch = vi.fn(async (_ws: string, _spec: any, _acc: string, _max: number, mode: string) => (mode === "fuzzy" ? opts.fuzzy : opts.strict) ?? []);
  const driveFile = vi.fn(async (_ws: string, id: string) => ({ nome: `arquivo-${id}`, mime: "audio/mpeg", base64: "QUJD", link: "x" }));
  const notesIn = vi.fn(async () => []);
  const google = { listAccounts: async () => ["pessoal@gmail.com"], driveSearch, driveFile, noteTopics: async () => opts.topics ?? [], notesIn };
  const intents = {
    enabled: () => true,
    classify: async () => null,
    driveRequest: vi.fn(async () => opts.driveRequest ?? null),
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

describe("livros: o Jev entende o tipo e que é para listar", () => {
  const books = [file("b1", "Clean Code.pdf", "application/pdf"), file("b2", "Python Fluente.epub", "application/epub+zip")];

  it("lista os livros sem enviar nada, sem busca aproximada e sem pickFile", async () => {
    const { menu, intents, fileSender } = build({ strict: books, driveRequest: { kind: "book", list: true } });
    const out = (await menu.respond("w1", "Liste os livros que encontrou no drive?")) as string;
    expect(out).toContain("Achei 2 livros");
    expect(out).toContain("Clean Code.pdf");
    expect(intents.pickFile).not.toHaveBeenCalled();
    expect(fileSender).not.toHaveBeenCalled();
  });

  it("um único livro na listagem também só aparece na lista", async () => {
    const { menu, fileSender } = build({ strict: [books[0]], driveRequest: { kind: "book", list: true } });
    const out = (await menu.respond("w1", "liste os livros do drive")) as string;
    expect(out).toContain("Achei 1 livro");
    expect(fileSender).not.toHaveBeenCalled();
  });

  it("sem livros no Drive, avisa e não cai em arquivos de outro tipo", async () => {
    const { menu } = build({ strict: [], fuzzy: [file("x", "query.py", "text/x-python")], driveRequest: { kind: "book", list: true } });
    const out = (await menu.respond("w1", "liste os livros do drive")) as string;
    expect(out).toContain("Não achei livros");
    expect(out).not.toContain("query.py");
  });

  it("com o Jev fora do ar, a regra de palavras dá o mesmo resultado", async () => {
    const { menu } = build({ strict: books });
    const out = (await menu.respond("w1", "liste os livros do drive")) as string;
    expect(out).toContain("Achei 2 livros");
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
});
