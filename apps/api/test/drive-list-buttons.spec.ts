import { describe, expect, it, vi } from "vitest";

const created: any[] = [];
vi.mock("@magobox/database", () => ({
  prisma: {
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    appMessage: {
      create: async ({ data }: any) => {
        created.push(data);
        return { id: "m1", createdAt: new Date(), ...data };
      },
    },
    user: { findUnique: async () => ({ id: "u1", status: "ACTIVE", name: "Ana", role: "USER", services: ["assistant"], plan: null, workspaces: [{ workspaceId: "w1" }] }) },
  },
}));

process.env.WEBHOOK_SECRET = "segredo-de-teste-da-memoria";

import { AppChatController } from "../src/modules/channels/app-chat/app-chat.controller";
import { AppChatService } from "../src/modules/channels/app-chat/app-chat.service";
import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { MenuService } from "../src/modules/channels/assistant/menu.service";

const file = (id: string, nome: string, tamanho = 3_000_000) => ({ id, nome, tipo: "audio/mpeg", modificado: "2015-10-02T10:00:00Z", tamanho });

function buildMenu(strict: any[]) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const google = { listAccounts: async () => ["pessoal@gmail.com"], driveSearch: vi.fn(async () => strict), driveFile: vi.fn(async () => ({ nome: "x", mime: "audio/mpeg", base64: "QUJD" })) };
  const menu = new MenuService(google as any, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any);
  menu.setFileSender(vi.fn(async () => {}));
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  return menu;
}

describe("lista de arquivos: dados para o botão de baixar", () => {
  const found = [file("id-aaaaaaaa1", "CATINGUEIRA.mp3"), file("id-aaaaaaaa2", "Catingueira - Marinês.mp3")].map((f) => ({ ...f, account: "pessoal@gmail.com" }));

  it("a lista montada fica disponível uma única vez, na mesma ordem do texto", async () => {
    const menu = buildMenu(found);
    const out = (await menu.respond("w1", "quero a musica catingueira")) as string;
    expect(out).toContain("Achei 2 arquivos");
    const list = menu.takeDriveList("w1");
    expect(list.map((f) => f.nome)).toEqual(["CATINGUEIRA.mp3", "Catingueira - Marinês.mp3"]);
    expect(list[0]).toEqual({ id: "id-aaaaaaaa1", account: "pessoal@gmail.com", nome: "CATINGUEIRA.mp3", tipo: "audio/mpeg", tamanho: 3_000_000 });
    expect(menu.takeDriveList("w1")).toEqual([]);
  });

  it("arquivo único já enviado não vira lista", async () => {
    const menu = buildMenu([found[0]]);
    await menu.respond("w1", "quero a musica catingueira");
    expect(menu.takeDriveList("w1")).toEqual([]);
  });
});

describe("a resposta chega ao app com os arquivos", () => {
  function assistant(files: any[]) {
    const deliver = vi.fn(async () => ({}));
    const sendText = vi.fn(async () => ({ key: { id: "M", remoteJid: "x@s.whatsapp.net" } }));
    const menu = { setExecutor() {}, setFileSender() {}, setChatCleaner() {}, respond: async () => "📁 lista", isCar: async () => false, takeSecret: async () => false, takeRedact: async () => false, awaitingPin: async () => false, takeDriveList: vi.fn(() => files) };
    const svc = new AssistantService({ sendText } as any, {} as any, menu as any, { promptBlock: async () => "" } as any, {} as any, { get: async () => null, set: async () => {}, del: async () => {} } as any, undefined, undefined, { deliver } as any);
    return { svc, deliver, sendText, menu };
  }
  const c = { userId: "u1", name: "Ana", phone: "5585", workspaceId: "w1", services: [] } as any;
  const listed = [{ id: "id-aaaaaaaa1", account: "pessoal@gmail.com", nome: "CATINGUEIRA.mp3", tipo: "audio/mpeg", tamanho: 3_000_000 }];

  it("no app, a mensagem leva a lista de arquivos", async () => {
    const { svc, deliver } = assistant(listed);
    await svc.handle(c, "app", "quero a musica catingueira");
    expect(deliver).toHaveBeenCalledWith(c, "📁 lista", expect.objectContaining({ files: listed }));
  });

  it("no WhatsApp a lista é consumida e ignorada: nada muda no envio", async () => {
    const { svc, sendText, menu } = assistant(listed);
    await svc.handle(c, "inst", "quero a musica catingueira");
    expect(menu.takeDriveList).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(expect.anything(), expect.anything(), "📁 lista");
  });

  it("sem lista, a mensagem não ganha arquivos", async () => {
    const { svc, deliver } = assistant([]);
    await svc.handle(c, "app", "bom dia");
    expect(deliver.mock.calls[0][2].files).toBeUndefined();
  });
});

