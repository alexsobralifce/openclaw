// Núcleo criptográfico do cofre de senhas (lógica pura, sem banco).
//
// Camadas:
//  1. Senha mestra → scrypt (memória-intensivo) → KEK. A KEK só existe na memória durante o desbloqueio.
//  2. Chave do cofre (VK, aleatória de 32 bytes) fica guardada CIFRADA pela KEK. Trocar a senha mestra só recifra a VK.
//  3. Da VK saem duas subchaves independentes (HKDF): uma cifra as entradas, outra assina a cadeia.
//  4. Cada entrada é AES-256-GCM com IV novo e AAD ligando o texto cifrado ao cofre, à entrada e ao bloco.
//  5. Os registros formam uma cadeia de hashes com chave (HMAC-SHA256): cada bloco inclui o hash do anterior. A cadeia
//     não protege o conteúdo (quem faz isso é a cifra): ela permite PROVAR que ninguém alterou, apagou, reordenou ou
//     trocou registros. Como o HMAC usa uma chave que só sai da senha mestra, quem só tem acesso ao banco não consegue
//     refazer a cadeia depois de mexer nela.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "crypto";

export interface KdfParams {
  alg: "scrypt";
  N: number;
  r: number;
  p: number;
  /** base64 */
  salt: string;
}

/** Custo padrão (OWASP: N=2^17, r=8, p=1 ≈ 128 MiB). Em hospedagem apertada, VAULT_SCRYPT_LOG2N=16 reduz para 64 MiB. */
export function defaultLog2N(): number {
  const fromEnv = Number(process.env.VAULT_SCRYPT_LOG2N);
  const wanted = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 17;
  return process.env.NODE_ENV === "test" ? Math.min(wanted, 10) : Math.min(Math.max(wanted, 15), 20);
}

export function newKdf(log2N = defaultLog2N()): KdfParams {
  return { alg: "scrypt", N: 2 ** log2N, r: 8, p: 1, salt: randomBytes(16).toString("base64") };
}

/** Parâmetros vêm do banco: recusa valores absurdos (adulteração para esgotar memória ou enfraquecer a chave). */
export function assertKdf(k: any): asserts k is KdfParams {
  const okN = Number.isInteger(k?.N) && k.N >= 2 ** 10 && k.N <= 2 ** 20 && (k.N & (k.N - 1)) === 0;
  if (k?.alg !== "scrypt" || !okN || k.r !== 8 || k.p !== 1 || typeof k.salt !== "string" || Buffer.from(k.salt, "base64").length < 16) {
    throw new Error("parâmetros de derivação de chave inválidos");
  }
  if (process.env.NODE_ENV !== "test" && k.N < 2 ** 15) throw new Error("parâmetros de derivação de chave fracos demais");
}

export function deriveKek(password: string, kdf: KdfParams): Promise<Buffer> {
  assertKdf(kdf);
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), Buffer.from(kdf.salt, "base64"), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const b64 = (b: Buffer) => b.toString("base64");

/** AES-256-GCM: "v1.iv.tag.texto" em base64. `aad` amarra o texto cifrado ao contexto (não é secreto). */
export function seal(key: Buffer, plain: Buffer | string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
}

/** Lança se a chave estiver errada, o contexto (aad) for outro ou o texto tiver sido alterado. */
export function open(key: Buffer, sealed: string, aad: string): Buffer {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("formato inválido");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]);
}

export interface VaultKeys {
  /** cifra as entradas */
  enc: Buffer;
  /** assina a cadeia */
  mac: Buffer;
}

export function subkeys(vk: Buffer): VaultKeys {
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", vk, Buffer.alloc(0), info, 32));
  return { enc: derive("openclaw-vault/enc/v1"), mac: derive("openclaw-vault/chain/v1") };
}

export const newVaultKey = () => randomBytes(32);
export const wrapVaultKey = (kek: Buffer, vk: Buffer, vaultId: string) => seal(kek, vk, `vault-key|${vaultId}`);
export const unwrapVaultKey = (kek: Buffer, wrapped: string, vaultId: string) => open(kek, wrapped, `vault-key|${vaultId}`);

/** Zera a memória de chaves que não serão mais usadas. */
export function wipe(...bufs: (Buffer | undefined)[]) {
  for (const b of bufs) b?.fill(0);
}

