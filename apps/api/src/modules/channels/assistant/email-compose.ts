// Escrever um e-mail novo passo a passo (lógica pura): destinatário, assunto e texto, um de cada vez.

export const MAX_RECIPIENTS = 5;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 5_000;

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Endereços de e-mail citados no texto, em minúsculas, sem repetir. Só aceita o que parece mesmo um endereço (nada de quebra de linha ou vírgula no meio). */
export function extractAddresses(text: string): string[] {
  return [...new Set((text.match(ADDRESS) ?? []).map((a) => a.toLowerCase()))].slice(0, MAX_RECIPIENTS);
}

/** Assunto numa linha só, sem o "assunto:" que a pessoa possa ter dito antes. */
export function cleanSubject(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/^\s*assunto\s*[:\-–]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUBJECT);
}

/** Texto que a pessoa quer enviar exatamente como escreveu ("texto: ..."), ou null se for só uma instrução para eu redigir. */
export function verbatimBody(text: string): string | null {
  const m = text.match(/^\s*(?:texto|exato|exatamente|assim)\s*[:\-–]\s*([\s\S]+)$/i);
  return m ? m[1].trim().slice(0, MAX_BODY) : null;
}

export interface ComposeSeed {
  to: string[];
  subject?: string;
}

/**
 * "Enviar e-mail" abre o passo a passo. Também aceita já trazer o destinatário e o assunto:
 * "enviar e-mail para fulana@email.com assunto: fulano avisa que vai pagar hoje".
 * Qualquer outra coisa depois do comando (ex.: "mandar e-mail pro Marcos dizendo que vou atrasar") é um pedido livre: devolve null
 * para a IA tratar.
 */
export function composeSeed(text: string): ComposeSeed | null {
  const m = text.match(/^\s*(?:por favor[,\s]+)?(?:enviar|escrever|mandar|compor|criar|redigir|novo|nova)\s+(?:um\s+|uma\s+|o\s+|a\s+)?(?:novo\s+|nova\s+)?e-?mail\b([\s\S]*)$/i);
  if (!m) return null;
  const rest = m[1].trim().replace(/^[:,.\-–]\s*/, "");
  if (!rest) return { to: [] };

  const subject = rest.match(/(?:^|\s)assunto\s*[:\-–]?\s*([\s\S]+)$/i);
  const before = subject ? rest.slice(0, subject.index) : rest;
  const to = extractAddresses(before);
  // O que sobra antes do assunto deve ser só "para <endereços>": se houver mais, é um pedido livre
  const leftover = before.replace(ADDRESS, " ").replace(/\b(para|pra|p\/|a|ao|e|com|cc)\b/gi, " ").replace(/[\s,;:\-–]+/g, "");
  if (leftover) return null;
  if (!to.length && !subject) return null;
  const clean = subject ? cleanSubject(subject[1]) : "";
  return { to, ...(clean ? { subject: clean } : {}) };
}
