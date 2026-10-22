import { createHash, randomBytes } from "crypto";
import type { StateService } from "../state/state.service";

export type TokenKind = "verify-email" | "reset-password";

const TTL_MS: Record<TokenKind, number> = { "verify-email": 48 * 3600_000, "reset-password": 60 * 60_000 };

// Só o hash do token fica guardado: quem lê o banco não consegue usar um link pendente
const keyOf = (kind: TokenKind, raw: string) => `acct:${kind}:${createHash("sha256").update(raw).digest("hex")}`;

/** Gera o token do link (vai só no e-mail). Um novo pedido não invalida os anteriores, mas todos expiram sozinhos. */
export async function issueToken(state: StateService, kind: TokenKind, userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await state.set(keyOf(kind, raw), { userId }, TTL_MS[kind]);
  return raw;
}

/** Uso único: devolve o usuário e já apaga o token. */
export async function consumeToken(state: StateService, kind: TokenKind, raw: string): Promise<string | null> {
  if (!raw || raw.length > 200) return null;
  const key = keyOf(kind, raw);
  const t = await state.get<{ userId: string }>(key);
  if (!t) return null;
  await state.del(key);
  return t.userId;
}
