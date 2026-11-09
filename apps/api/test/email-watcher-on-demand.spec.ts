import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  channels: [] as any[],
  updates: [] as any[],
  owner: { userId: "u1", role: "USER", plan: "FREE" } as any,
}));

vi.mock("@openclaw/database", () => ({
  prisma: {
    channel: {
      findMany: async () => h.channels,
      update: async (args: any) => {
        h.updates.push(args);
        return {};
      },
    },
  },
}));
vi.mock("../src/modules/channels/assistant/commander", () => ({
  workspaceCommander: async () => h.owner,
  can: () => true,
  assistantInstance: async () => "inst",
}));
vi.mock("../src/modules/channels/assistant/email-mute", () => ({ loadMute: async () => ({}) }));
vi.mock("../src/modules/channels/assistant/notify-prefs", () => ({ notifyOn: async () => false }));
vi.mock("../src/modules/channels/assistant/channel-route", () => ({ channelOfInstance: () => "whatsapp" }));
vi.mock("../src/modules/channels/assistant/email-filter", () => ({ classifyEmail: () => ({ kind: "person" }), isHidden: () => false }));

import { EmailWatcherService } from "../src/modules/channels/assistant/email-watcher.service";

const T0 = 1_700_000_000_000;

function setup(items: any[] = []) {
  const google = { gmailSearch: vi.fn(async () => items) };
  const menu = { enqueueNew: vi.fn(async () => items.length), notifyNew: vi.fn(async () => "aviso") };
  const assistant = { sendToUser: vi.fn(), notifyUnread: vi.fn() };
  const webhooks = { emit: vi.fn() };
  const svc = new EmailWatcherService(google as any, assistant as any, menu as any, webhooks as any, {} as any);
  return { svc, google, menu };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  h.channels = [];
  h.updates = [];
});

describe("vigia de e-mail sob demanda", () => {
  it("não agenda nenhum timer e não consulta o Gmail sozinho", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    vi.setSystemTime(T0);
    const spy = vi.spyOn(globalThis, "setInterval");
    h.channels = [{ id: "c1", workspaceId: "ws1", config: { email: "a@x.com", provider: "google", lastSeenMs: T0 - 1000 } }];
    const { svc, google } = setup([{ id: "m1", de: "Ana", assunto: "oi", internalDate: T0 + 1 }]);
    // Sem ganchos de ciclo de vida do Nest: nada é agendado na inicialização do módulo
    expect((svc as any).onModuleInit).toBeUndefined();
    expect((svc as any).onModuleDestroy).toBeUndefined();
    vi.advanceTimersByTime(60 * 60_000);
    expect(spy).not.toHaveBeenCalled();
    expect(google.gmailSearch).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("checkNow enfileira o e-mail novo e avança lastSeenMs para o mais recente", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    h.channels = [{ id: "c1", workspaceId: "ws1", config: { email: "a@x.com", provider: "google", lastSeenMs: T0 - 5_000 } }];
    const items = [
      { id: "m1", de: "Ana", assunto: "oi", internalDate: T0 - 2_000 },
      { id: "m2", de: "Bia", assunto: "reunião", internalDate: T0 - 1_000 },
    ];
    const { svc, menu } = setup(items);
    await svc.checkNow("ws1");
    expect(menu.enqueueNew).toHaveBeenCalledTimes(1);
    const queued = (menu.enqueueNew.mock.calls[0] as any[])[1] as any[];
    expect(queued.map((i) => i.id)).toEqual(["m2", "m1"]);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].data.config.lastSeenMs).toBe(T0 - 1_000);
  });

  it("uma conferência por workspace por vez e nova só depois de 30 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    h.channels = [{ id: "c1", workspaceId: "ws1", config: { email: "a@x.com", provider: "google", lastSeenMs: T0 - 5_000 } }];
    const { svc, google } = setup([]);
    await Promise.all([svc.checkNow("ws1"), svc.checkNow("ws1")]);
    expect(google.gmailSearch).toHaveBeenCalledTimes(1);
    await svc.checkNow("ws1");
    expect(google.gmailSearch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 31_000);
    await svc.checkNow("ws1");
    expect(google.gmailSearch).toHaveBeenCalledTimes(2);
  });
});