// ─── Entradas ────────────────────────────────────────────────────

export interface EntryData {
  title: string;
  url: string;
  username: string;
  password: string;
  notes: string;
}

export const LIMITS = { title: 120, url: 300, username: 200, password: 500, notes: 2000, entries: 500 } as const;

/** Valida e normaliza o que veio do cliente; devolve mensagem de erro em vez de lançar. */
export function checkEntry(raw: any): { ok: true; data: EntryData } | { ok: false; error: string } {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const data: EntryData = { title: s(raw?.title).trim(), url: s(raw?.url).trim(), username: s(raw?.username).trim(), password: s(raw?.password), notes: s(raw?.notes) };
  if (!data.title) return { ok: false, error: "Informe o nome do site ou serviço." };
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    if (k !== "entries" && data[k as keyof EntryData].length > LIMITS[k]) return { ok: false, error: `O campo ${k} passou de ${LIMITS[k]} caracteres.` };
  }
  return { ok: true, data };
}

export const entryAad = (vaultId: string, entryId: string, seq: number) => `entry|${vaultId}|${entryId}|${seq}`;

export function sealEntry(enc: Buffer, vaultId: string, entryId: string, seq: number, data: EntryData): string {
  return seal(enc, JSON.stringify(data), entryAad(vaultId, entryId, seq));
}

export function openEntry(enc: Buffer, vaultId: string, entryId: string, seq: number, payload: string): EntryData {
  const j = JSON.parse(open(enc, payload, entryAad(vaultId, entryId, seq)).toString("utf8"));
  return { title: String(j.title ?? ""), url: String(j.url ?? ""), username: String(j.username ?? ""), password: String(j.password ?? ""), notes: String(j.notes ?? "") };
}

// ─── Senha mestra ────────────────────────────────────────────────

const WEAK = /^(?:senha|password|qwerty|admin|letmein|123456|abcdef|iloveyou|mudar|trocar)/i;

/** Regras mínimas da senha mestra; vazio se estiver boa. */
export function masterPasswordProblem(pw: string): string {
  if (typeof pw !== "string" || pw.length < 12) return "Use pelo menos 12 caracteres.";
  if (pw.length > 200) return "Use no máximo 200 caracteres.";
  if (/^(.)\1+$/.test(pw)) return "Não use um caractere repetido.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3 && pw.length < 20) return "Misture maiúsculas, minúsculas, números e símbolos, ou use uma frase com 20 caracteres ou mais.";
  if (WEAK.test(pw) && pw.length < 20) return "Essa senha é previsível demais. Escolha outra.";
  return "";
}

// ─── Cadeia de hashes com chave ──────────────────────────────────

export const GENESIS = "0".repeat(64);
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type BlockOp = "put" | "delete";

export interface BlockCore {
  vaultId: string;
  seq: number;
  prevHash: string;
  op: BlockOp;
  entryId: string;
  payloadHash: string;
}

export function blockHash(mac: Buffer, b: BlockCore): string {
  return createHmac("sha256", mac).update([b.vaultId, b.seq, b.prevHash, b.op, b.entryId, b.payloadHash].join("|")).digest("hex");
}

export interface StoredBlock {
  seq: number;
  prevHash: string;
  op: string;
  entryId: string;
  /** vazio depois de a entrada ser substituída ou apagada: o hash do conteúdo continua na cadeia */
  payload: string;
  payloadHash: string;
  hash: string;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface ChainResult {
  ok: boolean;
  checked: number;
  /** o que está errado, em português, com o número do bloco */
  problem?: string;
}

/**
 * Confere a cadeia inteira: numeração sem buracos, encadeamento, conteúdo × hash do conteúdo, assinatura de cada bloco e
 * o topo registrado no cofre (pega bloco apagado no fim da cadeia).
 */
export function verifyChain(mac: Buffer, vaultId: string, blocks: StoredBlock[], head: { seq: number; hash: string }): ChainResult {
  const sorted = [...blocks].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const fail = (why: string): ChainResult => ({ ok: false, checked: i, problem: `Bloco ${b.seq}: ${why}` });
    if (b.seq !== i + 1) return { ok: false, checked: i, problem: `Faltando o bloco ${i + 1} (a sequência pulou para ${b.seq}).` };
    if (b.prevHash !== prev) return fail("não se liga ao bloco anterior.");
    if (b.op !== "put" && b.op !== "delete") return fail("operação desconhecida.");
    if (b.payload && sha256(b.payload) !== b.payloadHash) return fail("o conteúdo cifrado foi alterado.");
    const expected = blockHash(mac, { vaultId, seq: b.seq, prevHash: b.prevHash, op: b.op, entryId: b.entryId, payloadHash: b.payloadHash });
    if (!same(expected, b.hash)) return fail("a assinatura não confere (registro alterado ou feito sem a chave do cofre).");
    prev = b.hash;
  }
  if (sorted.length !== head.seq) return { ok: false, checked: sorted.length, problem: `O cofre registra ${head.seq} blocos, mas existem ${sorted.length}: há blocos removidos ou acrescentados.` };
  if ((head.seq === 0 ? "" : prev) !== head.hash) return { ok: false, checked: sorted.length, problem: "O último bloco não é o registrado no cofre." };
  return { ok: true, checked: sorted.length };
}

