
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
export function parseNotePlan(raw: string, extract: (s: string) => any): { note?: NoteDraft; error?: string } {
  let j: any;
  try {
    j = extract(raw);
  } catch {
    return { error: "não entendi a resposta da leitura" };
  }
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
