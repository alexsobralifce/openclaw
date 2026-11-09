import { describe, expect, it, vi } from "vitest";

const rows: { key: string; value: any; expiresAt: Date | null }[] = [];
vi.mock("@magobox/database", () => ({
  prisma: {
    kvEntry: { findMany: async () => rows },
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    channel: { findFirst: async () => null },
    conversation: { findMany: async () => [] },
  },
}));
vi.mock("../src/modules/channels/assistant/commander", () => ({
  workspaceCommander: async () => ({ userId: "u1", workspaceId: "ws" }),
  assistantInstance: async () => "app",
  can: () => true,
}));
vi.mock("../src/modules/channels/assistant/list-notes-store", () => ({ claimReminder: async () => true, dueReminders: async () => [], updateNote: async () => undefined }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { AssistantSchedulerService } from "../src/modules/channels/assistant/assistant-scheduler.service";
import { dayBlocks, weekSummary } from "../src/modules/channels/assistant/agenda-view";
import { loadNotify, parseNotifyCommand, remindPlan } from "../src/modules/channels/assistant/notify-prefs";

const TZ = "America/Fortaleza";
const dayStr = (off: number) => new Date(Date.now() + off * 86_400_000).toLocaleDateString("sv-SE", { timeZone: TZ });

function setup(events: any[] = []) {
  const store = new Map<string, any>();
  const state: any = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: any, ttl?: number) => {
      store.set(k, JSON.parse(JSON.stringify(v)));
      if (k.startsWith("evrem:")) rows.push({ key: k, value: v, expiresAt: ttl ? new Date(Date.now() + ttl) : null });
    },
    del: async (k: string) => {
      store.delete(k);
      const i = rows.findIndex((r) => r.key === k);
      if (i >= 0) rows.splice(i, 1);
    },
  };
  const google: any = {
    listAccounts: async () => ["a@x.com"],
    calendarList: async () => events,
    calendarCreate: async () => ({ id: "e1" }),
  };
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", list: async () => [] } as any, state);
  return { menu, store, state, say: (t: string) => menu.respond("ws", t) };
}

describe("avisos e lembretes (lógica)", () => {
  it("entende ligar/desligar por texto", () => {
    expect(parseNotifyCommand("desligar avisos de email")).toEqual({ kind: "email", on: false });
    expect(parseNotifyCommand("ativar lembretes da agenda")).toEqual({ kind: "agenda", on: true });
    expect(parseNotifyCommand("desligar avisos de notas")).toEqual({ kind: "notes", on: false });
    expect(parseNotifyCommand("quero desligar tudo")).toBeNull();
  });

  it("calcula quando avisar; horário que já passou não avisa", () => {
    const now = new Date("2026-10-08T12:00:00-03:00").getTime();
    expect(remindPlan("2026-10-08T15:00:00-03:00", "15m", now)!.at).toBe(new Date("2026-10-08T14:45:00-03:00").getTime());
    expect(remindPlan("2026-10-08T12:10:00-03:00", "1h", now)).toBeNull();
    expect(remindPlan("2026-10-10", "eve", now)!.at).toBe(new Date("2026-10-09T18:00:00-03:00").getTime());
    expect(remindPlan("2026-10-10", "day", now)!.at).toBe(new Date("2026-10-10T08:00:00-03:00").getTime());
    expect(remindPlan("2026-10-10", "none", now)).toBeNull();
  });

  it("dia: dia inteiro primeiro, depois por horário; semana conta e marca os livres", () => {
    const d = dayStr(0);
    const evs = [
      { titulo: "Almoço", inicio: `${d}T12:00:00-03:00`, fim: `${d}T13:00:00-03:00` },
      { titulo: "Feriado", inicio: d },
      { titulo: "Reunião", inicio: `${d}T09:00:00-03:00`, fim: `${d}T10:00:00-03:00`, local: "Sala 2" },
    ];
    const blocks = dayBlocks(evs, TZ, false);
    expect(blocks.map((b) => b.split("\n")[1])).toEqual(["*Feriado*", "*Reunião*", "*Almoço*"]);
    expect(blocks[1]).toContain("🕘 09:00 – 10:00");
    expect(blocks[1]).toContain("📍 Sala 2");
    const week = weekSummary([d, dayStr(1)], evs, TZ);
    expect(week[0]).toMatchObject({ count: 3, first: "09:00" });
    expect(week[1]).toMatchObject({ count: 0 });
  });
});

