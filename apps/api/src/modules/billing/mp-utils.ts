import { createHmac, timingSafeEqual } from "crypto";

/** Dias que cada pagamento aprovado soma ao vencimento (um mês com folga de 1 dia). */
export const PERIOD_DAYS = 31;

/**
 * Confere a assinatura do aviso do Mercado Pago (cabeçalho `x-signature: ts=...,v1=...`).
 * O texto assinado é `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` e a chave é a assinatura secreta do webhook.
 */
export function verifyMpSignature(opts: { secret: string; signature?: string; requestId?: string; dataId?: string }): boolean {
  const { secret, signature, requestId, dataId } = opts;
  if (!secret || !signature || !dataId) return false;
  const parts = Object.fromEntries(signature.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};${requestId ? `request-id:${requestId};` : ""}ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `external_reference` que mandamos ao Mercado Pago: `<userId>:<planId>`. */
export const makeReference = (userId: string, planId: string) => `${userId}:${planId}`;
export function parseReference(ref?: string | null): { userId: string; planId: string } | null {
  const i = (ref ?? "").lastIndexOf(":");
  if (i <= 0) return null;
  return { userId: ref!.slice(0, i), planId: ref!.slice(i + 1) };
}

/** Novo vencimento: soma o período a partir do que ainda resta (renovar antes do fim não perde dias). */
export function nextPlanUntil(current: Date | null | undefined, now = new Date()): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + PERIOD_DAYS * 24 * 3600 * 1000);
}
