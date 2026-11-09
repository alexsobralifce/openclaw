import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto";

// ─── Chaves ───────────────────────────────────────────────────────────────────
// Todas as chaves de cifra saem de um segredo-mestre via HKDF-SHA256, uma por finalidade (e por escopo, no chat).
// Segredo-mestre: ENCRYPTION_KEY (preferido) → WEBHOOK_SECRET → JWT_SECRET. Para girar a chave, defina ENCRYPTION_KEY:
// o que foi cifrado com o segredo anterior continua abrindo (a leitura tenta todos os candidatos) e novas gravações usam a nova.
// Fora de produção, sem nenhum segredo, usa-se um segredo aleatório só deste processo (nunca um valor fixo conhecido).

let ephemeral: string | null = null;

/** Segredos candidatos, do mais novo para o mais antigo; o primeiro é o que cifra. */
export function masterSecrets(): string[] {
  const list = [process.env.ENCRYPTION_KEY, process.env.WEBHOOK_SECRET, process.env.JWT_SECRET].filter((s): s is string => !!s);
  const unique = [...new Set(list)];
  if (unique.length) return unique;
  if (process.env.NODE_ENV === "production") throw new Error("Nenhum segredo de cifra configurado (ENCRYPTION_KEY ou WEBHOOK_SECRET)");
  return [(ephemeral ??= randomBytes(32).toString("hex"))];
}

const SALT = Buffer.from("magobox-crypto-v2");

function derive(master: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, SALT, info, 32));
}

// Derivação antiga (sha256 direto do segredo), mantida só para ler o que foi gravado antes do HKDF.
const legacySecret = () => process.env.WEBHOOK_SECRET || process.env.JWT_SECRET || "change-me-in-production";
const legacyKey = (prefix: string) => createHash("sha256").update(`${prefix}${legacySecret()}`).digest();

// ─── Núcleo AES-256-GCM ─────────────────────────────────────────────────────────

function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

function openWith(body: string, key: Buffer): string {
  const [iv, tag, ct] = body.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** Abre com cada chave candidata; erro só se nenhuma servir (cifra autenticada: texto adulterado também falha). */
function openAny(body: string, keys: Buffer[]): string {
  let last: unknown;
  for (const k of keys) {
    try {
      return openWith(body, k);
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("nenhuma chave serve");
}

const v2Keys = (info: string) => masterSecrets().map((m) => derive(m, info));

// ─── Segredos de webhook ────────────────────────────────────────────────────────

const SECRET_V2 = "sec2:";

/** Cifra um segredo para guardar no banco (AES-256-GCM, chave HKDF própria). */
export function encryptSecret(plain: string): string {
  return SECRET_V2 + seal(plain, v2Keys("secret")[0]);
}

/** Lê um segredo; o formato antigo (sem prefixo) continua abrindo. */
export function decryptSecret(stored: string): string {
  if (stored.startsWith(SECRET_V2)) return openAny(stored.slice(SECRET_V2.length), v2Keys("secret"));
  return openWith(stored, legacyKey(""));
}

// ─── Tokens de terceiros (Google, Spotify) ─────────────────────────────

const TOKEN_V1 = "enc1:";
const TOKEN_V2 = "enc2:";

export const isSealed = (stored: unknown): stored is string => typeof stored === "string" && (stored.startsWith(TOKEN_V1) || stored.startsWith(TOKEN_V2));

/** Cifra um token de terceiros (ex.: refresh token do Google) para guardar no banco. */
export function sealToken(plain: string): string {
  return TOKEN_V2 + seal(plain, v2Keys("token")[0]);
}

/** Lê o token guardado; valores antigos (enc1: ou sem cifra) continuam funcionando até serem migrados. */
export function openToken(stored: string): string {
  if (stored.startsWith(TOKEN_V2)) return openAny(stored.slice(TOKEN_V2.length), v2Keys("token"));
  if (stored.startsWith(TOKEN_V1)) return openWith(stored.slice(TOKEN_V1.length), legacyKey("token:"));
  return stored;
}

// ─── Textos guardados com chave própria de cada workspace (chat do app, memória da conversa) ───

const CHAT_V1 = "chat1:";
const CHAT_V2 = "chat2:";

const chatInfo = (scope: string) => `chat:${scope}`;

/** Cifra um texto (AES-256-GCM) com a chave do escopo, normalmente o id do workspace. */
export function sealText(plain: string, scope: string): string {
  return CHAT_V2 + seal(plain, v2Keys(chatInfo(scope))[0]);
}

/** Lê um texto cifrado por `sealText`. Com chave errada ou texto adulterado, lança erro (a cifra é autenticada). */
export function openText(stored: string, scope: string): string {
  if (stored.startsWith(CHAT_V2)) return openAny(stored.slice(CHAT_V2.length), v2Keys(chatInfo(scope)));
  if (stored.startsWith(CHAT_V1)) return openWith(stored.slice(CHAT_V1.length), legacyKey(`chat:${scope}:`));
  throw new Error("texto não cifrado por esta chave");
}

// ─── Campos do banco (mensagens, memórias, notas) ───────────────────────────────────

const isSealedText = (s: string) => s.startsWith(CHAT_V1) || s.startsWith(CHAT_V2);

/** Cifra um campo de texto do banco com a chave do workspace. */
export const sealField = (plain: string, workspaceId: string) => sealText(plain, workspaceId);

/**
 * Lê um campo do banco. Valor gravado antes da cifra (texto puro) volta como está, e os registros antigos vão sendo cifrados
 * pelo `EncryptionBackfillService`. Se a leitura falhar (chave trocada sem manter a antiga), devolve o texto guardado.
 */
export function openField(stored: string, workspaceId: string): string {
  if (!isSealedText(stored)) return stored;
  try {
    return openText(stored, workspaceId);
  } catch {
    return stored;
  }
}

/** Campo já está cifrado? (para o backfill não cifrar duas vezes) */
export const isSealedField = isSealedText;
