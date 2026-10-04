// Catálogo de documentos (PDFs) com tags (lógica pura): ficha, tags, busca e comandos de edição.
// O arquivo fica no Drive do dono (Assist.IA/Documentos); a ficha (título, assunto, tags, resumo) fica no Postgres (documents-store.ts).

import { extractJson } from "./agenda-events";
import { cleanTitle, cleanTopic } from "./notes";
import { normalize } from "./voice";

export const DOCS_FOLDER = "Documentos";
/** Tags por documento: poucas e boas valem mais que muitas. */
export const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;
const MAX_SUMMARY = 500;

export interface DocFields {
  title: string;
  topic: string;
  tags: string[];
  summary: string;
}

/** O que a busca e as telas precisam de um documento (a linha do banco tem mais campos). */
export interface DocLike extends DocFields {
  id: string;
  kind?: string;
  createdAt: Date | string;
}

/** Tag como é guardada: minúscula, sem acento, hífen no lugar de espaço ("Plano de Saúde" → "plano-de-saude"). */
export function cleanTag(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^#+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_LEN)
    .replace(/-+$/g, "");
}

/** Lista de tags limpa: sem vazias nem repetidas, no máximo `max`. Aceita texto ("contrato, aluguel e imóvel") ou lista. */
export function sanitizeTags(input: unknown, max = MAX_TAGS): string[] {
  const parts = Array.isArray(input) ? input.map(String) : String(input ?? "").split(/[,;\n]+|\s+e\s+|\s+#/i);
  const out: string[] = [];
  for (const p of parts) {
    const t = cleanTag(p);
    if (t.length >= 2 && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Lê a resposta da IA ({"titulo","assunto","tags","resumo","erro"}) e devolve a ficha pronta, ou o motivo de não haver. */
export function parseDocPlan(raw: string): { doc?: DocFields; error?: string } {
  const j = extractJson(raw);
  const summary = String(j?.resumo ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY);
  const title = String(j?.titulo ?? "").trim();
  if (!summary && !title) return { error: String(j?.erro ?? "não encontrei texto aproveitável") };
  return { doc: { title: cleanTitle(title, "Documento"), topic: cleanTopic(j?.assunto), tags: sanitizeTags(j?.tags), summary } };
}

// ─── Busca ────────────────────────────────────────────────────────

const FILLER = new Set(
  ("documento documentos pdf pdfs arquivo arquivos catalogo biblioteca meu meus minha minhas me mim a o as os um uma de do da dos das " +
    "com sobre tag tags que tem tenho qual quais mostra mostre mostrar ver busca busque buscar procura procure procurar acha ache quero " +
    "manda mande envia envie todos todas").split(" "),
);

/** Termos que importam na busca (sem "documentos", "com a tag", "me mostra"...). */
export function searchTerms(query: string): string[] {
  return normalize(query)
    .split(" ")
    .filter((w) => w.length >= 2 && !FILLER.has(w));
}

/**
 * Nota do documento para os termos: tag igual pesa 5, tag que começa com o termo 3, palavra do título ou do assunto 2, do resumo 1.
 * Todos os termos precisam bater em algum lugar; senão o documento não serve (0).
 */
export function docScore(d: DocFields, terms: string[]): number {
  if (!terms.length) return 1;
  const tags = d.tags.map(normalize);
  const title = normalize(d.title).split(" ");
  const topic = normalize(d.topic).split(" ");
  const summary = normalize(d.summary);
  let total = 0;
  for (const t of terms) {
    let s = 0;
    if (tags.some((g) => g === t || g.split("-").includes(t))) s = 5;
    else if (tags.some((g) => g.startsWith(t))) s = 3;
    else if (title.some((w) => w.startsWith(t)) || topic.some((w) => w.startsWith(t))) s = 2;
    else if (summary.includes(t)) s = 1;
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** Documentos que casam com a busca, os melhores primeiro e, no empate, o mais novo. Sem termos, devolve todos (mais novos primeiro). */
export function searchDocs<T extends DocLike>(docs: T[], query: string): T[] {
  const terms = searchTerms(query);
  const time = (d: T) => new Date(d.createdAt).getTime();
  return docs
    .map((d) => ({ d, s: docScore(d, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || time(b.d) - time(a.d))
    .map((x) => x.d);
}

/** As tags mais usadas, com a contagem. */
export function topTags(docs: { tags: string[] }[], max = 12): { tag: string; count: number }[] {
  const count = new Map<string, number>();
  for (const d of docs) for (const t of d.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, max);
}

// ─── Comandos ─────────────────────────────────────────────────────

const TAG_SEARCH = "(?:com a tag|com tag|com as tags|da tag|das tags|tag|tags|sobre|de|do|da|com)";

/** "documentos" / "meus pdfs" / "biblioteca": abre o catálogo. */
export function looksLikeDocsHome(flat: string): boolean {
  return /^(?:abrir |ver |mostrar |listar )?(?:os |meus |minha )?(?:documentos|pdfs|catalogo|biblioteca)(?: de documentos)?$/.test(flat);
}

/** "tags" / "minhas tags": mostra as tags e quantos documentos cada uma tem. */
export function looksLikeTagsList(flat: string): boolean {
  return /^(?:ver |mostrar |listar |quais sao )?(?:as |minhas )?tags(?: dos documentos)?$/.test(flat);
}

/** "documentos com a tag contrato", "pdfs sobre aluguel", "me mostra o documento do plano de saúde", "tag contrato": o que buscar, ou null. */
export function docQuery(flat: string): string | null {
  const m =
    flat.match(new RegExp(`^(?:por favor )?(?:me )?(?:(?:mostra\\w*|ver|busc\\w*|procur\\w*|ach\\w*|manda\\w*|envi\\w*|quero|tem)\\s+)?(?:os |meus |o |um |uns |algum )?(?:documentos?|pdfs?)\\s+${TAG_SEARCH}\\s+(.{2,60})$`)) ??
    flat.match(/^(?:ver |mostrar |buscar |procurar )?(?:a |as )?tags?\s+(.{2,40})$/);
  const q = m?.[1].replace(/\s+(por favor|pfv)$/, "").trim();
  return q && searchTerms(q).length ? q : null;
}

export interface TagEdit {
  mode: "set" | "add" | "remove";
  tags: string[];
  /** número do documento citado na frase ("tags do documento 2: ...") */
  n?: number;
}

/** Minúsculas e sem acento, mas COM a pontuação: `normalize` troca ":" e "," por espaço, e aqui eles separam as tags. */
const lite = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Editar tags por texto, para o documento aberto (ou citado pelo número). Recebe o texto ORIGINAL da mensagem:
 * "tags: contrato, aluguel" troca todas; "adicionar tag imóvel" acrescenta; "tirar tag antigo" remove.
 */
export function parseTagEdit(text: string): TagEdit | null {
  const t = lite(text);
  const doc = "(?:\\s+(?:do|no|ao|para o)\\s+documento\\s+(\\d{1,2}))?";
  let m = t.match(new RegExp(`^(?:tags?|etiquetas?)${doc}\\s*(?:[:=]|passam? a ser|sao|ficam?)\\s*(.+)$`));
  if (m) return finish("set", m[2], m[1]);
  m = t.match(new RegExp(`^(?:adicionar|acrescentar|incluir|add|por|colocar)\\s+(?:a |as )?tags?${doc}\\s*:?\\s*(.+)$`));
  if (m) return finish("add", m[2], m[1]);
  m = t.match(new RegExp(`^(?:tirar|remover|retirar|apagar|excluir)\\s+(?:a |as )?tags?${doc}\\s*:?\\s*(.+)$`));
  if (m) return finish("remove", m[2], m[1]);
  return null;
}

function finish(mode: TagEdit["mode"], rawTags: string, n?: string): TagEdit | null {
  const tags = sanitizeTags(rawTags);
  return tags.length ? { mode, tags, ...(n ? { n: Number(n) } : {}) } : null;
}

/** Aplica a edição às tags atuais (sempre limpas, sem repetir, no máximo MAX_TAGS). */
export function applyTagEdit(current: string[], edit: TagEdit): string[] {
  if (edit.mode === "set") return sanitizeTags(edit.tags);
  if (edit.mode === "add") return sanitizeTags([...current, ...edit.tags]);
  const drop = new Set(edit.tags);
  return current.filter((t) => !drop.has(t));
}

/** "#contrato #aluguel" (vazio se não há tags). */
export const tagsLine = (tags: string[]) => tags.map((t) => `#${t}`).join(" ");

/** Nome do arquivo guardado no Drive: "2026-10-04 Contrato de aluguel.pdf". */
export const docFileName = (day: string, title: string) => `${day} ${cleanTitle(title, "Documento")}.pdf`;
