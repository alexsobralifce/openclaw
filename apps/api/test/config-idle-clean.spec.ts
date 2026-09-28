import { describe, expect, it, vi } from "vitest";

const kv: { key: string; value: any; expiresAt: Date | null }[] = [];
vi.mock("@openclaw/database", () => ({
  prisma: {
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    kvEntry: { findMany: async ({ where }: any) => kv.filter((r) => r.key.startsWith(where.key.startsWith)) },
  },
}));

import { addSent, fmtInterval, intervalProblem, parseInterval, SENT_MAX } from "../src/modules/channels/assistant/chat-clean";
import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { AssistantSchedulerService } from "../src/modules/channels/assistant/assistant-scheduler.service";
import { EvolutionError } from "../src/modules/channels/evolution/evolution.service";

function makeState() {
  const store = new Map<string, any>();
  const state = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: any) => {
      store.set(k, v);
      const row = kv.find((r) => r.key === k);
      if (row) row.value = v;
      else kv.push({ key: k, value: v, expiresAt: null });
    },
    del: async (k: string) => {
      store.delete(k);
      const i = kv.findIndex((r) => r.key === k);
      if (i >= 0) kv.splice(i, 1);
    },
  };
  return { store, state };
}

describe("intervalo da limpeza", () => {
  it("entende do jeito que a pessoa fala", () => {
    const p = (t: string) => parseInterval(t);
    expect(p("a cada 2 horas")).toBe(120);
    expect(p("30 minutos")).toBe(30);
    expect(p("1 dia")).toBe(1440);
    expect(p("meia hora")).toBe(30);
    expect(p("a cada duas horas")).toBe(120);
    expect(p("1,5 h")).toBe(90);
    expect(p("nunca")).toBe(0);
    expect(p("desligar")).toBe(0);
    expect(p("talvez")).toBeNull();
  });

  it("recusa o que não dá para cumprir e descreve o intervalo", () => {
    expect(intervalProblem(5)).toContain("mínimo");
    expect(intervalProblem(72 * 60)).toContain("48 horas");
    expect(intervalProblem(0)).toBe("");
    expect(intervalProblem(360)).toBe("");
    expect(fmtInterval(0)).toBe("desligada");
    expect(fmtInterval(60)).toBe("a cada 1 hora");
    expect(fmtInterval(360)).toBe("a cada 6 horas");
    expect(fmtInterval(1440)).toBe("a cada 1 dia");
    expect(fmtInterval(45)).toBe("a cada 45 minutos");
  });

  it("a lista de mensagens não repete nem passa do teto", () => {
    let list = addSent([], { id: "a", jid: "j", instance: "i", fromMe: true, at: 1 });
    list = addSent(list, { id: "a", jid: "j", instance: "i", fromMe: true, at: 2 });
    expect(list).toHaveLength(1);
    for (let i = 0; i < SENT_MAX + 20; i++) list = addSent(list, { id: `m${i}`, jid: "j", instance: "i", fromMe: true, at: i });
    expect(list).toHaveLength(SENT_MAX);
    expect(list[list.length - 1].id).toBe(`m${SENT_MAX + 19}`);
  });
});

function menuFor() {
  const { store, state } = makeState();
  const google = { listAccounts: async () => ["a@gmail.com"] };
  const menu = new MenuService(google as any, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any);
  return { menu, store, state };
}

