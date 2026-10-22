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

describe("áudio e arquivo no chat do app", () => {
  const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
  const setup = () => {
    users.push({ id: "u1", status: "ACTIVE", name: "Ana", role: "USER", services: ["assistant"], plan: null, workspaces: [{ workspaceId: "w1" }] });
    const stored: string[] = [];
    const chat = { store: vi.fn(async (_c: any, _d: string, _k: string, text: string) => (stored.push(text), { id: "m1" })), deliver: vi.fn(), typing: vi.fn(), redact: vi.fn() };
    const assistant = {
      transcribeForApp: vi.fn(async () => ({ text: "agenda de hoje" })),
      handle: vi.fn(async () => ({ redact: false })),
      handleMedia: vi.fn(async () => undefined),
    };
    return { ctrl: new AppChatController(chat as any, {} as any, assistant as any), chat, assistant, stored };
  };
  const req = { user: { id: "u1" } };
  beforeEach(() => users.splice(0));

  it("áudio: transcreve, guarda o texto e manda ao assistente como falado", async () => {
    const { ctrl, assistant, stored } = setup();
    await ctrl.audio(req, { base64: b64(1000), mime: "audio/webm;codecs=opus", seconds: 5 });
    expect(assistant.transcribeForApp).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), expect.any(Buffer), "audio/webm", 5);
    expect(stored).toEqual(["🎙️ agenda de hoje"]);
    await flush();
    expect(assistant.handle).toHaveBeenCalledWith(expect.anything(), "app", "agenda de hoje", { heard: true });
  });

  it("áudio: quando não dá para transcrever, mostra o aviso e não chama o assistente", async () => {
    const { ctrl, assistant, chat } = setup();
    assistant.transcribeForApp.mockResolvedValueOnce({ notice: "Esse áudio tem 6 min" } as any);
    await ctrl.audio(req, { base64: b64(1000), mime: "audio/mp4", seconds: 400 });
    expect(chat.deliver).toHaveBeenCalledWith(expect.anything(), "Esse áudio tem 6 min");
    expect(assistant.handle).not.toHaveBeenCalled();
  });

  it("áudio: recusa formato errado, vazio e grande demais", async () => {
    const { ctrl } = setup();
    await expect(ctrl.audio(req, { base64: b64(10), mime: "text/plain" })).rejects.toThrow("Formato");
    await expect(ctrl.audio(req, { base64: "", mime: "audio/webm" })).rejects.toThrow("vazio");
    await expect(ctrl.audio(req, { base64: b64(16 * 1024 * 1024), mime: "audio/webm" })).rejects.toThrow("grande");
  });

  it("arquivo: só imagem ou PDF, e o assistente lê com a legenda", async () => {
    const { ctrl, assistant, stored } = setup();
    await expect(ctrl.file(req, { base64: b64(10), mime: "application/zip", name: "a.zip" })).rejects.toThrow("imagem");
    await ctrl.file(req, { base64: b64(1000), mime: "application/pdf", name: "convite<script>.pdf", caption: "nota" });
    expect(stored[0]).toBe("📎 convitescript.pdf\nnota");
    await flush();
    expect(assistant.handleMedia).toHaveBeenCalledWith(expect.anything(), "app", expect.any(Function), { mime: "application/pdf", caption: "nota" });
  });

  it("arquivo: recusa o que passa de 15 MB", async () => {
    const { ctrl } = setup();
    await expect(ctrl.file(req, { base64: b64(16 * 1024 * 1024), mime: "image/png", name: "x.png" })).rejects.toThrow("grande");
  });
});

describe("chat do app", () => {
  it("recusa canal inválido", async () => {
    const ctrl = new AppChatController({} as any, {} as any, {} as any);
    await expect(ctrl.setChannel({ user: { id: "u1" } }, { channel: "sms" })).rejects.toThrow("Canal inválido");
  });
});
