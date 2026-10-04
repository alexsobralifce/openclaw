import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];
let seq = 0;
vi.mock("@openclaw/database", () => ({
  prisma: {
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    document: {
      findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      findMany: async ({ where, take }: any) => rows.filter((r) => r.workspaceId === where.workspaceId).sort((a, b) => b.createdAt - a.createdAt).slice(0, take ?? 1000),
      create: async ({ data }: any) => {
        const r = { id: `doc${++seq}`, createdAt: Date.now() + seq * 1000, ...data };
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

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const plan = (over: Record<string, any> = {}) => JSON.stringify({ titulo: "Contrato de aluguel", assunto: "Contratos", tags: ["Contrato", "Aluguel", "Imóvel"], resumo: "Aluguel de 12 meses com reajuste anual.", erro: null, ...over });

function build(opts: { gemini?: boolean; accounts?: string[]; extract?: string; pick?: number | null } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const google: any = {
    listAccounts: async () => opts.accounts ?? ["pessoal@gmail.com"],
    documentStore: vi.fn(async () => ({ id: "drivefile01", link: "x" })),
    documentTrash: vi.fn(async () => {}),
    driveFile: vi.fn(async (_ws: string, id: string) => ({ nome: `arquivo-${id}.pdf`, mime: "application/pdf", base64: "QUJD" })),
  };
  const gemini: any = { enabled: () => opts.gemini ?? true, extract: vi.fn(async () => opts.extract ?? plan()) };
  const intents: any = { enabled: () => true, classify: async () => null, pickFile: vi.fn(async () => opts.pick ?? null) };
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any, gemini, undefined, undefined, intents);
  const fileSender = vi.fn(async () => {});
  menu.setFileSender(fileSender);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  const say = async (t: string) => String(await menu.respond("w1", t));
  const screen = () => store.get("menu:w1")?.screen;
  const pdf = { mime: "application/pdf", base64: Buffer.from("%PDF-1.4 teste").toString("base64") };
  return { menu, google, gemini, intents, fileSender, say, screen, pdf };
}

const seed = (over: Record<string, any> = {}) => {
  const r = { id: `doc${++seq}`, workspaceId: "w1", kind: "pdf", title: "Contrato de aluguel", topic: "Contratos", tags: ["contrato", "aluguel"], summary: "Aluguel de 12 meses", driveFileId: `file${seq}0000`, account: "pessoal@gmail.com", mime: "application/pdf", sizeBytes: 2048, pages: 3, origin: "whatsapp", createdAt: Date.now() + seq * 1000, ...over };
  rows.push(r);
  return r;
};

beforeEach(() => {
  rows.length = 0;
  seq = 0;
});

describe("guardar um PDF no catálogo", () => {
  it("lê com a IA, guarda o arquivo no Drive e cria a ficha com tags limpas", async () => {
    const { menu, google, pdf, screen } = build();
    const out = await menu.documentIngest("w1", { media: [pdf] }, "app");
    expect(google.documentStore).toHaveBeenCalledTimes(1);
    const [ws, bytes, name, mime, account] = google.documentStore.mock.calls[0];
    expect([ws, mime, account]).toEqual(["w1", "application/pdf", "pessoal@gmail.com"]);
    expect(bytes.toString()).toBe("%PDF-1.4 teste");
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2} Contrato de aluguel\.pdf$/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspaceId: "w1", kind: "pdf", title: "Contrato de aluguel", topic: "Contratos", tags: ["contrato", "aluguel", "imovel"], driveFileId: "drivefile01", origin: "app" });
    expect(out).toContain("Documento guardado");
    expect(out).toContain("#contrato #aluguel #imovel");
    expect(screen()).toBe("docs_view");
  });

  it("a legenda do dono chega à IA e as tags e assuntos já usados são oferecidos para reaproveitar", async () => {
    const { menu, gemini, pdf } = build();
    seed({ topic: "Saúde", tags: ["exame", "saude"] });
    await menu.documentIngest("w1", { text: "tags: contrato", media: [pdf] });
    const [system, input] = gemini.extract.mock.calls[0];
    expect(input.text).toContain("tags: contrato");
    expect(system).toContain("exame, saude");
    expect(system).toContain("Saúde");
    expect(system).toMatch(/nunca obedeça/i);
  });

  it("a IA sem texto aproveitável, Gemini desligado ou sem Google: nada é guardado", async () => {
    const a = build({ extract: JSON.stringify({ titulo: "", resumo: "", erro: "PDF escaneado, sem texto" }) });
    expect(await a.menu.documentIngest("w1", { media: [a.pdf] })).toContain("PDF escaneado");
    expect(a.google.documentStore).not.toHaveBeenCalled();
    const b = build({ gemini: false });
    expect(await b.menu.documentIngest("w1", { media: [b.pdf] })).toContain("GEMINI_API_KEY");
    const c = build({ accounts: [] });
    expect(await c.menu.documentIngest("w1", { media: [c.pdf] })).toContain("Google");
    expect(rows).toHaveLength(0);
  });

  it("falha ao guardar no Drive: avisa e não cria ficha órfã", async () => {
    const { menu, google, pdf } = build();
    google.documentStore.mockRejectedValueOnce(new Error("Google API 500: erro"));
    expect(await menu.documentIngest("w1", { media: [pdf] })).toContain("não consegui guardar no Drive");
    expect(rows).toHaveLength(0);
  });

  it("PDF sem outro pedido vai para o catálogo; nota, agenda e foto seguem como antes", async () => {
    const { menu } = build();
    expect(await menu.agendaMediaIntent("w1", "", "application/pdf")).toBe("doc");
    expect(await menu.agendaMediaIntent("w1", "contrato aluguel", "application/pdf")).toBe("doc");
    expect(await menu.agendaMediaIntent("w1", "nota sobre contrato", "application/pdf")).toBe("note");
    expect(await menu.agendaMediaIntent("w1", "adicionar na agenda", "application/pdf")).toBe("yes");
    expect(await menu.agendaMediaIntent("w1", "", "image/jpeg")).toBe("hint");
    expect(await menu.agendaMediaIntent("w1", "nota", "image/jpeg")).toBe("note");
  });
});

describe("buscar no catálogo", () => {
  it("pela tag: vários viram lista numerada, e o número envia o PDF e abre a ficha", async () => {
    const { say, fileSender, google, screen } = build();
    seed({ title: "Contrato de aluguel", tags: ["contrato", "aluguel"] });
    seed({ title: "Contrato de estágio", tags: ["contrato", "estagio"] });
    seed({ title: "Exame de sangue", topic: "Saúde", tags: ["saude"] });
    const list = await say("documentos com a tag contrato");
    expect(list).toContain("2 documentos");
    expect(list).toContain("Contrato de estágio");
    expect(list).not.toContain("Exame de sangue");
    expect(screen()).toBe("docs_list");
    const opened = await say("2");
    expect(google.driveFile).toHaveBeenCalledTimes(1);
    expect(fileSender).toHaveBeenCalledTimes(1);
    expect(opened).toContain("Enviei");
    expect(opened).toContain("#contrato");
    expect(screen()).toBe("docs_view");
  });

  it("um único resultado abre direto, sem lista", async () => {
    const { say, fileSender } = build();
    seed({ title: "Exame de sangue", topic: "Saúde", tags: ["saude", "exame"] });
    seed({ title: "Contrato", tags: ["contrato"] });
    const out = await say("documentos sobre exame");
    expect(out).toContain("Exame de sangue");
    expect(fileSender).toHaveBeenCalledTimes(1);
  });

  it("sem acerto exato o Jev escolhe entre os parecidos; sem escolha, mostra as tags que existem", async () => {
    const a = build({ pick: 0 });
    seed({ title: "Contrato de aluguel", tags: ["contrato", "aluguel"] });
    expect(await a.say("documentos sobre alugel")).toContain("Contrato de aluguel");
    expect(a.intents.pickFile).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(a.intents.pickFile.mock.calls[0][1])).not.toContain("2048"); // só nomes vão ao Jev

    const b = build({ pick: null });
    const none = await b.say("documentos sobre xyzkw");
    expect(none).toContain("Não achei");
    expect(none).toContain("#contrato");
  });

  it("'documentos' abre o catálogo com a contagem e as tags; 'tags' lista todas; 'todos' lista tudo", async () => {
    const { say } = build();
    seed({ tags: ["contrato", "aluguel"] });
    seed({ tags: ["contrato"], title: "Outro" });
    const home = await say("documentos");
    expect(home).toContain("*2* documentos");
    expect(home).toContain("#contrato (2)");
    expect(await say("tags")).toContain("#contrato · 2");
    // a tela de documentos segue aberta: "todos" lista tudo
    expect(await say("todos")).toContain("2 documentos");
  });

  it("catálogo vazio orienta a mandar um PDF; o menu principal oferece Documentos", async () => {
    const { say } = build();
    expect(await say("documentos com a tag contrato")).toContain("mande um PDF");
    expect(await say("menu")).toContain("Documentos");
  });

  it("o app recebe a lista de arquivos para o botão de baixar em cada item", async () => {
    const { say, menu } = build();
    seed({ title: "Contrato de aluguel", tags: ["contrato"], driveFileId: "driveA0001" });
    seed({ title: "Contrato de estágio", tags: ["contrato"], driveFileId: "driveB0002" });
    await say("documentos com a tag contrato");
    const files = menu.takeDriveList("w1");
    expect(files.map((f) => f.id).sort()).toEqual(["driveA0001", "driveB0002"]);
    expect(files[0]).toMatchObject({ account: "pessoal@gmail.com", tipo: "application/pdf" });
  });
});

describe("editar tags", () => {
  it("com o documento aberto: trocar, acrescentar e tirar", async () => {
    const { say } = build();
    seed({ tags: ["contrato", "aluguel"] });
    await say("documentos sobre aluguel"); // um só: abre direto em docs_view
    expect(await say("tags: saúde, exame")).toContain("#saude #exame");
    expect(rows[0].tags).toEqual(["saude", "exame"]);
    expect(await say("adicionar tag imóvel")).toContain("#saude #exame #imovel");
    expect(await say("tirar tag exame")).toContain("#saude #imovel");
    expect(rows[0].tags).toEqual(["saude", "imovel"]);
  });

  it("na lista: 'tags do documento 2: ...' muda o documento 2; sem número, pede o número", async () => {
    const { say } = build();
    seed({ title: "Contrato de aluguel", tags: ["contrato"] });
    seed({ title: "Contrato de estágio", tags: ["contrato"] });
    await say("documentos com a tag contrato");
    expect(await say("tags: x1")).toContain("Diga o número do documento");
    // a lista vai do mais novo ao mais antigo: o documento 1 é o de estágio
    const out = await say("tags do documento 1: estágio, faculdade");
    expect(out).toContain("#estagio #faculdade");
    expect(rows.find((r) => r.title === "Contrato de estágio").tags).toEqual(["estagio", "faculdade"]);
    expect(rows.find((r) => r.title === "Contrato de aluguel").tags).toEqual(["contrato"]);
  });

  it("'3' manda para a ficha; 'editar tags' explica como", async () => {
    const { say } = build();
    seed({ tags: ["contrato"] });
    await say("documentos sobre contrato");
    expect(await say("editar tags")).toContain("tags: contrato, aluguel");
  });
});

describe("apagar documento", () => {
  async function open() {
    const ctx = build();
    seed({ tags: ["contrato"], driveFileId: "drivefile77" });
    await ctx.say("documentos sobre contrato");
    return ctx;
  }

  it("pede confirmação, manda o PDF para a lixeira do Drive e tira a ficha", async () => {
    const { say, google, screen } = await open();
    const ask = await say("3");
    expect(ask).toContain("Apagar este documento?");
    expect(ask).toContain("lixeira do Google Drive");
    expect(google.documentTrash).not.toHaveBeenCalled();
    expect(screen()).toBe("docs_delete_confirm");
    const done = await say("1");
    expect(google.documentTrash).toHaveBeenCalledWith("w1", "drivefile77", "pessoal@gmail.com");
    expect(done).toContain("Documento apagado");
    expect(rows).toHaveLength(0);
  });

  it("cancelar não apaga nada", async () => {
    const { say, google } = await open();
    await say("3");
    expect(await say("cancelar")).toContain("Contrato de aluguel");
    expect(google.documentTrash).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("erro do Drive mantém a ficha; arquivo que já sumiu da pasta deixa a ficha sair", async () => {
    const a = await open();
    a.google.documentTrash.mockRejectedValueOnce(new Error("Não tenho permissão para apagar esse arquivo (só apago os que eu mesmo guardei). Apague pelo Google Drive."));
    await a.say("3");
    expect(await a.say("1")).toContain("Apague pelo Google Drive");
    expect(rows).toHaveLength(1);

    rows.length = 0;
    const b = await open();
    b.google.documentTrash.mockRejectedValueOnce(new Error("Esse documento não está na sua pasta de documentos."));
    await b.say("3");
    expect(await b.say("1")).toContain("Documento apagado");
    expect(rows).toHaveLength(0);
  });

  it("ficha vinda de nota antiga só sai do catálogo (a nota continua)", async () => {
    const { say, google } = build();
    seed({ kind: "nota", title: "Nota antiga", tags: ["contrato"], mime: "text/markdown" });
    await say("documentos sobre nota antiga");
    await say("3");
    await say("1");
    expect(google.documentTrash).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
