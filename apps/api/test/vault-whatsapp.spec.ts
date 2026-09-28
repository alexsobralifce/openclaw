import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({
  prisma: { workspaceMember: { findFirst: async () => ({ userId: "u1", user: { role: "ROOT", services: [], name: "Ana" } }) } },
}));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { AssistantSchedulerService } from "../src/modules/channels/assistant/assistant-scheduler.service";

const SECRET = { title: "GitHub", username: "ana@x.com", password: "S3nh@-do-GitHub!", url: "https://github.com", notes: "", whatsapp: true };

type Lookup = { state: string; matches: any[] };
/**
 * `lookups` = respostas sucessivas de whatsappLookup; `opens` = respostas de whatsappOpen; `reveals` = de whatsappReveal.
 * O mock guarda a ordem das chamadas para conferir que o código é pedido ANTES de listar ou mostrar qualquer coisa.
 */
function build(lookups: Lookup[], opts: { car?: boolean; opens?: any[]; reveals?: any[] } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const calls: string[] = [];
  const next = <T,>(arr: T[], last: T) => (arr.length > 1 ? arr.shift()! : arr[0] ?? last);
  const lk = [...lookups];
  const op = [...(opts.opens ?? [{ ok: true }])];
  const rv = [...(opts.reveals ?? [SECRET])];
  const vault = {
    whatsappLookup: vi.fn(async () => (calls.push("lookup"), next(lk, lk[0]))),
    whatsappOpen: vi.fn(async () => (calls.push("open"), next(op, op[0]))),
    whatsappReveal: vi.fn(async () => (calls.push("reveal"), next(rv, rv[0]))),
    status: vi.fn(async () => ({ exists: true, unlocked: false, hasPin: true, waLocked: false })),
  };
  const menu = new MenuService({ listAccounts: async () => ["a@gmail.com"] } as any, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any, undefined, undefined, vault as any);
  if (opts.car) store.set("mode:w1", "car");
  const ai = vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("a IA não pode ser chamada"));
  return { menu, store, vault, ai, calls };
}

const one = { state: "ok", matches: [{ id: "e1", title: "GitHub", username: "ana@x.com", url: "https://github.com" }] };
const two = { state: "ok", matches: [{ id: "e1", title: "GitHub", username: "ana@x.com", url: "" }, { id: "e2", title: "GitHub Work", username: "ana@ifce.br", url: "" }] };
const needPin = { state: "pin_required", matches: [] };

