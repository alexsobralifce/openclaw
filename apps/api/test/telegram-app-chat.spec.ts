import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const users: any[] = [];
vi.mock("@openclaw/database", () => ({
  prisma: {
    user: {
      findFirst: async ({ where }: any) => users.find((u) => (where.telegramChatId ? u.telegramChatId === where.telegramChatId && (!where.id?.not || u.id !== where.id.not) : true)) ?? null,
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data),
    },
  },
}));

import { pushPreview } from "../src/modules/channels/app-chat/app-chat.service";
import { newLinkCode, splitForTelegram, startCode, waToTelegramHtml } from "../src/modules/channels/telegram/telegram-format";
import { TelegramController } from "../src/modules/channels/telegram/telegram.controller";
import { AppChatController } from "../src/modules/channels/app-chat/app-chat.controller";

describe("formato do Telegram", () => {
  it("converte negrito/itálico e escapa HTML", () => {
    expect(waToTelegramHtml("*oi* _você_ <b>&")).toBe("<b>oi</b> <i>você</i> &lt;b&gt;&amp;");
  });
  it("divide texto longo sem passar do limite", () => {
    const parts = splitForTelegram(Array(50).fill("x".repeat(200)).join("\n"), 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
  });
  it("lê o código do /start e gera código sem letras ambíguas", () => {
    expect(startCode("/start abc23456")).toBe("ABC23456");
    expect(startCode("/start@magobot ABC23456")).toBe("ABC23456");
    expect(startCode("oi")).toBeNull();
    expect(newLinkCode((n) => Buffer.alloc(n, 7))).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });
});

describe("pushPreview", () => {
  it("não mostra o conteúdo de mensagem com segredo", () => {
    expect(pushPreview("senha: 123", true)).not.toContain("123");
  });
  it("tira marcação e corta o texto", () => {
    expect(pushPreview("*Olá*   mundo")).toBe("Olá mundo");
    expect(pushPreview("a".repeat(300)).length).toBe(110);
  });
});

function telegramSetup() {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const sent: [string, string][] = [];
  const telegram = { enabled: () => true, sendText: vi.fn(async (chat: string, t: string) => void sent.push([chat, t])) };
  const assistant = { handle: vi.fn(async () => ({ redact: false })) };
  const ctrl = new TelegramController(telegram as any, assistant as any, state as any);
  return { ctrl, store, sent, assistant };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const msg = (text: string, chat = 10, type = "private") => ({ message: { text, chat: { id: chat, type } } });

describe("webhook do Telegram", () => {
  beforeEach(() => {
    users.length = 0;
    process.env.TELEGRAM_WEBHOOK_SECRET = "segredo-teste";
  });
  afterEach(() => delete process.env.TELEGRAM_WEBHOOK_SECRET);

  it("recusa segredo ausente ou errado", async () => {
    const { ctrl, assistant } = telegramSetup();
    await expect(ctrl.webhook(undefined, msg("oi"))).rejects.toThrow();
    await expect(ctrl.webhook("outro-segredo", msg("oi"))).rejects.toThrow();
    await flush();
    expect(assistant.handle).not.toHaveBeenCalled();
  });

  it("chat sem vínculo recebe instruções e não chega ao assistente", async () => {
    const { ctrl, sent, assistant } = telegramSetup();
    await ctrl.webhook("segredo-teste", msg("agenda de hoje"));
    await flush();
    expect(sent[0][1]).toContain("não está vinculado");
    expect(assistant.handle).not.toHaveBeenCalled();
  });

  it("ignora grupos", async () => {
    const { ctrl, sent } = telegramSetup();
    await ctrl.webhook("segredo-teste", msg("/start ABC23456", 10, "group"));
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("vincula com código válido, uma única vez", async () => {
    users.push({ id: "u1", telegramChatId: null });
    const { ctrl, store, sent } = telegramSetup();
    store.set("tg:link:ABC23456", { userId: "u1" });
    await ctrl.webhook("segredo-teste", msg("/start ABC23456"));
    await flush();
    expect(users[0].telegramChatId).toBe("10");
    expect(store.has("tg:link:ABC23456")).toBe(false);
    expect(sent[0][1]).toContain("vinculado");
    await ctrl.webhook("segredo-teste", msg("/start ABC23456"));
    await flush();
    expect(sent[1][1]).toContain("inválido");
  });

  it("não vincula um chat que já é de outra conta", async () => {
    users.push({ id: "u1", telegramChatId: null }, { id: "u2", telegramChatId: "10" });
    const { ctrl, store, sent } = telegramSetup();
    store.set("tg:link:ABC23456", { userId: "u1" });
    await ctrl.webhook("segredo-teste", msg("/start ABC23456"));
    await flush();
    expect(users[0].telegramChatId).toBeNull();
    expect(sent[0][1]).toContain("outra conta");
  });
});

describe("chat do app", () => {
  it("recusa canal inválido", async () => {
    const ctrl = new AppChatController({} as any, {} as any, {} as any);
    await expect(ctrl.setChannel({ user: { id: "u1" } }, { channel: "sms" })).rejects.toThrow("Canal inválido");
  });
});
