// Notas em Markdown no Drive (lógica pura): ditar uma anotação, achar o que foi anotado.
// A gravação fica numa nota por dia (AAAA-MM-DD.md) dentro da pasta "Assist.IA"; o Obsidian é só um leitor opcional.

import { extractJson } from "./agenda-events";
import { normalize } from "./voice";

export const NOTES_FOLDER = "Assist.IA";

/**
 * Conta Google cujo Drive guarda as notas e os contatos: a pessoal (@gmail.com); sem ela, a primeira conectada.
 * Os contatos de todas as contas são lidos, mas gravados só neste Drive.
 */
export function storageAccount(accounts: string[]): string | undefined {
  return accounts.find((a) => /@gmail\.com$/i.test(a)) ?? accounts[0];
}
const MAX_NOTE = 1_000;

/** Palavra que deixa claro que é uma nota (e não um compromisso: "anota consulta dia 10" continua sendo agenda). */
const PLACE = "obsidian|di[aá]rio|caderno|notas?";
const VERB = "anot\\w*|salv\\w*|guard\\w*|registr\\w*|escrev\\w*|adicion\\w*|poe|pon\\w*|coloc\\w*|cri\\w*|faz\\w*";
/** Enfeites antes do verbo ("quero anotar", "pode anotar", "ei, anota", "por favor"): no texto normalizado e no original. */
const LEAD_FLAT = "(?:(?:por favor|pfv|ei|oi|ola|pode|poderia|podia|quero|queria|gostaria de|voce|tu|que|me|vamos|ja)\\s+)*";
const LEAD_RAW = "(?:(?:por favor|pfv|ei|oi|ol[aá]|pode|poderia|podia|quero|queria|gostaria de|voc[eê]|tu|que|me|vamos|j[aá])[,\\s]+)*";

/**
 * O texto pede para guardar uma nota? Só vale com palavra explícita ("anota no obsidian: ...", "salva no diário ...", "nota: ...").
 * O "anota ..." solto fica para o Jev decidir, porque pode ser compromisso de agenda.
 * `flat` = texto já normalizado (minúsculas, sem acentos nem pontuação).
 */
export function looksLikeNoteAdd(flat: string): boolean {
  if (looksLikeNoteSearch(flat)) return false;
  if (/^nota\s+\S/.test(flat) || /^obsidian\s+\S/.test(flat)) return true;
  return new RegExp(`^${LEAD_FLAT}(${VERB})\\b.*\\b(no|na|em|pro|para o|para a)\\s+(meu |minha )?(${PLACE})\\b`).test(flat);
}

/**
 * A mensagem começa como um pedido de anotar ("anota ligar pro Marcos"), mas sem palavra que prove que é nota.
 * Só serve para decidir se vale perguntar ao Jev (nota ou compromisso de agenda?); sozinho não grava nada.
 */
export function startsLikeNote(flat: string): boolean {
  return new RegExp(`^${LEAD_FLAT}(anot\\w*|salv\\w*|guard\\w*|registr\\w*)\\b`).test(flat);
}

/** O texto pergunta o que foi anotado? ("o que anotei sobre o contrato", "buscar nas minhas notas ...", "procura no obsidian ..."). */
export function looksLikeNoteSearch(flat: string): boolean {
  if (/\b(o que|oque|quais|qual|tem algo|tenho algo)\b.*\b(anotei|anotado|salvei|guardei|escrevi|registrei)\b/.test(flat)) return true;
  return new RegExp(`^${LEAD_FLAT}(busc\\w*|procur\\w*|ach\\w*|ver|mostr\\w*|le|ler|consult\\w*)\\b.*\\b(no|na|nas|nos|em)\\s+(meu |minha |meus |minhas )?(${PLACE})\\b`).test(flat);
}

