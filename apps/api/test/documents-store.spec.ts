import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];
let seq = 0;
vi.mock("@magobox/database", () => ({
  prisma: {
    document: {
      findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      findMany: async ({ where, take, select }: any) => {
        const found = rows.filter((r) => r.workspaceId === where.workspaceId).sort((a, b) => b.createdAt - a.createdAt).slice(0, take ?? 1000);
        return select ? found.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]))) : found;
      },
      create: async ({ data }: any) => {
        const r = { id: `d${++seq}`, createdAt: Date.now() + seq, ...data };
        rows.push(r);
        return r;
      },
      update: async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => r.id === where.id && r.workspaceId === where.workspaceId);
        hit.forEach((r) => Object.assign(r, data));
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

import { GoogleService } from "../src/modules/integrations/google/google.service";
import { catalogedDriveIds, createDocument, deleteDocument, getDocument, listDocuments, setDocumentTags } from "../src/modules/channels/assistant/documents-store";

const base = { workspaceId: "w1", title: "Contrato de aluguel", topic: "Contratos", tags: ["contrato", "aluguel"], summary: "12 meses", driveFileId: "file0001", account: "a@gmail.com" };

describe("catálogo no banco", () => {
  beforeEach(() => {
    rows.length = 0;
    seq = 0;
  });

  it("cria a ficha com os padrões e limpa as tags", async () => {
    const d = await createDocument({ ...base, tags: ["Contrato", "#Aluguel", "contrato"], sizeBytes: 1234.7 });
    expect(d).toMatchObject({ kind: "pdf", mime: "application/pdf", origin: "whatsapp", tags: ["contrato", "aluguel"], sizeBytes: 1234, pages: null });
  });

  it("o mesmo arquivo do Drive não duplica: atualiza a ficha existente", async () => {
    const a = await createDocument(base);
    const b = await createDocument({ ...base, title: "Contrato de aluguel (revisado)", tags: ["contrato"] });
    expect(b.id).toBe(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Contrato de aluguel (revisado)", tags: ["contrato"] });
    // outro workspace pode ter o mesmo id de arquivo sem conflito
    await createDocument({ ...base, workspaceId: "w2" });
    expect(rows).toHaveLength(2);
  });

  it("cada workspace só vê, muda e apaga as próprias fichas", async () => {
    const mine = await createDocument(base);
    await createDocument({ ...base, workspaceId: "w2", driveFileId: "file0002", title: "Do outro" });
    expect((await listDocuments("w1")).map((d: any) => d.title)).toEqual(["Contrato de aluguel"]);
    expect(await getDocument("w2", mine.id)).toBeNull();
    expect(await setDocumentTags("w2", mine.id, ["invadiu"])).toBeNull();
    expect(await deleteDocument("w2", mine.id)).toBe(false);
    expect(rows.find((r) => r.id === mine.id)!.tags).toEqual(["contrato", "aluguel"]);
  });

  it("troca as tags (limpas, no máximo 8) e apaga a ficha", async () => {
    const d = await createDocument(base);
    const up = await setDocumentTags("w1", d.id, ["Saúde", "saude", "x", ...Array.from({ length: 12 }, (_, i) => `tag${i}`)]);
    expect(up!.tags).toHaveLength(8);
    expect(up!.tags.slice(0, 2)).toEqual(["saude", "tag0"]);
    expect(await deleteDocument("w1", d.id)).toBe(true);
    expect(await getDocument("w1", d.id)).toBeNull();
  });

  it("lista do mais novo ao mais antigo e informa quais arquivos já estão catalogados", async () => {
    await createDocument({ ...base, driveFileId: "file0001", title: "Antigo" });
    await createDocument({ ...base, driveFileId: "file0002", title: "Novo" });
    expect((await listDocuments("w1")).map((d: any) => d.title)).toEqual(["Novo", "Antigo"]);
    expect([...(await catalogedDriveIds("w1"))].sort()).toEqual(["file0001", "file0002"]);
    expect((await catalogedDriveIds("w2")).size).toBe(0);
  });
});

describe("GoogleService: PDFs no Drive", () => {
  const svc = () => {
    const s: any = new GoogleService();
    s.g = vi.fn();
    s.accessToken = async () => "tok";
    s.noteFolder = async () => "assist1234";
    // a pasta da categoria (subpasta de Documentos) tem outro id
    s.driveEnsureFolder = vi.fn(async (_ws: string, _acc: string | undefined, name: string) => (name === "Documentos" ? "docs00001" : "sub0001"));
    return s;
  };

  it("documentStore: envia os bytes do PDF para a pasta Documentos, com o nome certo", async () => {
    const s = svc();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "file0099", webViewLink: "https://drive/x" })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const pdf = Buffer.from("%PDF-1.4 conteudo");
      expect(await s.documentStore("w1", pdf, "2026-10-04 Contrato.pdf", "application/pdf", "a@gmail.com")).toEqual({ id: "file0099", link: "https://drive/x" });
      expect(s.driveEnsureFolder).toHaveBeenCalledWith("w1", "a@gmail.com", "Documentos", "assist1234");
      expect(s.driveEnsureFolder).toHaveBeenCalledWith("w1", "a@gmail.com", "Sem categoria", "docs00001");
      const [url, init] = fetchMock.mock.calls[0] as any;
      expect(url).toContain("uploadType=multipart");
      expect(init.headers.Authorization).toBe("Bearer tok");
      const body = (init.body as Buffer).toString("latin1");
      expect(body).toContain('"name":"2026-10-04 Contrato.pdf"');
      expect(body).toContain('"parents":["sub0001"]');
      expect(body).toContain("Content-Type: application/pdf");
      expect(body).toContain("%PDF-1.4 conteudo");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("documentStore: erro do Drive vira mensagem em português", async () => {
    const s = svc();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("insufficientPermissions", { status: 403 })));
    try {
      await expect(s.documentStore("w1", Buffer.from("x"), "a.pdf", "application/pdf")).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("documentTrash: só dentro de Assist.IA/Documentos, e manda para a lixeira", async () => {
    const s = svc();
    s.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
    s.g.mockResolvedValueOnce({ parents: ["docs00001"], mimeType: "application/pdf" }).mockResolvedValueOnce({});
    await s.documentTrash("w1", "file0099", "a@gmail.com");
    const [, , url, init] = s.g.mock.calls[1];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ trashed: true });
    expect(url).toContain("/files/file0099");
  });

  it("documentTrash: arquivo fora da pasta, já na lixeira ou id estranho nunca é tocado", async () => {
    for (const meta of [{ parents: ["outra"], mimeType: "application/pdf" }, { parents: ["docs00001"], trashed: true }, { parents: ["docs00001"], mimeType: "application/vnd.google-apps.folder" }]) {
      const s = svc();
      s.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
      s.g.mockResolvedValueOnce(meta).mockResolvedValueOnce({ parents: ["avo-fora"] });
      await expect(s.documentTrash("w1", "file0099")).rejects.toThrow("não está na sua pasta de documentos");
      const patches = s.g.mock.calls.filter((c: any[]) => c[3]?.method === "PATCH");
      expect(patches).toHaveLength(0);
    }
    await expect(svc().documentTrash("w1", "../x")).rejects.toThrow("inválido");
  });

  it("documentTrash: apaga também a partir de uma subpasta de categoria", async () => {
    const s = svc();
    s.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
    // o arquivo está em Documentos/Saúde: o avô é Documentos
    s.g.mockResolvedValueOnce({ parents: ["sub-saude"], mimeType: "application/pdf" }).mockResolvedValueOnce({ parents: ["docs00001"], mimeType: "application/vnd.google-apps.folder" }).mockResolvedValueOnce({});
    await s.documentTrash("w1", "file0099", "a@gmail.com");
    const patch = s.g.mock.calls.find((c: any[]) => c[3]?.method === "PATCH");
    expect(patch?.[2]).toContain("/files/file0099");
    expect(JSON.parse(patch[3].body)).toEqual({ trashed: true });
  });

  it("documentMove: manda o arquivo para a subpasta da categoria, tirando a pasta antiga", async () => {
    const s = svc();
    s.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
    s.g.mockResolvedValueOnce({ parents: ["docs00001"], mimeType: "application/pdf" }).mockResolvedValueOnce({});
    await s.documentMove("w1", "file0099", "Finanças", "a@gmail.com");
    expect(s.driveEnsureFolder).toHaveBeenCalledWith("w1", "a@gmail.com", "Finanças", "docs00001");
    const patch = s.g.mock.calls.find((c: any[]) => c[3]?.method === "PATCH");
    expect(patch[2]).toContain("/files/file0099");
    expect(patch[2]).toContain("addParents=sub0001");
    expect(patch[2]).toContain("removeParents=docs00001");
  });

  it("documentMove: já na pasta da categoria não faz nada; fora de Documentos nunca é tocado", async () => {
    const igual = svc();
    igual.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
    igual.g.mockResolvedValueOnce({ parents: ["sub0001"], mimeType: "application/pdf" }).mockResolvedValueOnce({ parents: ["docs00001"], mimeType: "application/vnd.google-apps.folder" });
    await igual.documentMove("w1", "file0099", "Finanças", "a@gmail.com");
    expect(igual.g.mock.calls.some((c: any[]) => c[3]?.method === "PATCH")).toBe(false);

    const fora = svc();
    fora.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
    fora.g.mockResolvedValueOnce({ parents: ["outra"], mimeType: "application/pdf" }).mockResolvedValueOnce({ parents: ["avo-fora"] });
    await expect(fora.documentMove("w1", "file0099", "Finanças")).rejects.toThrow("não está na sua pasta de documentos");
    expect(fora.g.mock.calls.some((c: any[]) => c[3]?.method === "PATCH")).toBe(false);
  });

  it("documentTrash: 403 vira o aviso de que só apaga o que guardou", async () => {
    const s = svc();
    s.driveFirst = vi.fn().mockResolvedValueOnce("assist1234").mockResolvedValueOnce("docs00001");
    s.g.mockResolvedValueOnce({ parents: ["docs00001"] }).mockRejectedValueOnce(new Error("Google API 403: x"));
    await expect(s.documentTrash("w1", "file0099")).rejects.toThrow("só apago os que eu mesmo guardei");
  });
});