describe("configurações no menu", () => {
  it("o menu principal tem o botão Configurações e ele abre a tela", async () => {
    const { menu } = menuFor();
    const main = (await menu.respond("w1", "menu")) as string;
    expect(main).toContain("Configurações");
    const cfg = (await menu.respond("w1", "configurações")) as string;
    expect(cfg).toContain("Limpeza do chat:* desligada");
    expect(cfg).toContain("3 min");
  });

  it("escolher um tempo pronto salva e mostra a próxima limpeza", async () => {
    const { menu, store } = menuFor();
    await menu.respond("w1", "config");
    const ask = (await menu.respond("w1", "1")) as string;
    expect(ask).toContain("De quanto em quanto tempo");
    const out = (await menu.respond("w1", "2")) as string; // 6 horas
    expect(out).toContain("a cada 6 horas");
    const cfg = store.get("cfg:w1");
    expect(cfg.cleanMinutes).toBe(360);
    expect(cfg.nextCleanAt).toBeGreaterThan(Date.now() + 5 * 3600_000);
  });

  it("aceita descrever do próprio jeito e recusa valores impossíveis", async () => {
    const { menu, store } = menuFor();
    await menu.respond("w1", "config");
    await menu.respond("w1", "1");
    expect(((await menu.respond("w1", "a cada 3 minutos")) as string).toLowerCase()).toContain("mínimo");
    expect(store.get("cfg:w1")).toBeUndefined();
    expect((await menu.respond("w1", "sei lá")) as string).toContain("Não entendi");
    await menu.respond("w1", "a cada 90 minutos");
    expect(store.get("cfg:w1").cleanMinutes).toBe(90);
    await menu.respond("w1", "1");
    await menu.respond("w1", "nunca");
    expect(store.get("cfg:w1").cleanMinutes).toBe(0);
  });

  it("'Limpar agora' chama a limpeza e conta o que apagou", async () => {
    const { menu } = menuFor();
    const cleaner = vi.fn(async () => ({ deleted: 4, failed: 1 }));
    menu.setChatCleaner(cleaner);
    await menu.respond("w1", "config");
    const out = (await menu.respond("w1", "2")) as string;
    expect(cleaner).toHaveBeenCalledWith("w1", expect.any(Number));
    expect(out).toContain("Apaguei 4 mensagens");
    expect(out).toContain("1 não deu para apagar");
  });
});

describe("volta ao menu principal", () => {
  it("fora do menu, volta e avisa; já no menu, não faz nada", async () => {
    const { menu, store } = menuFor();
    expect(await menu.idleReturn("w1")).toBeNull();
    await menu.respond("w1", "agenda"); // tela da agenda
    expect(store.get("menu:w1").screen).toBe("agenda");
    const text = (await menu.idleReturn("w1")) as string;
    expect(text).toContain("Voltei ao menu principal");
    expect(text).toContain("cancelado");
    expect(store.get("menu:w1").screen).toBe("main");
    expect(await menu.idleReturn("w1")).toBeNull();
  });

  it("no modo carro reinicia a tela sem mandar nada", async () => {
    const { menu, store } = menuFor();
    await menu.respond("w1", "modo carro");
    await menu.respond("w1", "agenda");
    expect(await menu.idleReturn("w1")).toBeNull();
    expect(store.get("menu:w1").screen).toBe("main");
  });
});

function assistantFor(deleteMessage: any) {
  const { store, state } = makeState();
  const evolution = { deleteMessage };
  const menu = { setExecutor() {}, setFileSender() {}, setChatCleaner() {} };
  const svc = new AssistantService(evolution as any, {} as any, menu as any, {} as any, {} as any, state as any);
  return { svc, store };
}

const msg = (id: string, ageMin: number) => ({ id, jid: "5585@s.whatsapp.net", instance: "inst", fromMe: true, at: Date.now() - ageMin * 60_000 });

