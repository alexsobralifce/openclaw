import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];
vi.mock("@magobox/database", () => ({
  prisma: {
    document: {
      findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      findMany: async ({ where }: any) => rows.filter((r) => r.workspaceId === where.workspaceId).sort((a, b) => b.createdAt - a.createdAt),
      aggregate: async ({ where }: any) => {
        const mine = rows.filter((r) => r.workspaceId === where.workspaceId);
        return { _count: { _all: mine.length }, _max: { updatedAt: null } };
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => (where.id?.in ? where.id.in.includes(r.id) : r.id === where.id) && r.workspaceId === where.workspaceId);
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

import { DocumentsController } from "../src/modules/channels/documents.controller";
import { docIndex } from "../src/modules/channels/assistant/documents-store";

const req = (ws = "w1") => ({ user: { workspaces: [{ workspaceId: ws }] } });
let n = 0;
const seed = (over: Record<string, any> = {}) => {
  const r = { id: `doc${++n}`, workspaceId: "w1", kind: "pdf", title: "Contrato de aluguel", topic: "Contratos", tags: ["contrato", "aluguel"], summary: "12 meses", driveFileId: `file${n}0000`, account: "pessoal@gmail.com", mime: "application/pdf", sizeBytes: 2048, pages: 3, origin: "whatsapp", createdAt: 1000 + n, ...over };
  rows.push(r);
  return r;
};
const res = () => {
  const r: any = { headers: {}, body: undefined, code: 200 };
  r.set = (h: any) => Object.assign(r.headers, h);
  r.send = (b: any) => ((r.body = b), r);
  r.status = (c: number) => ((r.code = c), r);
  r.json = (b: any) => ((r.body = b), r);
  return r;
};
const kv = new Map<string, any>();
const state: any = { get: async (k: string) => kv.get(k) ?? null, set: async (k: string, v: any) => void kv.set(k, v) };
const ctrl = (google: any = {}) => new DocumentsController(google, state);

beforeEach(() => {
  rows.length = 0;
  kv.clear();
  n = 0;
  // o índice é um singleton; as fixtures mudam a cada teste, então cada teste começa sem cache
  docIndex.invalidate("w1");
  docIndex.invalidate("w2");
});

describe("biblioteca: busca por grafo", () => {
  it("'unimed' acha o documento da categoria Saúde com a tag plano-de-saude, com o motivo", async () => {
    seed({ title: "Consulta na Unimed", topic: "Saúde", tags: ["unimed", "plano-de-saude"] });
    seed({ title: "Carteirinha", topic: "Saúde", tags: ["plano-de-saude"] });
    seed({ title: "Contrato de aluguel", topic: "Contratos", tags: ["aluguel"] });
    const r = await ctrl().list(req(), "unimed");
    const titles = r.documents.map((d: any) => d.title);
    expect(titles).toContain("Carteirinha");
    expect(titles).not.toContain("Contrato de aluguel");
    const carteirinha = r.documents.find((d: any) => d.title === "Carteirinha") as any;
    expect(carteirinha.reasons).toContain("vizinha de tag unimed");
    expect(carteirinha.topic).toBe("Saúde");
  });
});

describe("biblioteca: listar e filtrar", () => {
  it("lista do mais novo ao mais antigo, com as tags e a contagem, sem expor o arquivo do Drive", async () => {
    seed({ title: "Antigo" });
    seed({ title: "Novo", tags: ["contrato"] });
    const r = await ctrl().list(req());
    expect(r.documents.map((d) => d.title)).toEqual(["Novo", "Antigo"]);
    expect(r.total).toBe(2);
    expect(r.tags[0]).toEqual({ tag: "contrato", count: 2 });
    expect(JSON.stringify(r)).not.toMatch(/driveFileId|pessoal@gmail|file\d/);
  });

  it("busca por texto e filtra por tag, juntos", async () => {
    seed({ title: "Contrato de aluguel", tags: ["contrato", "aluguel"] });
    seed({ title: "Exame de sangue", topic: "Saúde", tags: ["saude", "exame"] });
    seed({ title: "Contrato de estágio", tags: ["contrato", "estagio"] });
    // o acerto direto vem primeiro; o grafo acrescenta o vizinho por tag ("contrato") com o motivo
    const porEstagio = (await ctrl().list(req(), "estagio")).documents as any[];
    expect(porEstagio[0].title).toBe("Contrato de estágio");
    expect(porEstagio[0].reasons).toContain("tag estagio");
    expect((await ctrl().list(req(), undefined, "contrato")).documents).toHaveLength(2);
    expect((await ctrl().list(req(), "estagio", "contrato")).documents.map((d) => d.title)).toContain("Contrato de estágio");
    expect((await ctrl().list(req(), "estagio", "saude")).documents).toHaveLength(0);
    // a tag do filtro também é limpa (#Saúde → saude)
    expect((await ctrl().list(req(), undefined, "#Saúde")).documents.map((d) => d.title)).toEqual(["Exame de sangue"]);
    // o total e as tags mostram o catálogo inteiro, mesmo filtrado
    expect((await ctrl().list(req(), "exame")).total).toBe(3);
  });

  it("cada workspace só vê o próprio catálogo", async () => {
    seed({ title: "Meu" });
    seed({ workspaceId: "w2", title: "De outro" });
    expect((await ctrl().list(req("w1"))).documents.map((d) => d.title)).toEqual(["Meu"]);
    expect((await ctrl().list(req("w2"))).documents.map((d) => d.title)).toEqual(["De outro"]);
  });
});

describe("biblioteca: editar", () => {
  it("troca tags, título e assunto, tudo limpo", async () => {
    const d = seed();
    const r = await ctrl().update(req(), d.id, { tags: ["Saúde", "#Exame", "saude"], title: "  Exame / sangue ", topic: "saúde" });
    expect(r).toMatchObject({ tags: ["saude", "exame"], title: "Exame sangue", topic: "Saúde" });
    expect(JSON.stringify(r)).not.toMatch(/driveFileId/);
  });

  it("corpo vazio não muda nada; documento de outro workspace é 'não encontrado'", async () => {
    const d = seed();
    expect((await ctrl().update(req(), d.id, {})).title).toBe("Contrato de aluguel");
    await expect(ctrl().update(req("w2"), d.id, { tags: ["invadiu"] })).rejects.toThrow("não encontrado");
    expect(rows[0].tags).toEqual(["contrato", "aluguel"]);
  });
});

describe("biblioteca: apagar", () => {
  it("PDF vai para a lixeira do Drive e a ficha sai", async () => {
    const d = seed({ driveFileId: "drivefile77" });
    const google = { documentTrash: vi.fn(async () => {}) };
    expect(await ctrl(google).remove(req(), d.id)).toEqual({ ok: true });
    expect(google.documentTrash).toHaveBeenCalledWith("w1", "drivefile77", "pessoal@gmail.com");
    expect(rows).toHaveLength(0);
  });

  it("erro do Drive mantém a ficha; arquivo que já sumiu da pasta deixa a ficha sair", async () => {
    const d = seed();
    const bad = { documentTrash: vi.fn(async () => { throw new Error("Não tenho permissão para apagar esse arquivo."); }) };
    await expect(ctrl(bad).remove(req(), d.id)).rejects.toThrow("permissão");
    expect(rows).toHaveLength(1);
    const gone = { documentTrash: vi.fn(async () => { throw new Error("Esse documento não está na sua pasta de documentos."); }) };
    expect(await ctrl(gone).remove(req(), d.id)).toEqual({ ok: true });
    expect(rows).toHaveLength(0);
  });

  it("ficha de nota antiga só sai do catálogo; outro workspace não apaga", async () => {
    const nota = seed({ kind: "nota" });
    const google = { documentTrash: vi.fn() };
    await ctrl(google).remove(req(), nota.id);
    expect(google.documentTrash).not.toHaveBeenCalled();
    const alheio = seed({ workspaceId: "w2" });
    await expect(ctrl(google).remove(req("w1"), alheio.id)).rejects.toThrow("não encontrado");
    expect(rows).toHaveLength(1);
  });
});

describe("biblioteca: baixar", () => {
  it("entrega os bytes com o nome certo, sem cache, buscando na conta do documento", async () => {
    const d = seed({ driveFileId: "drivefile88", account: "ifce@gmail.com" });
    const driveFile = vi.fn(async () => ({ nome: "Contrato.pdf", mime: "application/pdf", base64: Buffer.from("%PDF").toString("base64") }));
    const r = res();
    await ctrl({ driveFile }).download(req(), d.id, r);
    expect(driveFile).toHaveBeenCalledWith("w1", "drivefile88", "ifce@gmail.com");
    expect(r.body.toString()).toBe("%PDF");
    expect(r.headers["Content-Disposition"]).toContain("Contrato.pdf");
    expect(r.headers["Cache-Control"]).toContain("no-store");
  });

  it("arquivo grande devolve 422 com o link; documento de outro workspace é 'não encontrado'", async () => {
    const d = seed();
    const r = res();
    await ctrl({ driveFile: async () => ({ nome: "x.pdf", mime: "application/pdf", motivo: "passa de 15 MB", link: "https://drive.google.com/x" }) }).download(req(), d.id, r);
    expect(r.code).toBe(422);
    expect(r.body.link).toBe("https://drive.google.com/x");
    await expect(ctrl({ driveFile: vi.fn() }).download(req("w2"), d.id, res())).rejects.toThrow("não encontrado");
  });
});

describe("biblioteca: categorias", () => {
  it("devolve as categorias com a contagem e filtra por categoria (sem acento ou maiúscula)", async () => {
    seed({ title: "Exame", topic: "Saúde", tags: [] });
    seed({ title: "Consulta", topic: "saude", tags: [] });
    seed({ title: "Aluguel", topic: "Contratos", tags: [] });
    const all = await ctrl().list(req());
    expect(all.categories).toEqual([{ name: "Saúde", count: 2 }, { name: "Contratos", count: 1 }]);
    const only = await ctrl().list(req(), undefined, undefined, "SAUDE");
    expect(only.documents.map((d: any) => d.title).sort()).toEqual(["Consulta", "Exame"]);
    expect(only.categories).toHaveLength(2); // a lista de categorias não encolhe com o filtro
  });

  it("não mostra categorias de outro workspace", async () => {
    seed({ topic: "Alheia", workspaceId: "w2" });
    expect((await ctrl().list(req())).categories).toEqual([]);
  });
});

describe("biblioteca: categorias (criar e apagar)", () => {
  it("cria uma categoria vazia, que aparece na lista com contagem 0, e recusa repetida ou curta", async () => {
    seed({ topic: "Saúde" });
    const c = ctrl();
    const r = await c.createCat(req(), { name: "faculdade" });
    expect(r.name).toBe("Faculdade");
    expect((await c.list(req())).categories).toEqual([{ name: "Saúde", count: 1 }, { name: "Faculdade", count: 0 }]);
    await expect(c.createCat(req(), { name: "FACULDADE" })).rejects.toThrow(/já existe/);
    await expect(c.createCat(req(), { name: "a" })).rejects.toThrow(/2 letras/);
  });

  it("apagar move os documentos para Sem categoria e não apaga nenhum", async () => {
    seed({ topic: "Saúde" });
    const c = ctrl();
    const r = await c.removeCat(req(), "saude");
    expect(r.moved).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe("Sem categoria");
    expect(r.categories).toEqual([{ name: "Sem categoria", count: 1 }]);
  });

  it("apaga categoria vazia, recusa Sem categoria e a que não existe, e isola por workspace", async () => {
    const c = ctrl();
    await c.createCat(req(), { name: "Viagens" });
    expect((await c.list(req("w2"))).categories).toEqual([]);
    expect((await c.removeCat(req(), "Viagens")).categories).toEqual([]);
    await expect(c.removeCat(req(), "Sem categoria")).rejects.toThrow(/não pode ser apagada/);
    await expect(c.removeCat(req(), "Nada")).rejects.toThrow(/não encontrada/);
  });
});
