import { randomBytes } from "crypto";

let ephemeral: string | null = null;

/**
 * Segredo do JWT. Em produção o boot já exige `JWT_SECRET`; fora dela, sem a variável, usa um segredo aleatório
 * só deste processo (as sessões caem a cada reinício) em vez de um valor fixo que qualquer um conhece.
 */
export function jwtSecret(value: string | undefined = process.env.JWT_SECRET): string {
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET ausente em produção");
  return (ephemeral ??= randomBytes(32).toString("hex"));
}
