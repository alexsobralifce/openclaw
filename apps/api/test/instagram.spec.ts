import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { parseInstagramWebhook, toMessageContent } from "../src/modules/channels/instagram/parse";
import { InstagramService } from "../src/modules/channels/instagram/instagram.service";

const payload = (messaging: any[], entryId = "111") => ({ object: "instagram", entry: [{ id: entryId, time: 1700000000000, messaging }] });
const msg = (extra: any = {}, sender = "222") => ({ sender: { id: sender }, recipient: { id: "111" }, timestamp: 1700000000123, message: { mid: "m1", text: "oi", ...extra } });

describe("webhook do Instagram: parse", () => {
  it("extrai a mensagem de texto", () => {
    const [ev] = parseInstagramWebhook(payload([msg()]));
    expect(ev).toMatchObject({ accountId: "111", senderId: "222", mid: "m1", text: "oi", timestamp: 1700000000123 });
  });

  it("ignora eco, mensagem apagada, mensagem da própria conta, reação e outro objeto", () => {
    expect(parseInstagramWebhook(payload([msg({ is_echo: true })]))).toEqual([]);
    expect(parseInstagramWebhook(payload([msg({ is_deleted: true })]))).toEqual([]);
    expect(parseInstagramWebhook(payload([msg({}, "111")]))).toEqual([]);
    expect(parseInstagramWebhook(payload([{ sender: { id: "222" }, reaction: { mid: "m1", action: "react" } }]))).toEqual([]);
    expect(parseInstagramWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseInstagramWebhook(null)).toEqual([]);
  });

  it("converte anexos em tipo, texto e url", () => {
    const [ev] = parseInstagramWebhook(payload([msg({ text: undefined, attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] })]));
    expect(toMessageContent(ev)).toEqual({ body: "📷 Imagem", type: "IMAGE", metadata: { igMediaUrls: ["https://cdn/x.jpg"] } });
    const [share] = parseInstagramWebhook(payload([msg({ text: undefined, attachments: [{ type: "share", payload: { url: "https://ig/p" } }] })]));
    expect(toMessageContent(share).type).toBe("TEXT");
    expect(toMessageContent(share).body).toContain("publicação");
  });
});

describe("webhook do Instagram: assinatura", () => {
  const svc = new InstagramService();
  const raw = Buffer.from('{"object":"instagram"}');
  const sign = (secret: string, body: Buffer) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  beforeEach(() => { process.env.INSTAGRAM_APP_SECRET = "segredo-do-app"; });

  it("aceita a assinatura correta", () => {
    expect(svc.verifySignature(raw, sign("segredo-do-app", raw))).toBe(true);
  });

  it("recusa assinatura errada, corpo alterado, cabeçalho ausente ou sem prefixo", () => {
    expect(svc.verifySignature(raw, sign("outro", raw))).toBe(false);
    expect(svc.verifySignature(Buffer.from('{"object":"x"}'), sign("segredo-do-app", raw))).toBe(false);
    expect(svc.verifySignature(raw, undefined)).toBe(false);
    expect(svc.verifySignature(raw, sign("segredo-do-app", raw).slice(7))).toBe(false);
    expect(svc.verifySignature(undefined, sign("segredo-do-app", raw))).toBe(false);
  });

  it("recusa tudo quando o app secret não está configurado", () => {
    delete process.env.INSTAGRAM_APP_SECRET;
    expect(svc.verifySignature(raw, sign("", raw))).toBe(false);
  });
});
