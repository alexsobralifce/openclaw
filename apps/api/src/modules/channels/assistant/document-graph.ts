// Grafo de documentos (lógica pura): liga cada documento a categoria, tags e termos, e acha os relevantes
// por propagação de pesos. Não importa Prisma, Google nem fetch. Não guarda o resumo: só os termos extraídos dele.

import { DocLike, NO_CATEGORY, searchTerms } from "./documents";
import { normalize } from "./voice";

type NodeKind = "doc" | "cat" | "tag" | "term";
interface GraphNode {
  kind: NodeKind;
  label: string;
}
interface Edge {
  to: string;
  w: number;
}

/** O que a busca precisa de um documento, sem o resumo inteiro. */
interface DocRecord {
  id: string;
  time: number;
  topic: string;
  topicWords: string[];
  titleWords: string[];
  tags: string[];
  terms: string[];
}

export interface DocGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, Edge[]>;
  docs: Map<string, DocRecord>;
}

export interface GraphHit {
  id: string;
  score: number;
  reasons: string[];
}

export interface SearchOptions {
  maxHops?: number;
  decay?: number;
  limit?: number;
}

const W_CAT = 1.0;
const W_TAG = 0.8;
const W_TERM = 0.4;
const TAG_NEIGHBORS = 5;
const MAX_TERMS_PER_DOC = 12;
const MAX_EDGES_PER_QUERY = 2000;
const MAX_REASONS = 3;

const STOPWORDS = new Set(
  (
    "para com uma uns umas que por sobre como mais mas nos nas nem ser sao sua seu seus suas este esta " +
    "esse essa esses essas isso isto aquele aquela entre quando muito tambem pelo pela pelos pelas " +
    "dos das del ele ela eles elas foi era sem ate and the"
  ).split(" "),
);