describe("a mensagem guarda os arquivos da lista", () => {
  it("só os campos esperados, no máximo 8, no meta (o texto não muda)", async () => {
    created.length = 0;
    const svc = new AppChatService({ set: async () => {}, get: async () => null } as any, { emit() {}, online: async () => true } as any, { notify: async () => {} } as any);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `id-${"x".repeat(150)}${i}`, account: "a@gmail.com", nome: "n".repeat(300), tipo: "audio/mpeg", tamanho: 10, extra: "nao deve ir" }));
    await svc.deliver({ userId: "u1", workspaceId: "w1" } as any, "lista", { files: many as any });
    const meta = created[0].meta;
    expect(meta.files).toHaveLength(8);
    expect(Object.keys(meta.files[0]).sort()).toEqual(["account", "id", "nome", "tamanho", "tipo"]);
    expect(meta.files[0].nome.length).toBe(120);
    expect(meta.files[0].id.length).toBe(100);
  });
});

describe("baixar um arquivo da lista", () => {
  const req = { user: { id: "u1" } };
  const res = () => {
    const r: any = { headers: {} as any, body: undefined as any, code: 200 };
    r.set = (h: any) => Object.assign(r.headers, h);
    r.send = (b: any) => ((r.body = b), r);
    r.status = (n: number) => ((r.code = n), r);
    r.json = (b: any) => ((r.body = b), r);
    return r;
  };
  const ctrl = (driveFile: any, accounts = ["pessoal@gmail.com", "ifce@gmail.com"]) => new AppChatController({} as any, {} as any, {} as any, { listAccounts: async () => accounts, driveFile } as any);
  const ID = "1inPexaVxpXZ9qgxMaUahHGttwaOAbHkq";

  it("entrega os bytes com o nome certo, na conta pedida, sem cache", async () => {
    const driveFile = vi.fn(async () => ({ nome: "Catingueira - Marinês.mp3", mime: "audio/mpeg", base64: Buffer.from("ABC").toString("base64") }));
    const r = res();
    await ctrl(driveFile).driveDownload(req, ID, "ifce@gmail.com", r);
    expect(driveFile).toHaveBeenCalledWith("w1", ID, "ifce@gmail.com");
    expect(r.body.toString()).toBe("ABC");
    expect(r.headers["Content-Type"]).toBe("audio/mpeg");
    expect(r.headers["Content-Disposition"]).toContain(encodeURIComponent("Catingueira - Marinês.mp3"));
    expect(r.headers["Cache-Control"]).toContain("no-store");
  });

  it("recusa identificador estranho e conta que não é do usuário", async () => {
    const driveFile = vi.fn();
    await expect(ctrl(driveFile).driveDownload(req, "../../etc/passwd", "pessoal@gmail.com", res())).rejects.toThrow("inválido");
    await expect(ctrl(driveFile).driveDownload(req, ID, "outra@pessoa.com", res())).rejects.toThrow("não encontrada");
    expect(driveFile).not.toHaveBeenCalled();
  });

  it("sem conta informada usa a primeira; arquivo grande devolve 422 com o link do Drive", async () => {
    const driveFile = vi.fn(async () => ({ nome: "show.mp3", mime: "audio/mpeg", motivo: "passa de 15 MB", link: "https://drive.google.com/x" }));
    const r = res();
    await ctrl(driveFile).driveDownload(req, ID, undefined, r);
    expect(driveFile).toHaveBeenCalledWith("w1", ID, "pessoal@gmail.com");
    expect(r.code).toBe(422);
    expect(r.body).toMatchObject({ link: "https://drive.google.com/x" });
  });

  it("erro do Drive vira 'não encontrado', sem vazar detalhes demais", async () => {
    const driveFile = vi.fn(async () => {
      throw new Error("x".repeat(500));
    });
    await expect(ctrl(driveFile).driveDownload(req, ID, "pessoal@gmail.com", res())).rejects.toThrow();
  });
});
