import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { driveQueryFrom, looksLikeMediaRequest, parseDriveQuery } from "../src/modules/channels/assistant/drive";
import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { normalize, parseChoice } from "../src/modules/channels/assistant/voice";

const flat = normalize;
const file = (id: string, nome: string, tipo = "audio/mpeg") => ({ id, nome, tipo, modificado: "2015-10-02T10:00:00Z", tamanho: 3_000_000 });

describe("pedido de arquivo sem a palavra 'drive'", () => {
  it("reconhece os pedidos que foram para a IA livre", () => {
    for (const t of ["quero a musica catingueira", "baixe a musica catingueira", "Baixe a música Catingueira", "me manda a foto do contrato", "ouvir a musica evidencias", "preciso do pdf relatorio anual", "queria a planilha gastos"]) {
      expect(looksLikeMediaRequest(flat(t)), t).toBe(true);
    }
  });
  it("não sequestra o que é de outro assunto", () => {
    for (const t of ["quero ver o pdf", "manda foto pro joao", "enviar email com pdf do contrato", "mandar a foto no whatsapp", "quero agendar prova de matematica", "adicionar musica na agenda", "anota a musica catingueira", "baixar o app"]) {
      expect(looksLikeMediaRequest(flat(t)), t).toBe(false);
    }
  });
  it("tira o pedido e fica com o nome e o tipo", () => {
    expect(driveQueryFrom("quero a música Catingueira")).toBe("música Catingueira");
    expect(parseDriveQuery("baixe a música Catingueira")).toMatchObject({ terms: ["Catingueira"], kind: "audio" });
    expect(driveQueryFrom("ouvir a música Evidências")).toBe("música Evidências");
  });
});

describe("escolher pelo tipo e número", () => {
  it("'música 2' escolhe o item 2 em telas com lista, e só nelas", () => {
    expect(parseChoice("musica 2", 4)).toBe(2);
    expect(parseChoice("o arquivo 3", 4)).toBe(3);
    expect(parseChoice("foto 1", 2)).toBe(1);
    expect(parseChoice("musica 2")).toBeNull(); // menu principal: não vira opção 2
    expect(parseChoice("2", 4)).toBe(2);
  });
});

function build(strict: any[]) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const driveSearch = vi.fn(async () => strict);
  const driveFile = vi.fn(async (_ws: string, id: string) => ({ nome: `arquivo-${id}`, mime: "audio/mpeg", base64: "QUJD", link: "x" }));
  const google = { listAccounts: async () => ["pessoal@gmail.com"], driveSearch, driveFile };
  const memory = { promptBlock: async () => "", listRoutine: async () => [] };
  const menu = new MenuService(google as any, {} as any, memory as any, state as any);
  menu.setFileSender(vi.fn(async () => {}));
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return { menu, store, driveSearch, driveFile };
}

describe("a conversa que deu errado, agora", () => {
  const found = [file("a1", "CATINGUEIRA.mp3"), file("a2", "Catingueira - Marinês.mp3"), file("a3", "09 CATINGUEIRA.mp3")];

  it("'quero a música catingueira' vira a lista do menu, e o '2' envia o arquivo 2 (não abre a agenda)", async () => {
    const { menu, driveSearch, driveFile, store } = build(found);
    const out = (await menu.respond("w1", "quero a musica catingueira")) as string;
    expect(driveSearch.mock.calls[0][1]).toMatchObject({ terms: ["catingueira"], kind: "audio" });
    expect(out).toContain("Achei 3 arquivos");
    expect(store.get("menu:w1").screen).toBe("drive");
    const sent = (await menu.respond("w1", "2")) as string;
    expect(driveFile).toHaveBeenCalledWith("w1", "a2", "pessoal@gmail.com");
    expect(sent).toContain("Enviei");
    expect(sent).not.toContain("Google Agenda");
  });

  it("'baixe a música catingueira' faz o mesmo, e 'música 2' escolhe da lista", async () => {
    const { menu, driveFile } = build(found);
    await menu.respond("w1", "baixe a musica catingueira");
    await menu.respond("w1", "musica 2");
    expect(driveFile).toHaveBeenCalledWith("w1", "a2", "pessoal@gmail.com");
  });
});

describe("a IA livre lista arquivos em texto", () => {
  it("guarda a lista (numerada) para o número que o dono responder", async () => {
    const items = [file("a1", "CATINGUEIRA.mp3"), file("a2", "Catingueira - Marinês.mp3")].map((f) => ({ ...f, account: "pessoal@gmail.com" }));
    const menu = { setExecutor() {}, setFileSender() {}, setChatCleaner() {}, driveFind: vi.fn(async () => ({ items, fuzzy: false, errors: [], accounts: ["pessoal@gmail.com"] })), rememberDriveResults: vi.fn(async () => {}) };
    const svc = new AssistantService({} as any, {} as any, menu as any, { promptBlock: async () => "" } as any, {} as any, { get: async () => null, set: async () => {}, del: async () => {} } as any);
    const r: any = await (svc as any).runTool("w1", "drive_search", { query: "musica catingueira" });
    expect(menu.rememberDriveResults).toHaveBeenCalledWith("w1", items, "musica catingueira");
    expect(r.arquivos.map((a: any) => a.n)).toEqual([1, 2]);
    expect(r.instrucao).toContain("mesma ordem");
  });
});
