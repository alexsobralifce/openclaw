// Catálogo de endereços de e-mail montado a partir do Gmail (lógica pura): quem escreveu ou recebeu e-mail seu.

import { Contact, oneLine } from "./contacts";

export interface Address {
  name?: string;
  email: string;
}
export interface SeenAddress extends Address {
  /** você escreveu para esse endereço (To/Cc de um e-mail enviado) */
  sent: boolean;
}

/** Lê um cabeçalho From/To/Cc: `"Nome" <a@b.com>, outro@x.com`. Vírgula dentro de aspas não separa. */
export function parseAddresses(header: string | undefined): Address[] {
  if (!header) return [];
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const out: Address[] = [];
  for (const p of parts) {
    const m = p.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/) ?? p.match(/^\s*()([^\s<>,"]+@[^\s<>,"]+)\s*$/);
    if (!m) continue;
    const email = m[2].trim().toLowerCase();
    const name = oneLine(m[1], 80);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push({ email, ...(name && name.toLowerCase() !== email ? { name } : {}) });
  }
  return out;
}

/** Endereços de sistema, lista e notificação: não são pessoas para guardar. */
const AUTOMATIC = /(^|[._+-])(no-?reply|do-?not-?reply|nao-?responda|mailer-daemon|postmaster|bounces?|notifications?|notificacoes|newsletter|news|alerts?|avisos?|marketing|promo(?:coes)?|suporte|support|atendimento|sac|faturamento|cobranca|contato-?automatico|updates?|info|mailer|robot|automated?)([._+-]|$)/i;
const AUTOMATIC_DOMAIN = /(^|\.)(mailchimp|sendgrid|amazonses|mailgun|sparkpost|hubspot|salesforce|zendesk|intercom|substack|mcsv|rsgsv|bounce|email\.|mail\.)/i;

export function isAutomatic(email: string): boolean {
  const [local, domain = ""] = email.split("@");
  return AUTOMATIC.test(local) || AUTOMATIC_DOMAIN.test(domain) || local.length > 40 || /\d{6,}/.test(local);
}

const pretty = (email: string) =>
  email
    .split("@")[0]
    .replace(/[._+-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export interface BookOptions {
  /** seus próprios endereços (nunca entram) */
  own?: string[];
  /** endereços que já estão nos contatos do Google (não repetir) */
  known?: Set<string>;
  max?: number;
}

/**
 * Junta os endereços vistos no Gmail em contatos de um só e-mail: guarda quem você escreveu, ou quem escreveu 2 vezes ou mais.
 * Fica de fora o que for seu, automático ou já estiver nos contatos. Mais frequentes primeiro, até `max`.
 */
export function buildBook(seen: SeenAddress[], opts: BookOptions = {}): Contact[] {
  const own = new Set((opts.own ?? []).map((e) => e.toLowerCase()));
  const agg = new Map<string, { count: number; sent: boolean; names: Map<string, number> }>();
  for (const s of seen) {
    const email = s.email.toLowerCase();
    if (own.has(email) || opts.known?.has(email) || isAutomatic(email)) continue;
    const a = agg.get(email) ?? { count: 0, sent: false, names: new Map() };
    a.count++;
    a.sent ||= s.sent;
    if (s.name) a.names.set(s.name, (a.names.get(s.name) ?? 0) + 1);
    agg.set(email, a);
  }
  return [...agg]
    .filter(([, a]) => a.sent || a.count >= 2)
    .sort(([, a], [, b]) => Number(b.sent) - Number(a.sent) || b.count - a.count)
    .slice(0, opts.max ?? 2000)
    .map(([email, a]) => {
      const best = [...a.names].sort((x, y) => y[1] - x[1])[0]?.[0];
      return { nome: oneLine(best || pretty(email) || email, 80), telefones: [], emails: [email] };
    });
}

/** "atualizar banco de e-mails", "atualizar catálogo de endereços". */
export function looksLikeEmailBookRefresh(flat: string): boolean {
  return /^(?:por favor )?(?:atualizar|atualiza|sincronizar|sincroniza|importar|importa|refazer|recarregar)\s+(?:o |os |a )?(?:(?:banco|catalogo|lista) de (?:enderecos|e-?mails?)|enderecos(?: de e-?mail)?)$/.test(flat);
}
