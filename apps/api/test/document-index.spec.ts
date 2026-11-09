import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocIndex } from "../src/modules/channels/assistant/document-index";
import type { DocLike } from "../src/modules/channels/assistant/documents";

/** Um "banco" compartilhado por dois índices (dois processos da API). */
function fakeStore() {
  const rows: (DocLike & { workspaceId: string })[] = [];
  let seq = 0;
  const add = (ws: string, title: string, tags: string[] = []) => {
    rows.push({ id: `d${++seq}`, workspaceId: ws, title, topic: "", tags, summary: "", createdAt: new Date(Date.UTC(2026, 0, seq)) });
  };
  const fetchDocs = vi.fn(async (ws: string) => rows.filter((r) => r.workspaceId === ws).map(({ workspaceId: _w, ...d }) => d));
  const fingerprint = vi.fn(async (ws: string) => {
    const mine = rows.filter((r) => r.workspaceId === ws);
    return `${mine.length}:${seq}`;
  });
  return { rows, add, fetchDocs, fingerprint };
}

describe("DocIndex: cache por workspace", () => {
  it("usa o cache enquanto a impressão digital não muda, sem reler os documentos", async () => {
    const s = fakeStore();
    s.add("w1", "Contrato de aluguel");
    const idx = new DocIndex({ fetchDocs: s.fetchDocs, fingerprint: s.fingerprint });
    await idx.get("w1");
    await idx.get("w1");
    expect(s.fetchDocs).toHaveBeenCalledTimes(1);
  });

  it("escrever invalida: depois de invalidate(ws) o próximo get reconstrói", async () => {
    const s = fakeStore();
    s.add("w1", "Contrato");
    const idx = new DocIndex({ fetchDocs: s.fetchDocs, fingerprint: s.fingerprint });
    await idx.get("w1");
    s.add("w1", "Recibo");
    idx.invalidate("w1");
    await idx.get("w1");
    expect(s.fetchDocs).toHaveBeenCalledTimes(2);
  });

  it("impressão digital diferente reconstrói mesmo sem invalidate (escrita em outra réplica)", async () => {
    const s = fakeStore();
    s.add("w1", "Contrato de aluguel", ["aluguel"]);
    const minha = new DocIndex({ fetchDocs: s.fetchDocs, fingerprint: s.fingerprint });
    const antes = await minha.get("w1");
    expect(antes.docs.size).toBe(1);
    // outra réplica grava sem avisar esta
    s.add("w1", "Recibo de plano de saúde", ["plano-de-saude"]);
    const depois = await minha.get("w1");
    expect(depois.docs.size).toBe(2);
    expect(s.fetchDocs).toHaveBeenCalledTimes(2);
  });

  it("workspaces não se misturam, nem no cache nem na impressão digital", async () => {
    const s = fakeStore();
    s.add("w1", "Contrato da casa", ["casa"]);
    s.add("w2", "Exame de sangue", ["saude"]);
    const idx = new DocIndex({ fetchDocs: s.fetchDocs, fingerprint: s.fingerprint });
    const g1 = await idx.get("w1");
    const g2 = await idx.get("w2");
    expect([...g1.docs.values()].map((d) => d.topic)).toEqual([""]);
    expect([...g1.docs.keys()]).toEqual(["d1"]);
    expect([...g2.docs.keys()]).toEqual(["d2"]);
    expect(s.fingerprint).toHaveBeenCalledWith("w1");
    expect(s.fingerprint).toHaveBeenCalledWith("w2");
  });

  it("passado o TTL de 10 minutos, reconstrói", async () => {
    const s = fakeStore();
    s.add("w1", "Contrato");
    let now = 0;
    const idx = new DocIndex({ fetchDocs: s.fetchDocs, fingerprint: s.fingerprint, now: () => now });
    await idx.get("w1");
    now = 9 * 60_000;
    await idx.get("w1");
    expect(s.fetchDocs).toHaveBeenCalledTimes(1);
    now = 10 * 60_000 + 1;
    await idx.get("w1");
    expect(s.fetchDocs).toHaveBeenCalledTimes(2);
  });

  it("LRU: acima de 50 workspaces, o menos usado sai do cache", async () => {
    const s = fakeStore();
    const idx = new DocIndex({ fetchDocs: s.fetchDocs, fingerprint: s.fingerprint, maxWorkspaces: 2 });
    await idx.get("a");
    await idx.get("b");
    await idx.get("a"); // "a" vira o mais recente
    await idx.get("c"); // expulsa "b"
    expect(s.fetchDocs).toHaveBeenCalledTimes(3);
    await idx.get("a");
    expect(s.fetchDocs).toHaveBeenCalledTimes(3);
    await idx.get("b");
    expect(s.fetchDocs).toHaveBeenCalledTimes(4);
  });
});

// Escritas do catálogo chamam invalidate(ws): o painel e o assistente veem a mudança na hora.
const rows: any[] = [];
let seq = 0;
vi.mock("@magobox/database", () => ({
  prisma: {
    document: {
      findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      findMany: async ({ where }: any) => rows.filter((r) => r.workspaceId === where.workspaceId),
      aggregate: async ({ where }: any) => {
        const mine = rows.filter((r) => r.workspaceId === where.workspaceId);
        return { _count: { _all: mine.length }, _max: { updatedAt: mine.length ? new Date(Math.max(...mine.map((r) => r.updatedAt.getTime()))) : null } };
      },
      create: async ({ data }: any) => {
        const r = { id: `c${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(r);
        return r;
      },
      update: async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data, { updatedAt: new Date() }),
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => (where.id?.in ? where.id.in.includes(r.id) : r.id === where.id) && r.workspaceId === where.workspaceId);
        hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: any) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === where.id && rows[i].workspaceId === where.workspaceId) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
  },
}));

import { docIndex, createDocument, deleteDocument, setDocumentTags, setDocumentsTopic, updateDocument } from "../src/modules/channels/assistant/documents-store";

describe("documents-store invalida o índice ao escrever", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  const base = { workspaceId: "w1", title: "Contrato", topic: "Casa", tags: ["aluguel"], summary: "", driveFileId: "f1", account: "a@gmail.com" };

  it("criar, editar, trocar tags, trocar categoria e apagar aparecem na próxima leitura", async () => {
    const ws = "w1";
    expect((await docIndex.get(ws)).docs.size).toBe(0);

    const criado = await createDocument(base);
    expect((await docIndex.get(ws)).docs.has(criado.id)).toBe(true);

    await updateDocument(ws, criado.id, { title: "Aluguel 2026" });
    expect((await docIndex.get(ws)).docs.get(criado.id)?.titleWords).toContain("aluguel");

    await setDocumentTags(ws, criado.id, ["imovel"]);
    expect((await docIndex.get(ws)).docs.get(criado.id)?.tags).toEqual(["imovel"]);

    await setDocumentsTopic(ws, [criado.id], "Finanças");
    expect((await docIndex.get(ws)).docs.get(criado.id)?.topic).toBe("Finanças");

    await deleteDocument(ws, criado.id);
    expect((await docIndex.get(ws)).docs.has(criado.id)).toBe(false);
  });
});