describe("limpeza do chat", () => {
  it("só registra o que o número conectado enviou", async () => {
    const { svc, store } = assistantFor(vi.fn());
    await svc.trackMessage("w1", "inst", { id: "x", remoteJid: "j", fromMe: false });
    await svc.trackMessage("w1", "inst", { id: "y", remoteJid: "j", fromMe: true });
    expect(store.get("sentmsgs:w1").map((m: any) => m.id)).toEqual(["y"]);
  });

  it("apaga as antigas, preserva as recentes e tira da lista só as apagadas", async () => {
    const del = vi.fn(async () => ({}));
    const { svc, store } = assistantFor(del);
    store.set("sentmsgs:w1", [msg("velha1", 60), msg("velha2", 30), msg("nova", 1)]);
    const r = await svc.cleanChat("w1", 3 * 60_000);
    expect(r).toEqual({ deleted: 2, failed: 0 });
    expect(del.mock.calls.map((c: any[]) => c[1].id)).toEqual(["velha1", "velha2"]);
    expect(del.mock.calls[0]).toEqual(["inst", { id: "velha1", remoteJid: "5585@s.whatsapp.net", fromMe: true }]);
    expect(store.get("sentmsgs:w1").map((m: any) => m.id)).toEqual(["nova"]);
  });

  it("mensagem que o WhatsApp não tem mais sai da lista; erro temporário fica para depois", async () => {
    const del = vi.fn(async (_i: string, k: any) => {
      if (k.id === "sumiu") throw new EvolutionError("not found", 404);
      if (k.id === "erro") throw new EvolutionError("boom", 500);
      return {};
    });
    const { svc, store } = assistantFor(del);
    store.set("sentmsgs:w1", [msg("sumiu", 60), msg("erro", 50), msg("ok", 40)]);
    const r = await svc.cleanChat("w1", 0);
    expect(r).toEqual({ deleted: 1, failed: 1 });
    expect(store.get("sentmsgs:w1").map((m: any) => m.id)).toEqual(["erro"]);
  });

  it("WhatsApp fora do ar: para de insistir e não perde a lista", async () => {
    const del = vi.fn(async () => {
      throw new EvolutionError("down", null);
    });
    const { svc, store } = assistantFor(del);
    store.set("sentmsgs:w1", [msg("a", 60), msg("b", 50), msg("c", 40)]);
    await svc.cleanChat("w1", 0);
    expect(del).toHaveBeenCalledTimes(1);
    expect(store.get("sentmsgs:w1")).toHaveLength(3);
  });
});

describe("agendador", () => {
  function scheduler() {
    kv.length = 0;
    const { store, state } = makeState();
    const assistant = { sendToUser: vi.fn(async () => {}), cleanChat: vi.fn(async () => ({ deleted: 0, failed: 0 })) };
    const menu = { idleReturn: vi.fn(async () => "MENU") };
    return { sched: new AssistantSchedulerService(assistant as any, menu as any, state as any), assistant, menu, state, store };
  }
  const cmd = { userId: "u", name: "Ana", phone: "5585", workspaceId: "w1", services: [] };

  it("envia o menu quando o prazo vence, uma vez só", async () => {
    const { sched, assistant, state } = scheduler();
    await state.set("idle:w1", { due: Date.now() - 1000, instance: "inst", c: cmd });
    await sched.tick();
    expect(assistant.sendToUser).toHaveBeenCalledWith(cmd, "inst", "MENU");
    await sched.tick();
    expect(assistant.sendToUser).toHaveBeenCalledTimes(1);
  });

  it("antes do prazo não faz nada", async () => {
    const { sched, assistant, menu, state } = scheduler();
    await state.set("idle:w1", { due: Date.now() + 60_000, instance: "inst", c: cmd });
    await sched.tick();
    expect(menu.idleReturn).not.toHaveBeenCalled();
    expect(assistant.sendToUser).not.toHaveBeenCalled();
  });

  it("limpa no horário e agenda a próxima; adia se o dono está conversando; ignora desligado", async () => {
    const { sched, assistant, state, store } = scheduler();
    await state.set("cfg:w1", { cleanMinutes: 60, nextCleanAt: Date.now() - 1000 });
    await state.set("cfg:w2", { cleanMinutes: 0 });
    await state.set("cfg:w3", { cleanMinutes: 60, nextCleanAt: Date.now() - 1000 });
    await state.set("idle:w3", { due: Date.now() + 120_000, instance: "inst", c: { ...cmd, workspaceId: "w3" } });
    await sched.tick();
    expect(assistant.cleanChat).toHaveBeenCalledTimes(1);
    expect(assistant.cleanChat).toHaveBeenCalledWith("w1", expect.any(Number));
    expect(store.get("cfg:w1").nextCleanAt).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(store.get("cfg:w3").nextCleanAt).toBeLessThan(Date.now());
  });
});