/** Palavras de um texto, sem acento, com 3 letras ou mais. */
function words(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** Até 12 termos do título e do resumo, sem palavras vazias e sem repetir. */
function docTerms(title: string, summary: string): string[] {
  const out: string[] = [];
  for (const w of [...words(title), ...words(summary)]) {
    if (STOPWORDS.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= MAX_TERMS_PER_DOC) break;
  }
  return out;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function addNode(g: DocGraph, kind: NodeKind, key: string, label: string): string {
  const id = `${kind}:${key}`;
  if (!g.nodes.has(id)) g.nodes.set(id, { kind, label });
  return id;
}

function link(g: DocGraph, a: string, b: string, w: number): void {
  g.edges.set(a, [...(g.edges.get(a) ?? []), { to: b, w }]);
  g.edges.set(b, [...(g.edges.get(b) ?? []), { to: a, w }]);
}

function addDoc(g: DocGraph, d: DocLike): void {
  const topic = d.topic.trim() === NO_CATEGORY ? "" : d.topic.trim();
  const tags = [...new Set(d.tags)];
  const rec: DocRecord = {
    id: d.id,
    time: new Date(d.createdAt).getTime(),
    topic,
    topicWords: words(topic),
    titleWords: words(d.title),
    tags,
    terms: docTerms(d.title, d.summary),
  };
  g.docs.set(d.id, rec);
  const docNode = addNode(g, "doc", d.id, d.id);
  if (topic) link(g, docNode, addNode(g, "cat", normalize(topic), topic), W_CAT);
  for (const t of tags) link(g, docNode, addNode(g, "tag", t, t), W_TAG);
  for (const t of rec.terms) link(g, docNode, addNode(g, "term", t, t), W_TERM);
}

/** Liga tags que aparecem juntas: peso co/√(nA·nB), mantendo as 5 vizinhas mais fortes de cada tag. */
function linkTagNeighbors(g: DocGraph): void {
  const count = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const rec of g.docs.values()) {
    for (const t of rec.tags) count.set(t, (count.get(t) ?? 0) + 1);
    for (let i = 0; i < rec.tags.length; i++) {
      for (let j = i + 1; j < rec.tags.length; j++) {
        const k = pairKey(rec.tags[i], rec.tags[j]);
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
    }
  }
  const weight = new Map<string, number>();
  const best = new Map<string, { to: string; w: number }[]>();
  for (const [k, co] of pairs) {
    const [a, b] = k.split("\u0000");
    const w = co / Math.sqrt((count.get(a) ?? 1) * (count.get(b) ?? 1));
    weight.set(k, w);
    best.set(a, [...(best.get(a) ?? []), { to: b, w }]);
    best.set(b, [...(best.get(b) ?? []), { to: a, w }]);
  }
  const keep = new Set<string>();
  for (const [tag, list] of best) {
    list.sort((x, y) => y.w - x.w || x.to.localeCompare(y.to));
    for (const n of list.slice(0, TAG_NEIGHBORS)) keep.add(pairKey(tag, n.to));
  }
  for (const k of keep) {
    const [a, b] = k.split("\u0000");
    link(g, `tag:${a}`, `tag:${b}`, weight.get(k) ?? 0);
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Monta o grafo. Entrada ordenada por id antes, para que a mesma coleção dê o mesmo grafo em qualquer ordem. */
export function buildDocGraph(docs: DocLike[]): DocGraph {
  const g: DocGraph = { nodes: new Map(), edges: new Map(), docs: new Map() };
  const ordered = [...docs].sort((a, b) => a.id.localeCompare(b.id));
  for (const d of ordered) addDoc(g, d);
  linkTagNeighbors(g);
  return g;
}

/** Pontuação direta: todos os termos precisam casar; tag 5, tag por prefixo 3, categoria/título 2, resumo 1. */
function directMatch(rec: DocRecord, terms: string[]): { score: number; reasons: string[] } {
  const reasons = new Set<string>();
  let total = 0;
  for (const t of terms) {
    const hit = matchOne(rec, t);
    if (!hit) return { score: 0, reasons: [] };
    total += hit.pts;
    reasons.add(hit.reason);
  }
  return { score: total / (5 * terms.length), reasons: [...reasons] };
}

function matchOne(rec: DocRecord, t: string): { pts: number; reason: string } | null {
  const exactTag = rec.tags.find((g) => g === t || g.split("-").includes(t));
  if (exactTag) return { pts: 5, reason: `tag ${exactTag}` };
  const prefixTag = rec.tags.find((g) => g.startsWith(t));
  if (prefixTag) return { pts: 3, reason: `tag ${prefixTag}` };
  if (rec.topicWords.some((w) => w.startsWith(t))) return { pts: 2, reason: `categoria ${rec.topic}` };
  if (rec.titleWords.some((w) => w.startsWith(t))) return { pts: 2, reason: "título" };
  if (rec.terms.some((w) => w.startsWith(t))) return { pts: 1, reason: "resumo" };
  return null;
}

interface Active {
  act: number;
  origin: string;
  seed: boolean;
  kind: NodeKind;
  label: string;
}

/** Nós (não documentos) cujo rótulo casa com a busca: exato 1,0; prefixo 0,6. */
function seedNodes(g: DocGraph, terms: string[]): Map<string, Active> {
  const out = new Map<string, Active>();
  for (const [id, node] of g.nodes) {
    if (node.kind === "doc") continue;
    const ws =
      node.kind === "tag" ? [node.label, ...node.label.split("-")] : node.kind === "cat" ? normalize(node.label).split(" ") : [node.label];
    let act = 0;
    for (const t of terms) {
      if (ws.includes(t)) act = Math.max(act, 1);
      else if (ws.some((w) => w.startsWith(t))) act = Math.max(act, 0.6);
    }
    if (act > 0) out.set(id, { act, origin: node.label, seed: true, kind: node.kind, label: node.label });
  }
  return out;
}

function reasonOf(st: Active): string {
  if (!st.seed) return `vizinha de tag ${st.origin}`;
  if (st.kind === "cat") return `categoria ${st.label}`;
  if (st.kind === "term") return `termo ${st.label}`;
  return `tag ${st.label}`;
}

/** Propaga pelos nós até `maxHops` saltos e soma, por documento, o que chegou por vizinhança. */
function propagate(g: DocGraph, terms: string[], maxHops: number, decay: number): Map<string, { sum: number; best: number; reason: string }> {
  const spread = new Map<string, { sum: number; best: number; reason: string }>();
  let cur = seedNodes(g, terms);
  let visited = 0;
  for (let hop = 1; hop <= maxHops && cur.size; hop++) {
    const next = new Map<string, Active>();
    for (const [u, st] of cur) {
      for (const e of g.edges.get(u) ?? []) {
        if (++visited > MAX_EDGES_PER_QUERY) return spread;
        const amt = st.act * e.w * decay;
        const target = g.nodes.get(e.to);
        if (!target) continue;
        if (target.kind === "doc") {
          const prev = spread.get(e.to);
          const better = !prev || amt > prev.best;
          spread.set(e.to, {
            sum: (prev?.sum ?? 0) + amt,
            best: better ? amt : (prev?.best ?? 0),
            reason: better ? reasonOf(st) : (prev?.reason ?? reasonOf(st)),
          });
        } else if (hop < maxHops) {
          const prev = next.get(e.to);
          next.set(e.to, {
            act: (prev?.act ?? 0) + amt,
            origin: prev?.origin ?? st.origin,
            seed: false,
            kind: target.kind,
            label: target.label,
          });
        }
      }
    }
    cur = next;
  }
  return spread;
}

const byTimeThenId = (g: DocGraph) => (a: string, b: string) => {
  const da = g.docs.get(a);
  const db = g.docs.get(b);
  return (db?.time ?? 0) - (da?.time ?? 0) || a.localeCompare(b);
};

/**
 * Documentos relevantes para a busca. Pontuação = direta (0 a 1) + espalhada pela vizinhança.
 * Busca vazia devolve os documentos por data. Sem chamada de IA nem de banco.
 */
export function searchGraph(g: DocGraph, query: string, opts: SearchOptions = {}): GraphHit[] {
  const { maxHops = 2, decay = 0.5, limit = 20 } = opts;
  const terms = searchTerms(query);
  if (!terms.length) {
    return [...g.docs.keys()]
      .sort(byTimeThenId(g))
      .slice(0, limit)
      .map((id) => ({ id, score: 0, reasons: ["ordem por data"] }));
  }
  const spread = propagate(g, terms, maxHops, decay);
  const hits: GraphHit[] = [];
  for (const rec of g.docs.values()) {
    const d = directMatch(rec, terms);
    const s = spread.get(`doc:${rec.id}`);
    const score = d.score + (s?.sum ?? 0);
    if (score <= 0) continue;
    const reasons = [...new Set([...d.reasons, ...(s ? [s.reason] : [])])].slice(0, MAX_REASONS);
    hits.push({ id: rec.id, score: round(score), reasons });
  }
  hits.sort((a, b) => b.score - a.score || byTimeThenId(g)(a.id, b.id));
  return hits.slice(0, limit);
}
