import { createCipheriv, createHash, randomBytes } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, openText, openToken, sealText, sealToken } from "../src/modules/webhooks/crypto";
import { jwtSecret } from "../src/config/jwt-secret";

const ENV = ["ENCRYPTION_KEY", "WEBHOOK_SECRET", "JWT_SECRET", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};

// Gera no formato antigo (sha256 direto do segredo), como estava gravado antes do HKDF
function legacy(plain: string, keyPrefix: string, secret: string, tag = "") {
  const key = createHash("sha256").update(`${keyPrefix}${secret}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return tag + [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

describe("cifra com HKDF e versão", () => {
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    delete process.env.ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    process.env.WEBHOOK_SECRET = "segredo-antigo-de-teste";
  });
  afterEach(() => {
    for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  });

  it("grava no formato novo e abre de volta", () => {
    expect(sealToken("t")).toMatch(/^enc2:/);
    expect(openToken(sealToken("t"))).toBe("t");
    expect(sealText("oi", "ws1")).toMatch(/^chat2:/);
    expect(openText(sealText("oi", "ws1"), "ws1")).toBe("oi");
    expect(decryptSecret(encryptSecret("s"))).toBe("s");
  });

  it("abre o que foi gravado no formato antigo", () => {
    const s = "segredo-antigo-de-teste";
    expect(openToken(legacy("tok", "token:", s, "enc1:"))).toBe("tok");
    expect(openText(legacy("msg", "chat:ws1:", s, "chat1:"), "ws1")).toBe("msg");
    expect(decryptSecret(legacy("hook", "", s))).toBe("hook");
  });

  it("chaves de finalidades e de workspaces diferentes não se misturam", () => {
    expect(() => openText(sealText("oi", "ws1"), "ws2")).toThrow();
    const stolen = "chat2:" + sealToken("x").slice("enc2:".length);
    expect(() => openText(stolen, "ws1")).toThrow();
  });

  it("girar a chave: ENCRYPTION_KEY novo cifra, o segredo antigo continua abrindo", () => {
    const antigo = sealText("guardado", "ws1");
    process.env.ENCRYPTION_KEY = "chave-nova-de-teste";
    expect(openText(antigo, "ws1")).toBe("guardado");
    const novo = sealText("novo", "ws1");
    delete process.env.ENCRYPTION_KEY;
    expect(() => openText(novo, "ws1")).toThrow();
  });

  it("adulteração é detectada", () => {
    const s = sealText("oi", "ws1");
    expect(() => openText(s.slice(0, -3) + (s.endsWith("AAA") ? "BBB" : "AAA"), "ws1")).toThrow();
  });

  it("sem segredo: fora de produção usa um aleatório do processo; em produção recusa", () => {
    delete process.env.WEBHOOK_SECRET;
    process.env.NODE_ENV = "test";
    expect(openToken(sealToken("x"))).toBe("x");
    expect(jwtSecret(undefined)).toBe(jwtSecret(undefined));
    expect(jwtSecret(undefined)).not.toBe("change-me-in-production");
    process.env.NODE_ENV = "production";
    expect(() => sealToken("x")).toThrow();
    expect(() => jwtSecret(undefined)).toThrow();
  });
});