/** Estado atual: para cada entrada, o bloco "put" mais recente que não foi seguido de "delete". */
export function liveEntries<T extends { seq: number; op: string; entryId: string }>(blocks: T[]): T[] {
  const latest = new Map<string, T>();
  for (const b of [...blocks].sort((a, c) => a.seq - c.seq)) latest.set(b.entryId, b);
  return [...latest.values()].filter((b) => b.op === "put").sort((a, c) => a.seq - c.seq);
}

// ─── Chave de recuperação e token de redefinição ─────────────────
//
// A chave de recuperação é um segundo cadeado para a MESMA chave do cofre, aberto por um valor aleatório de 160 bits que só
// o dono guarda (mostrado uma única vez). Como é aleatório e longo, não precisa de scrypt: basta HKDF. O link por e-mail sozinho
// NÃO abre nada: ele só prova que a conta é do dono e autoriza a troca da senha mestra por quem também tem a chave.

// Alfabeto Crockford (sem I, L, O, U): a leitura à mão perdoa O/0 e I/L/1, que parseRecoveryKey normaliza
const B32_STD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 20 bytes aleatórios como "XXXX-XXXX-…" (8 grupos de 4 = 32 caracteres, 160 bits). */
export function newRecoveryKey(): { text: string; bytes: Buffer } {
  const bytes = randomBytes(20);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 31; i >= 0; i--) out += B32_STD[Number((bits >> BigInt(i * 5)) & 31n)];
  return { text: out.match(/.{4}/g)!.join("-"), bytes };
}

/** Aceita minúsculas, espaços e traços; O→0 e I/L→1 (erros comuns de digitação). Nulo se não for uma chave válida. */
export function parseRecoveryKey(input: string): Buffer | null {
  const t = String(input ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (t.length !== 32 || [...t].some((c) => !B32_STD.includes(c))) return null;
  let bits = 0n;
  for (const c of t) bits = (bits << 5n) | BigInt(B32_STD.indexOf(c));
  const out = Buffer.alloc(20);
  for (let i = 19; i >= 0; i--) {
    out[i] = Number(bits & 255n);
    bits >>= 8n;
  }
  return out;
}

export const newRecoverySalt = () => randomBytes(16).toString("base64");

export function recoveryKek(bytes: Buffer, saltB64: string): Buffer {
  return Buffer.from(hkdfSync("sha256", bytes, Buffer.from(saltB64, "base64"), "openclaw-vault/recovery/v1", 32));
}

export const wrapVaultKeyRecovery = (kek: Buffer, vk: Buffer, vaultId: string) => seal(kek, vk, `vault-key-recovery|${vaultId}`);
export const unwrapVaultKeyRecovery = (kek: Buffer, wrapped: string, vaultId: string) => open(kek, wrapped, `vault-key-recovery|${vaultId}`);

/** Token do link de e-mail: aleatório, curto de digitar na URL. Só o hash dele é guardado no servidor. */
export const newResetToken = () => randomBytes(32).toString("base64url");
export const hashResetToken = (token: string) => sha256(`vault-reset|${token}`);
export const resetTokenShape = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{40,50}$/.test(t);

/** "ana.souza@gmail.com" → "a***@gmail.com" */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain ?? ""}`;
}
