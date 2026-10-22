// Segredo dos tokens de sessão. Fica num módulo só para que a API, o Passport e cada módulo
// que assina token usem exatamente a mesma regra — segredo diferente entre eles derruba o login.

const MIN_LENGTH = 24;
/** Só para desenvolvimento local; em produção a API não sobe sem JWT_SECRET. */
const DEV_FALLBACK = "openclaw-dev-secret-nao-usar-em-producao";

/**
 * Devolve o segredo do JWT. Em produção, exige JWT_SECRET com pelo menos 24 caracteres:
 * segredo curto ou ausente derruba o boot de propósito, em vez de assinar token fraco.
 */
export function jwtSecret(raw?: string | null): string {
  const secret = (raw ?? process.env.JWT_SECRET ?? "").trim();
  const production = process.env.NODE_ENV === "production";

  if (!secret) {
    if (production) throw new Error("JWT_SECRET não está definido. Defina um segredo com 24+ caracteres antes de subir a API.");
    return DEV_FALLBACK;
  }
  if (production && secret.length < MIN_LENGTH) {
    throw new Error(`JWT_SECRET tem ${secret.length} caracteres; use ao menos ${MIN_LENGTH}.`);
  }
  return secret;
}
