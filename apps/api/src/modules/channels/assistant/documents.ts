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
export function parseDocPlan(raw: string, fallbackText = ""): { doc?: DocFields; error?: string } {
  const j = extractJson(raw);
  let summary = String(j?.resumo ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY);
  const title = String(j?.titulo ?? "").trim();
  if (!summary && !title) return { error: String(j?.erro ?? "não encontrei texto aproveitável") };
  // A IA não resumiu: sem resumo o documento ficaria difícil de achar na busca, então entra o começo do texto ou título + assunto
  if (!summary) summary = (fallbackText.replace(/\s+/g, " ").trim() || [title, String(j?.assunto ?? "")].filter(Boolean).join(" — ")).slice(0, 400);
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

// ─── Categorias ───────────────────────────────────────────────────
// A categoria é o campo `topic` da ficha ("assunto" no banco): uma por documento, criada pelo dono ou sugerida pela IA.

export interface Category {
  name: string;
  count: number;
}

/** Categorias com a contagem, as maiores primeiro. "saúde" e "Saude" são a mesma; vale o nome mais usado. */
export function topCategories(docs: { topic: string }[]): Category[] {
  const groups = new Map<string, Map<string, number>>();
  for (const d of docs) {
    const name = d.topic.trim();
    if (!name) continue;
    const k = normalize(name);
    const names = groups.get(k) ?? new Map<string, number>();
    names.set(name, (names.get(name) ?? 0) + 1);
    groups.set(k, names);
  }
  return [...groups.values()]
    .map((names) => ({ name: [...names.entries()].sort((a, b) => b[1] - a[1] || Number(normalize(a[0]) === a[0]) - Number(normalize(b[0]) === b[0]))[0][0], count: [...names.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Documentos de uma categoria (nome sem diferenciar maiúscula nem acento), do mais novo ao mais antigo. */
export function docsInCategory<T extends DocLike & { topic: string }>(docs: T[], name: string): T[] {
  const k = normalize(name);
  return docs.filter((d) => normalize(d.topic) === k).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** A categoria que o texto cita: pelo nome inteiro ("saúde") ou pelo começo ("fin" → Finanças, só se for uma). */
export function matchCategory(cats: Category[], text: string): Category | null {
  const k = normalize(text);
  if (!k) return null;
  const exact = cats.find((c) => normalize(c.name) === k);
  if (exact) return exact;
  const near = cats.filter((c) => normalize(c.name).startsWith(k));
  return near.length === 1 ? near[0] : null;
}

/** Nome de categoria como é guardado: até 40 letras, primeira maiúscula ("saúde  e bem-estar" → "Saúde e bem-estar"). */
export function cleanCategory(raw: unknown): string {
  const t = String(raw ?? "").replace(/[#*_`~\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Onde ficam os documentos de uma categoria apagada (apagar a categoria nunca apaga o documento). */
export const NO_CATEGORY = "Sem categoria";

export const categoryKey = (name: string) => normalize(name);
export const categoriesStateKey = (ws: string) => `doccats:${ws}`;
/** Teto de categorias criadas à mão (as dos documentos não contam). */
export const MAX_CUSTOM_CATEGORIES = 50;

/** Junta as categorias dos documentos com as criadas à mão, que podem estar vazias (contagem 0). */
export function mergeCategories(fromDocs: Category[], custom: string[]): Category[] {
  const out = [...fromDocs];
  const seen = new Set(out.map((c) => categoryKey(c.name)));
  for (const name of custom) {
    const k = categoryKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ name, count: 0 });
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "criar categoria Saúde", "nova categoria: Saúde", "adicionar categoria Viagens". Recebe o texto ORIGINAL (guarda acento e maiúscula). */
export function parseCategoryCreate(text: string): string | null {
  const m = text.trim().match(/^(?:por favor\s+)?(?:criar|crie|nova|novo|adicionar|adicione|cadastrar|cadastre)\s+(?:uma\s+)?(?:nova\s+)?categoria(?:\s+(?:chamada|com o nome|de nome))?\s*[:=-]?\s*(.{2,40})$/i);
  const name = cleanCategory(m?.[1]);
  return name.length >= 2 ? name : null;
}

/** "apagar categoria Saúde", "excluir a categoria: Viagens". Recebe o texto já normalizado (sem acento). Devolve o nome citado, ou null. */
export function parseCategoryDelete(flat: string): string | null {
  const m = flat.match(/^(?:por favor )?(?:apagar|apague|excluir|exclua|remover|remova|deletar|delete)\s+(?:a\s+)?categoria\s*[:=]?\s*(?:de |da |do )?(.{2,40})$/);
  const q = m?.[1].replace(/\s+(por favor|pfv)$/, "").trim();
  return q || null;
}

/** "categorias" / "minhas categorias": mostra as categorias com a contagem. */
export function looksLikeCategoriesList(flat: string): boolean {
  return /^(?:ver |mostrar |listar |quais sao )?(?:as |minhas )?categorias(?: dos documentos)?$/.test(flat);
}

/** "categoria saúde", "documentos da categoria finanças", "pdfs de saúde" não (isso é busca): só o que cita "categoria". Devolve o nome citado, ou null. */
export function categoryQuery(flat: string): string | null {
  const m = flat.match(/^(?:por favor )?(?:(?:me )?(?:mostra\w*|ver|abr\w*|list\w*|busc\w*|quero)\s+)?(?:(?:os |meus )?(?:documentos|pdfs)\s+)?(?:da |de |na )?categoria\s+(?:de |da |do )?(.{2,40})$/);
  const q = m?.[1].replace(/\s+(por favor|pfv)$/, "").trim();
  return q || null;
}

/**
 * Mudar a categoria por texto, do documento aberto (ou citado pelo número). Recebe o texto ORIGINAL (para guardar acento e maiúscula):
 * "categoria: Saúde", "categoria do documento 2: Finanças", "mudar categoria para Trabalho".
 */
export function parseCategoryEdit(text: string): { name: string; n?: number } | null {
  const doc = "(?:\\s+(?:do|no|ao|para o)\\s+documento\\s+(\\d{1,2}))?";
  const t = text.trim();
  const m =
    t.match(new RegExp(`^(?:categoria|categ)${doc}\\s*(?:[:=]|\\bpassa a ser\\b|\\bfica\\b)\\s*(.+)$`, "i")) ??
    t.match(new RegExp(`^(?:mudar|trocar|alterar|colocar|por|pôr)\\s+(?:a\\s+)?categoria${doc}\\s*(?:(?:para|pra)\\s+|[:=]\\s*)(.+)$`, "i"));
  const name = cleanCategory(m?.[2]);
  return m && name.length >= 2 ? { name, ...(m[1] ? { n: Number(m[1]) } : {}) } : null;
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

/** "reclassificar notas", "catalogar meus pdfs antigos", "continuar reclassificação": passa pelas notas que vieram de arquivo e cria as fichas com tags. */
export function looksLikeReclassify(flat: string): boolean {
  return (
    /^(?:por favor )?(?:reclassificar|reclassifica|catalogar|cataloga)\s+(?:as |minhas |meus |os |todas as |todos os )?(?:notas|documentos|pdfs)(?: antig\w+| de pdf| de pdfs| de arquivo| de arquivos| com tags)*$/.test(flat) ||
    /^(?:continuar|continua|seguir) (?:a )?(?:reclassificacao|catalogacao)$/.test(flat)
  );
}

/** A nota veio de um PDF ou foto? (`renderNote` grava "origem: arquivo" nas propriedades do topo). */
export const isFileOriginNote = (content: string) => /^---\r?\n[\s\S]*?\borigem:\s*arquivo\b[\s\S]*?\r?\n---/.test(content);

/** Quantas notas por rodada (cada uma custa uma chamada de IA) e quantas no máximo se abrem para checar a origem. */
export const RECLASSIFY_BATCH = 5;
export const RECLASSIFY_MAX_READS = 25;

export interface TagEdit {
  mode: "set" | "add" | "remove";
  tags: string[];
  /** número do documento citado na frase ("tags do documento 2: ...") */
  n?: number;
}

/**
 * Editar tags por texto, para o documento aberto (ou citado pelo número):
 * "tags: contrato, aluguel" troca todas; "adicionar tag imóvel" acrescenta; "tirar tag antigo" remove.
 */
export function parseTagEdit(flat: string): TagEdit | null {
  const doc = "(?:\\s+(?:do|no|ao|para o)\\s+documento\\s+(\\d{1,2}))?";
  let m = flat.match(new RegExp(`^(?:tags?|etiquetas?)${doc}\\s*(?:[:=]|passam? a ser|sao|ficam?)\\s*(.+)$`));
  if (m) return finish("set", m[2], m[1]);
  m = flat.match(new RegExp(`^(?:adicionar|acrescentar|incluir|add|por|colocar)\\s+(?:a |as )?tags?${doc}\\s*:?\\s*(.+)$`));
  if (m) return finish("add", m[2], m[1]);
  m = flat.match(new RegExp(`^(?:tirar|remover|retirar|apagar|excluir)\\s+(?:a |as )?tags?${doc}\\s*:?\\s*(.+)$`));
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
// ajuste de teste
// x