/** Tira o pedido ("anota no obsidian:", "quero anotar no obsidian que ...") e deixa só o conteúdo da nota, como foi ditado. */
export function noteTextFrom(text: string): string {
  let t = text.trim().replace(new RegExp(`^${LEAD_RAW}`, "i"), "");
  // "nota: ideia de tela" / "nota ideia de tela" / "obsidian: ideia de tela"
  const bare = t.match(/^(?:nota|obsidian)\s*[:,\-–]?\s*(.+)$/is);
  if (bare) t = bare[1];
  else {
    const place = `(?:(?:n[oa]|em|pro|para\\s+o|para\\s+a)\\s+)?(?:(?:meu|minha)\\s+)?(?:${PLACE})`;
    t = t.replace(
      new RegExp(`^(?:${VERB.replace(/\\w\*/g, "[a-zà-ú]*")})\\s+(?:isso\\s+|aí\\s+|ai\\s+)?(?:uma?\\s+)?${place}(?:\\s+${place})?\\s*[:,\\-–]?\\s*(?:que\\s+)?`, "i"),
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

// ─── Notas por assunto: Assist.IA/Notas/<Assunto>/<AAAA-MM-DD título>.md ─────────────

export const TOPICS_FOLDER = "Notas";
export const DEFAULT_TOPIC = "Geral";
const MAX_TOPIC = 40;
const MAX_TITLE = 80;
export const MAX_NOTE_BODY = 20_000;

/** Assunto como nome de pasta: sem barras nem aspas, uma linha, primeira letra maiúscula; vazio vira "Geral". */
export function cleanTopic(raw: unknown): string {
  const t = String(raw ?? "").replace(/[\\/'"`<>|*?:\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC).trim();
  return t ? t[0].toUpperCase() + t.slice(1) : DEFAULT_TOPIC;
}

/** Título curto e seguro para nome de arquivo. */
export function cleanTitle(raw: unknown, fallback = "Nota"): string {
  const t = String(raw ?? "").replace(/[\\/'"`<>|*?:\n\r#]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
  return t || fallback;
}

export const noteFileName = (day: string, title: string) => `${day} ${cleanTitle(title)}.md`;

export interface NoteDraft {
  title: string;
  topic: string;
  content: string;
}

/** Arquivo Markdown da nota (com propriedades no topo, que o Obsidian lê). */
export function renderNote(n: NoteDraft, day: string, origin: string): string {
  const tag = normalize(n.topic).replace(/\s+/g, "-");
  return `---\nassunto: ${n.topic}\ncriada: ${day}\norigem: ${origin}\ntags: [${tag}]\n---\n# ${n.title}\n\n${n.content.trim()}\n`;
}

/** Lê a resposta da IA ({"titulo","assunto","conteudo","erro"}) e devolve a nota pronta, ou o motivo de não haver. */
export function parseNotePlan(raw: string): { note?: NoteDraft; error?: string } {
  const j = extractJson(raw);
  const content = String(j?.conteudo ?? "").trim().slice(0, MAX_NOTE_BODY);
  if (!content) return { error: String(j?.erro ?? "não encontrei texto aproveitável") };
  return { note: { title: cleanTitle(j?.titulo), topic: cleanTopic(j?.assunto), content } };
}

/** "nota sobre Contrato: o prazo vence dia 10" → assunto e texto (só com os dois pontos/traço, para não confundir com busca). */
export function noteWithTopic(text: string): { topic: string; content: string } | null {
  const m = text
    .trim()
    .replace(new RegExp(`^${LEAD_RAW}`, "i"), "")
    .match(/^(?:(?:criar|nova|fazer|salvar|anotar)\s+)?(?:uma\s+)?nota\s+(?:de|do|da|sobre|em|no assunto|para)\s+([^:\-–\n]{2,40}?)\s*[:\-–]\s*(.{2,})$/is);
  if (!m) return null;
  return { topic: cleanTopic(m[1]), content: m[2].replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_BODY) };
}

/** A legenda do arquivo pede nota? ("nota", "anotar", "salvar como nota", "resumir"). */
export function looksLikeNoteCaption(flat: string): boolean {
  return /\b(nota|notas|anota\w*|obsidian|resum\w*)\b/.test(flat);
}

/** "notas", "minhas notas", "ver notas", "assuntos": abre a tela de notas. */
export function looksLikeNotesHome(flat: string): boolean {
  return /^(ver |abrir |mostrar |listar )?(as |minhas |meus )?(notas|assuntos( das notas)?)$/.test(flat);
}

/** "notas de contrato", "notas sobre reunião": o assunto pedido. */
export function topicRequest(flat: string): string | null {
  const m = flat.match(/^(?:ver |abrir |mostrar |listar )?(?:as |minhas )?notas (?:de |do |da |sobre )(.{2,40})$/);
  return m ? m[1].trim() : null;
}

/** Acha o assunto pelo número ou pelo nome (sem acento, parte do nome). */
export function pickTopic<T extends { name: string }>(topics: T[], wanted: string): T | undefined {
  const w = normalize(wanted);
  if (!w) return undefined;
  return topics.find((t) => normalize(t.name) === w) ?? topics.find((t) => normalize(t.name).includes(w) || w.includes(normalize(t.name)));
}
