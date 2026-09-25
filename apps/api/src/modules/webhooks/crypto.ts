import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const key = () => createHash("sha256").update(process.env.WEBHOOK_SECRET || process.env.JWT_SECRET || "change-me-in-production").digest();

/** Cifra um segredo para guardar no banco (AES-256-GCM). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

const TOKEN_PREFIX = "enc1:";
const tokenKey = () => createHash("sha256").update(`token:${process.env.WEBHOOK_SECRET || process.env.JWT_SECRET || "change-me-in-production"}`).digest();

export const isSealed = (stored: unknown): stored is string => typeof stored === "string" && stored.startsWith(TOKEN_PREFIX);

/** Cifra um token de terceiros (ex.: refresh token do Google) para guardar no banco. */
export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return TOKEN_PREFIX + [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

/** Lê o token guardado; valores antigos, sem cifra, continuam funcionando até serem migrados. */
export function openToken(stored: string): string {
  if (!isSealed(stored)) return stored;
  const [iv, tag, ct] = stored.slice(TOKEN_PREFIX.length).split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", tokenKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, ct] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
