// Notas em Markdown no Drive (lógica pura): ditar uma anotação, achar o que foi anotado.
// A gravação fica numa nota por dia (AAAA-MM-DD.md) dentro da pasta "Assist.IA"; o Obsidian é só um leitor opcional.

import { normalize } from "./voice";

export const NOTES_FOLDER = "Assist.IA";
const MAX_NOTE = 1_000;

/** Palavra que deixa claro que é uma nota (e não um compromisso: "anota consulta dia 10" continua sendo agenda). */
const PLACE = "obsidian|di[aá]rio|caderno|notas?";
const VERB = "anot\\w*|salv\\w*|guard\\w*|registr\\w*|escrev\\w*|adicion\\w*|poe|pon\\w*|coloc\\w*";

/**
 * O texto pede para guardar uma nota? Só vale com palavra explícita ("anota no obsidian: ...", "salva no diário ...", "nota: ...").
 * O "anota ..." solto fica para o Jev decidir, porque pode ser compromisso de agenda.
 * `flat` = texto já normalizado (minúsculas, sem acentos nem pontuação).
 */
export function looksLikeNoteAdd(flat: string): boolean {
  if (looksLikeNoteSearch(flat)) return false;
  if (/^nota\s+\S/.test(flat)) return true;
  return new RegExp(`^(por favor )?(${VERB})\\b.*\\b(no|na|em|pro|para o|para a)\\s+(meu |minha )?(${PLACE})\\b`).test(flat);
}

/**
 * A mensagem começa como um pedido de anotar ("anota ligar pro Marcos"), mas sem palavra que prove que é nota.
 * Só serve para decidir se vale perguntar ao Jev (nota ou compromisso de agenda?); sozinho não grava nada.
 */
export function startsLikeNote(flat: string): boolean {
  return /^(por favor )?(anot\w*|salv\w*|guard\w*|registr\w*)\b/.test(flat);
}

/** O texto pergunta o que foi anotado? ("o que anotei sobre o contrato", "buscar nas minhas notas ...", "procura no obsidian ..."). */
export function looksLikeNoteSearch(flat: string): boolean {
  if (/\b(o que|oque|quais|qual|tem algo|tenho algo)\b.*\b(anotei|anotado|salvei|guardei|escrevi|registrei)\b/.test(flat)) return true;
  return new RegExp(`^(por favor )?(busc\\w*|procur\\w*|ach\\w*|ver|mostr\\w*|le|ler|consult\\w*)\\b.*\\b(no|na|nas|nos|em)\\s+(meu |minha |meus |minhas )?(${PLACE})\\b`).test(flat);
}

/** Tira o pedido ("anota no obsidian:") e deixa só o conteúdo da nota, como foi ditado. */
export function noteTextFrom(text: string): string {
  let t = text.trim();
  t = t.replace(/^(por favor|pfv)[,\s]+/i, "");
  // "nota: ideia de tela" / "nota ideia de tela"
  const bare = t.match(/^nota\s*[:,\-–]?\s*(.+)$/is);
  if (bare) t = bare[1];
  else {
    t = t.replace(
      new RegExp(`^(?:${VERB.replace(/\\w\*/g, "[a-zà-ú]*")})\\s+(?:isso\\s+|aí\\s+|ai\\s+)?(?:(?:n[oa]|em|pro|para\\s+o|para\\s+a)\\s+)?(?:(?:meu|minha)\\s+)?(?:${PLACE})\\s*[:,\\-–]?\\s*(?:que\\s+)?`, "i"),
      "",
    );
    // "anota isso: ..." sem lugar, quando o lugar vem no fim ("... no obsidian")
    t = t.replace(/^(?:anot[a-zà-ú]*|salv[a-zà-ú]*|guard[a-zà-ú]*|registr[a-zà-ú]*)\s+(?:isso\s+)?[:,\-–]?\s*(?:que\s+)?/i, "");
    t = t.replace(/[\s,]+(?:n[oa]|em|pro|para\s+o)\s+(?:meu\s+|minha\s+)?(?:obsidian|diário|diario|caderno)\s*[.!]?$/i, "");
  }
  return t.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
}

/** Palavras que não ajudam a achar uma nota. */
const NOISE = new Set(
  ("o que a as os um uma de do da dos das no na nos nas em sobre para pra por favor eu meu minha meus minhas " +
    "anotei anotado anotada salvei guardei escrevi registrei quais qual tem algo tenho buscar busque busca procurar procure procura achar ache " +
    "ver mostrar mostre ler le consultar obsidian diario caderno nota notas").split(" "),
);

/** Palavras para procurar nas notas, a partir da pergunta ("o que anotei sobre o contrato do Marcos" → contrato, marcos). */
export function noteTerms(text: string): string[] {
  const words = normalize(text).split(" ").filter((w) => w.length >= 3 && !NOISE.has(w));
  return [...new Set(words)].slice(0, 6);
}

/** Data AAAA-MM-DD no fuso informado (o dia da nota não pode virar às 21h por causa do UTC). */
export function dayStamp(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export const dailyFileName = (at: Date, timeZone: string) => `${dayStamp(at, timeZone)}.md`;

/** Uma linha de lista do Markdown com a hora: "- 14:32 ligar pro Marcos". Quebras de linha viram espaço para manter uma linha só. */
export function formatEntry(at: Date, text: string, timeZone: string): string {
  const hhmm = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return `- ${hhmm} ${text.replace(/\s+/g, " ").trim()}`;
}

/** Acrescenta a linha ao conteúdo da nota do dia; a nota nova começa com o título da data. */
export function appendEntry(content: string, entry: string, day: string): string {
  const body = content.replace(/\s+$/, "");
  return body ? `${body}\n${entry}\n` : `# ${day}\n\n${entry}\n`;
}

/** Linhas da nota que citam alguma das palavras (sem acento nem maiúsculas), até `max`, cortadas em `width`. */
export function snippets(content: string, terms: string[], max = 3, width = 140): string[] {
  if (!terms.length) return [];
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const flat = normalize(clean);
    if (!terms.some((t) => flat.includes(t))) continue;
    out.push(clean.length > width ? `${clean.slice(0, width - 1)}…` : clean);
    if (out.length >= max) break;
  }
  return out;
}