describe("agenda: 7 dias com um botão por dia", () => {
  it("mostra os 7 dias (livres incluídos); tocar abre o dia; 0 volta à semana", async () => {
    const d = dayStr(2);
    const { say } = setup([{ id: "1", titulo: "Dentista", inicio: `${d}T15:00:00-03:00`, fim: `${d}T16:00:00-03:00` }]);
    await say("agenda");
    const week = (await say("3"))!;
    expect(week).toContain("Próximos 7 dias");
    expect((week.match(/\d️⃣/gu) ?? []).length).toBeGreaterThanOrEqual(8); // 7 dias + voltar
    expect(week).toContain("livre");
    expect(week).toContain("1 compromisso");
    const day = (await say("3"))!; // o terceiro dia (hoje+2)
    expect(day).toContain("*Dentista*");
    expect(day).toContain("🕘 15:00 – 16:00");
    expect(await say("0")).toContain("Próximos 7 dias");
  });
});

describe("lembrete escolhido ao criar o evento", () => {
  it("pergunta depois de criar, guarda o aviso e o agendador envia uma vez só", async () => {
    const { menu, say, state } = setup();
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    const out = await (menu as any).eventsCreate("ws", [{ title: "Reunião", start, end: new Date(Date.now() + 3 * 3600_000).toISOString() }], "a@x.com");
    expect(out).toContain("Quer um lembrete?");
    expect((await say("1"))!).toContain("Combinado");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("evrem:ws:e1");

    const sent: string[] = [];
    const sched = new AssistantSchedulerService({ sendToUser: async (_c: any, _i: string, t: string) => void sent.push(t) } as any, menu, state);
    await (sched as any).eventRemindersDue(Date.now()); // ainda não é hora
    expect(sent).toHaveLength(0);
    const at = rows[0].value.at;
    await (sched as any).eventRemindersDue(at + 1000);
    await (sched as any).eventRemindersDue(at + 2000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Reunião");
  });

  it("'Não precisa' não guarda nada; com avisos da agenda desligados o aviso não sai", async () => {
    const { menu, say, state } = setup();
    rows.splice(0);
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    await (menu as any).eventsCreate("ws", [{ title: "X", start, end: start }], "a@x.com");
    await say("4");
    expect(rows).toHaveLength(0);

    await (menu as any).eventsCreate("ws", [{ title: "Y", start, end: start }], "a@x.com");
    await say("1");
    await say("desligar avisos da agenda");
    expect((await loadNotify(state, "ws")).agenda).toBe(false);
    const sent: string[] = [];
    const sched = new AssistantSchedulerService({ sendToUser: async (_c: any, _i: string, t: string) => void sent.push(t) } as any, menu, state);
    await (sched as any).eventRemindersDue(rows[0].value.at + 1000);
    expect(sent).toHaveLength(0);
  });
});

describe("tela de avisos", () => {
  it("cada cartão mostra o estado e troca ao tocar", async () => {
    const { menu, say, state } = setup();
    const screen = (await (menu as any).notifyMenu("ws")) as string;
    expect(screen).toContain("ligado");
    const after = (await say("1"))!;
    expect(after).toContain("desligado");
    expect(await loadNotify(state, "ws")).toMatchObject({ email: false, agenda: true, notes: true });
    expect(await say("0")).toContain("Configurações");
  });
});