describe("consulta de senha pelo WhatsApp", () => {
  it("pede o código ANTES de listar ou mostrar qualquer coisa; com o código certo, mostra a senha", async () => {
    const { menu, vault, calls, store } = build([needPin, one]);
    const ask = (await menu.respond("w1", "senha do github")) as string;
    expect(ask).toContain("Digite seu código de 4 dígitos");
    expect(ask).not.toContain("S3nh@");
    expect(store.get("menu:w1").screen).toBe("vault_pin_input");
    expect(await menu.awaitingPin("w1")).toBe(true);

    const out = (await menu.respond("w1", "4827")) as string;
    expect(vault.whatsappOpen).toHaveBeenCalledWith("u1", "4827");
    expect(out).toContain("S3nh@-do-GitHub!");
    expect(out).toContain("Apago esta mensagem");
    expect(calls).toEqual(["lookup", "open", "lookup", "reveal"]);
    expect(await menu.takeSecret("w1")).toBe(true);
    expect(await menu.takeSecret("w1")).toBe(false);
    expect(await menu.awaitingPin("w1")).toBe(false);
  });

  it("a mensagem com o código é marcada para sumir do registro de entrada (uma vez só)", async () => {
    const { menu } = build([needPin, one]);
    await menu.respond("w1", "senha do github");
    expect(await menu.takeRedact("w1")).toBe(false); // a pergunta não tinha código
    await menu.respond("w1", "4827");
    expect(await menu.takeRedact("w1")).toBe(true);
    expect(await menu.takeRedact("w1")).toBe(false);
  });

  it("vários resultados: lista só nomes; o número mostra a senha", async () => {
    const { menu, store, vault } = build([needPin, two], { reveals: [SECRET] });
    await menu.respond("w1", "qual a senha do github?");
    const list = (await menu.respond("w1", "4827")) as string;
    expect(list).toContain("Qual deles?");
    expect(list).not.toContain("S3nh@");
    expect(JSON.stringify([...store.values()])).not.toContain("S3nh@");
    const out = (await menu.respond("w1", "2")) as string;
    expect(vault.whatsappReveal).toHaveBeenCalledWith("u1", "e2");
    expect(out).toContain("S3nh@-do-GitHub!");
  });

  it("se o código expirou entre a lista e a escolha, pede de novo e segue para a senha certa", async () => {
    const { menu, vault } = build([needPin, two], { reveals: ["pin_required" as any, SECRET] });
    await menu.respond("w1", "senha do github");
    await menu.respond("w1", "4827");
    const again = (await menu.respond("w1", "1")) as string;
    expect(again).toContain("Digite seu código");
    const out = (await menu.respond("w1", "4827")) as string;
    expect(vault.whatsappReveal).toHaveBeenLastCalledWith("u1", "e1");
    expect(out).toContain("S3nh@-do-GitHub!");
  });

  it("código errado avisa quantas tentativas restam e continua esperando", async () => {
    const { menu, store, vault } = build([needPin], { opens: [{ ok: false, reason: "wrong", left: 2 }] });
    await menu.respond("w1", "senha do github");
    const out = (await menu.respond("w1", "1357")) as string;
    expect(out).toContain("Código incorreto");
    expect(out).toContain("Restam 2 tentativas");
    expect(store.get("menu:w1").screen).toBe("vault_pin_input");
    expect(vault.whatsappReveal).not.toHaveBeenCalled();
    expect(await menu.takeSecret("w1")).toBe(false);
  });

  it("no bloqueio, avisa como reativar e volta ao menu", async () => {
    const { menu, store } = build([needPin], { opens: [{ ok: false, reason: "locked" }] });
    await menu.respond("w1", "senha do github");
    const out = (await menu.respond("w1", "1357")) as string;
    expect(out).toContain("WhatsApp bloqueado");
    expect(out).toContain("senha mestra");
    expect(store.get("menu:w1").screen).toBe("main");
  });

  it("o que não tem 4 números não é enviado ao cofre nem gasta tentativa; 0 cancela", async () => {
    const { menu, vault, store } = build([needPin]);
    await menu.respond("w1", "senha do github");
    for (const t of ["12", "abcd", "12345", "quero cancelar"]) expect(((await menu.respond("w1", t)) as string)).toContain("4 números");
    expect(vault.whatsappOpen).not.toHaveBeenCalled();
    await menu.respond("w1", "0");
    expect(store.get("menu:w1").screen).toBe("main");
  });

  it("estados sem código: cofre inexistente, código não definido e WhatsApp bloqueado explicam o que fazer", async () => {
    for (const [state, text] of [["none", "não criou"], ["no_pin", "código de 4 dígitos"], ["locked", "bloqueado"]] as const) {
      const { menu, vault } = build([{ state, matches: [] }]);
      const out = (await menu.respond("w1", "senha do github")) as string;
      expect(out).toContain(text);
      expect(vault.whatsappOpen).not.toHaveBeenCalled();
      expect(await menu.takeSecret("w1")).toBe(false);
    }
  });

  it("sem resultado parecido, avisa", async () => {
    const { menu } = build([{ state: "ok", matches: [] }]);
    expect(((await menu.respond("w1", "senha do xyz")) as string)).toContain("Não achei");
  });

  it("modo carro recusa e não pede o código (o carro leria a senha em voz alta)", async () => {
    const { menu, vault } = build([one], { car: true });
    const out = (await menu.respond("w1", "senha do github")) as string;
    expect(out).toContain("modo carro");
    expect(vault.whatsappLookup).not.toHaveBeenCalled();
  });

  it("nada disso passa pela IA", async () => {
    const { menu, ai } = build([needPin, one]);
    await menu.respond("w1", "senha do github");
    await menu.respond("w1", "4827");
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("cofre no menu", () => {
  it("'cofre' mostra o estado; o menu principal tem o item", async () => {
    const { menu } = build([one]);
    expect(((await menu.respond("w1", "cofre")) as string)).toContain("Pronto para consulta");
    expect(((await menu.respond("w1", "menu")) as string)).toContain("Cofre de senhas");
  });
});

describe("senha digitada no chat", () => {
  it("avisa, não chama a IA e não trata como comando", async () => {
    const { menu, ai } = build([one]);
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
