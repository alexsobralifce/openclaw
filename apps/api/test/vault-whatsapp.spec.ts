import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({
  prisma: { workspaceMember: { findFirst: async () => ({ userId: "u1", user: { role: "ROOT", services: [], name: "Ana" } }) } },
}));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { AssistantSchedulerService } from "../src/modules/channels/assistant/assistant-scheduler.service";

const SECRET = { title: "GitHub", username: "ana@x.com", password: "S3nh@-do-GitHub!", url: "https://github.com", notes: "" };

function build(lookup: any, opts: { car?: boolean; reveal?: any } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const vault = {
    lookup: vi.fn(async () => lookup),
    revealForWhatsapp: vi.fn(async () => (opts.reveal === undefined ? SECRET : opts.reveal)),
    status: vi.fn(async () => ({ exists: true, unlocked: true, whatsapp: true, expiresAt: Date.now() + 600_000 })),
    lock: vi.fn(),
  };
  const menu = new MenuService({ listAccounts: async () => ["a@gmail.com"] } as any, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any, undefined, undefined, vault as any);
  if (opts.car) store.set("mode:w1", "car");
  const ai = vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("a IA não pode ser chamada"));
  return { menu, store, vault, ai };
}

const one = { state: "ok", matches: [{ id: "e1", title: "GitHub", username: "ana@x.com", url: "https://github.com" }] };
const two = { state: "ok", matches: [{ id: "e1", title: "GitHub", username: "ana@x.com", url: "" }, { id: "e2", title: "GitHub Work", username: "ana@ifce.br", url: "" }] };

