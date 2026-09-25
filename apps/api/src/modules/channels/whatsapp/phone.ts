/** Só os dígitos de um telefone. */
export const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

/**
 * Formas equivalentes de um celular brasileiro: o WhatsApp pode entregar o número
 * com ou sem o nono dígito (55 + DDD + 9 + 8 dígitos).
 */
export function phoneVariants(raw?: string | null): string[] {
  const n = digits(raw);
  if (!n) return [];
  const out = new Set([n]);
  const withNinth = /^(55\d{2})(\d{8})$/.exec(n);
  if (withNinth) out.add(`${withNinth[1]}9${withNinth[2]}`);
  const withoutNinth = /^(55\d{2})9(\d{8})$/.exec(n);
  if (withoutNinth) out.add(`${withoutNinth[1]}${withoutNinth[2]}`);
  return [...out];
}

export function samePhone(a?: string | null, b?: string | null) {
  const va = phoneVariants(a);
  return va.length > 0 && phoneVariants(b).some((v) => va.includes(v));
}

/** Número de um JID pessoal ("5585...@s.whatsapp.net"); nulo para grupos, listas e LIDs. */
export function phoneFromJid(jid?: string | null): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  return digits(jid.split("@")[0]) || null;
}

/**
 * Telefone do remetente de uma mensagem do Evolution. Com a migração do WhatsApp para LIDs
 * ("123@lid"), o número real pode vir em remoteJidAlt ou senderPn.
 */
export function senderPhone(key: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string } | undefined): string | null {
  if (!key) return null;
  return phoneFromJid(key.remoteJid) ?? phoneFromJid(key.remoteJidAlt) ?? phoneFromJid(key.senderPn);
}

export function isGroupOrBroadcast(jid?: string | null) {
  return !!jid && (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter"));
}