describe("consulta de senha pelo WhatsApp", () => {
  it("um resultado: mostra a senha e marca a resposta para ser apagada", async () => {
    const { menu, vault } = build(one);
    const out = (await menu.respond("w1", "senha do github")) as string;
    expect(vault.lookup).toHaveBeenCalledWith("u1", "github");
    expect(out).toContain("S3nh@-do-GitHub!");
    expect(out).toContain("ana@x.com");
    expect(out).toContain("Apago esta mensagem");
    expect(await menu.takeSecret("w1")).toBe(true);
    expect(await menu.takeSecret("w1")).toBe(false); // lida uma vez só
  });

  it("vários resultados: a lista mostra nomes, nunca senhas; o número revela", async () => {
    const { menu, store, vault } = build(two);
    const list = (await menu.respond("w1", "qual a senha do github?")) as string;
    expect(list).toContain("Qual deles?");
    expect(list).not.toContain("S3nh@");
    expect(JSON.stringify([...store.values()])).not.toContain("S3nh@"); // nem no estado guardado
    expect(await menu.takeSecret("w1")).toBe(false);

    const out = (await menu.respond("w1", "2")) as string;
    expect(vault.revealForWhatsapp).toHaveBeenCalledWith("u1", "e2");
    expect(out).toContain("S3nh@-do-GitHub!");
    expect(await menu.takeSecret("w1")).toBe(true);
  });

  it("depois de mostrar, o estado volta ao menu (a senha não fica em tela nenhuma)", async () => {
    const { menu, store } = build(one);
    await menu.respond("w1", "senha do github");
    expect(store.get("menu:w1").screen).toBe("main");
    expect(JSON.stringify([...store.values()])).not.toContain("S3nh@");
  });

  it("cofre bloqueado, sem liberar o WhatsApp ou inexistente: explica e não mostra nada", async () => {
    for (const [state, text] of [["locked", "bloqueado"], ["no_whatsapp", "sem liberar"], ["none", "não criou"]] as const) {
      const { menu, vault } = build({ state, matches: [] });
      const out = (await menu.respond("w1", "senha do github")) as string;
      expect(out).toContain(text);
      expect(vault.revealForWhatsapp).not.toHaveBeenCalled();
      expect(await menu.takeSecret("w1")).toBe(false);
    }
  });

  it("sem resultado parecido, avisa", async () => {
    const { menu } = build({ state: "ok", matches: [] });
    expect(((await menu.respond("w1", "senha do xyz")) as string)).toContain("Não achei");
  });

  it("modo carro recusa (o carro leria a senha em voz alta)", async () => {
    const { menu, vault } = build(one, { car: true });
    const out = (await menu.respond("w1", "senha do github")) as string;
    expect(out).toContain("modo carro");
    expect(vault.lookup).not.toHaveBeenCalled();
    expect(out).not.toContain("S3nh@");
  });

  it("cofre bloqueado entre a busca e a escolha: não revela", async () => {
    const { menu } = build(two, { reveal: null });
    await menu.respond("w1", "senha do github");
    const out = (await menu.respond("w1", "1")) as string;
    expect(out).toContain("bloqueado");
    expect(await menu.takeSecret("w1")).toBe(false);
  });

  it("nada disso passa pela IA", async () => {
    const { menu, ai } = build(one);
    await menu.respond("w1", "senha do github");
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("cofre no menu", () => {
  it("'cofre' mostra o estado; 'bloquear cofre' tranca; o menu principal tem o item", async () => {
    const { menu, vault } = build(one);
    expect(((await menu.respond("w1", "cofre")) as string)).toContain("Liberado para o WhatsApp");
    expect(((await menu.respond("w1", "bloquear cofre")) as string)).toContain("bloqueado");
    expect(vault.lock).toHaveBeenCalledWith("u1");
    expect(((await menu.respond("w1", "menu")) as string)).toContain("Cofre de senhas");
  });
});

describe("senha digitada no chat", () => {
  it("avisa, não chama a IA e não trata como comando", async () => {
    const { menu, ai } = build(one);
    const out = (await menu.respond("w1", "minha senha do banco é X9#kd2abZ")) as string;
    expect(out).toContain("Não envie senhas");
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("apagar a resposta com senha", () => {
  function assistant(sendText: any, deleteMessage: any) {
    const store = new Map<string, any>();
    const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
    const menu = { setExecutor() {}, setFileSender() {}, setChatCleaner() {}, isCar: async () => false };
    const svc = new AssistantService({ sendText, deleteMessage } as any, {} as any, menu as any, {} as any, {} as any, state as any);
    return { svc, store, state };
  }
  const cmd = { userId: "u", name: "Ana", phone: "5585", workspaceId: "w1", services: [] } as any;

  it("resposta secreta agenda o apagamento; a comum não", async () => {
    const send = vi.fn(async () => ({ key: { id: "MSG1", remoteJid: "5585@s.whatsapp.net" } }));
    const { svc, store } = assistant(send, vi.fn());
    await svc.sendToUser(cmd, "inst", "oi");
    expect([...store.keys()].some((k) => k.startsWith("wipe:"))).toBe(false);
    await svc.sendToUser(cmd, "inst", "senha", { wipeAfterMs: 60_000 });
    const w = store.get("wipe:MSG1");
    expect(w.due).toBeGreaterThan(Date.now() + 50_000);
    expect(w.key).toEqual({ id: "MSG1", remoteJid: "5585@s.whatsapp.net", fromMe: true });
  });

  it("o agendador apaga no prazo e mantém para tentar de novo se o WhatsApp falhar", async () => {
    const wipeMessage = vi.fn(async () => true);
    const store = new Map<string, any>();
    const rows: any[] = [];
    const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => { store.set(k, v); }, del: async (k: string) => { store.delete(k); const i = rows.findIndex((r) => r.key === k); if (i >= 0) rows.splice(i, 1); } };
    rows.push({ key: "wipe:A", value: { due: Date.now() - 1, instance: "i", key: { id: "A", remoteJid: "j", fromMe: true } }, expiresAt: null });
    rows.push({ key: "wipe:B", value: { due: Date.now() + 60_000, instance: "i", key: { id: "B", remoteJid: "j", fromMe: true } }, expiresAt: null });
    store.set("wipe:A", 1);
    const db = await import("@openclaw/database");
    (db.prisma as any).kvEntry = { findMany: async ({ where }: any) => rows.filter((r) => r.key.startsWith(where.key.startsWith)) };
    const sched = new AssistantSchedulerService({ wipeMessage } as any, {} as any, state as any);
    await sched.tick();
    expect(wipeMessage).toHaveBeenCalledTimes(1);
    expect(wipeMessage.mock.calls[0]).toEqual(["i", { id: "A", remoteJid: "j", fromMe: true }]);
    expect(rows.map((r) => r.key)).toEqual(["wipe:B"]);

    wipeMessage.mockResolvedValue(false); // WhatsApp fora do ar: continua na fila
    rows[0].value.due = Date.now() - 1;
    await sched.tick();
    expect(rows.map((r) => r.key)).toEqual(["wipe:B"]);
  });
});
