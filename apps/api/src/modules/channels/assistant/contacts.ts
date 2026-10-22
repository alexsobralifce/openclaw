// Contatos do Google em Markdown no Drive, um arquivo por letra (lógica pura).
// Assist.IA/Contatos/M.md tem um bloco "## Nome" por pessoa, só com nome, telefones, e-mails e empresa.

import { normalize } from "./voice";

export const CONTACTS_FOLDER = "Contatos";
/** Catálogo de endereços montado a partir do Gmail (quem escreveu ou recebeu e-mail seu), fora dos contatos do Google. */
export const EMAIL_BOOK_FOLDER = "Emails";
export const OTHER_FILE = "Outros.md";
const MAX_EACH = 5;

export interface Contact {
  nome: string;
  telefones: string[];
  emails: string[];
  empresa?: string;
}

/** Texto de uma linha só, sem marcação que quebre o Markdown (nada de título, comentário ou quebra de linha). */
export const oneLine = (s: unknown, max = 120) =>
  String(s ?? "")
    .replace(/<!--|-->/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/^[#>\-*\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const cleanPhone = (v: unknown) => {
  const t = String(v ?? "").replace(/[^\d+()\-.\s]/g, "").replace(/\s+/g, " ").trim();
  const digits = t.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15 ? t : "";
};
const cleanEmail = (v: unknown) => {
  const t = String(v ?? "").trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(t) ? t.slice(0, 120) : "";
};
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].slice(0, MAX_EACH);

/** Um contato da People API (names/phoneNumbers/emailAddresses/organizations) vira Contact; sem nome ou sem como falar, é descartado. */
export function fromPerson(p: any): Contact | null {
  const nome = oneLine(p?.names?.[0]?.displayName);
  if (!nome) return null;
  const telefones = uniq((p.phoneNumbers ?? []).map((x: any) => cleanPhone(x?.value)));
  const emails = uniq((p.emailAddresses ?? []).map((x: any) => cleanEmail(x?.value)));
  if (!telefones.length && !emails.length) return null;
  const empresa = oneLine(p.organizations?.[0]?.name, 80);
  return { nome, telefones, emails, ...(empresa ? { empresa } : {}) };
}

/** Letra do arquivo: a inicial do nome (A–Z, sem acento); qualquer outra coisa vai para "#". */
export function letterOf(nome: string): string {
  const c = normalize(nome).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

export const fileOfLetter = (letter: string) => (letter === "#" ? OTHER_FILE : `${letter}.md`);

const byName = (a: Contact, b: Contact) => normalize(a.nome).localeCompare(normalize(b.nome)) || a.nome.localeCompare(b.nome);

/** Agrupa por letra, cada grupo em ordem alfabética; o mesmo nome com os mesmos dados não repete. */
export function groupByLetter(contacts: Contact[]): Map<string, Contact[]> {
  const out = new Map<string, Contact[]>();
  const seen = new Set<string>();
  for (const c of [...contacts].sort(byName)) {
    const id = `${normalize(c.nome)}|${c.telefones.join(",")}|${c.emails.join(",")}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const l = letterOf(c.nome);
    out.set(l, [...(out.get(l) ?? []), c]);
  }
  return out;
}

export function renderLetterFile(letter: string, contacts: Contact[], day: string, title = "Contatos"): string {
  const head = `# ${title} — ${letter}\n\n<!-- Gerado automaticamente pelo MagoBox em ${day}. Edições neste arquivo são sobrescritas na próxima atualização; para anotar algo, use uma nota normal. -->\n`;
  if (!contacts.length) return `${head}\n_Nenhum contato com esta inicial._\n`;
  const blocks = contacts.map((c) =>
    [`## ${c.nome}`, ...c.telefones.map((t) => `- 📞 ${t}`), ...c.emails.map((e) => `- ✉️ ${e}`), ...(c.empresa ? [`- 🏢 ${c.empresa}`] : [])].join("\n"),
  );
  return `${head}\n${blocks.join("\n\n")}\n`;
}

/** Lê de volta um arquivo gerado por `renderLetterFile`. */
export function parseLetterFile(content: string): Contact[] {
  const out: Contact[] = [];
  let cur: Contact | null = null;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (cur) out.push(cur);
      cur = { nome: line.slice(3).trim(), telefones: [], emails: [] };
    } else if (cur && line.startsWith("- 📞 ")) cur.telefones.push(line.slice(4).trim());
    else if (cur && line.startsWith("- ✉️ ")) cur.emails.push(line.slice(4).trim());
    else if (cur && line.startsWith("- 🏢 ")) cur.empresa = line.slice(4).trim();
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.nome);
}

/** Partes de nome que quase nunca estão cadastradas ("Arnaud Jr" no pedido, "Arnaud" na lista): sufixos de família e ligações. */
const NAME_NOISE = new Set(["jr", "junior", "filho", "neto", "sobrinho", "segundo", "terceiro", "ii", "iii", "de", "da", "do", "dos", "das", "e"]);

/** Tira sufixos e ligações do nome pedido ("arnaud jr" → "arnaud"). Se só sobrar ruído, devolve o texto como veio. */
export function dropNameNoise(name: string): string {
  const kept = name.split(/\s+/).filter((t) => t && !NAME_NOISE.has(normalize(t)));
  return kept.length ? kept.join(" ") : name;
}

/**
 * Acha pelo nome, do mais exato ao mais frouxo, parando no primeiro nível que achar alguém:
 * 1. todas as palavras buscadas começam alguma palavra do nome ("marcos", "m silva", "silva");
 * 2. o mesmo, sem sufixos e ligações ("arnaud jr" acha "Arnaud", "maria da silva" acha "Maria Silva");
 * 3. com 2+ palavras importantes, quem bate com o primeiro nome ("arnaud costa" acha "Arnaud Souza"); os mais parecidos primeiro.
 */
export function findContacts(contacts: Contact[], query: string, max = 5): Contact[] {
  const terms = normalize(query).split(" ").filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const full = terms.join(" ");
  const core = terms.filter((t) => !NAME_NOISE.has(t));
  const rows = contacts.map((c) => {
    const name = normalize(c.nome);
    return { c, name, words: name.split(" ") };
  });
  const matched = (words: string[], ts: string[]) => ts.filter((t) => words.some((w) => w.startsWith(t))).length;
  const pick = (ts: string[], need: number) =>
    rows.flatMap((r) => {
      const hit = matched(r.words, ts);
      return hit >= need && hit > 0 ? [{ ...r, hit }] : [];
    });

  let found = pick(terms, terms.length);
  if (!found.length && core.length && core.length < terms.length) found = pick(core, core.length);
  if (!found.length && core.length >= 2) found = pick([core[0]], 1).map((r) => ({ ...r, hit: matched(r.words, core) }));

  const lead = core[0] ?? terms[0];
  const score = (r: { name: string; words: string[] }) => (r.name === full ? 3 : r.words[0].startsWith(lead) ? 2 : 1);
  return found.sort((a, b) => score(b) - score(a) || b.hit - a.hit || byName(a.c, b.c)).slice(0, max).map((r) => r.c);
}

/** Distância de edição entre duas palavras (Levenshtein), para achar "arnoud" perto de "arnaud". */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** 1 = igual, 0 = nada a ver; uma palavra que começa a outra ("arn" / "arnaud") conta como muito parecida. */
const wordLikeness = (a: string, b: string) => (b.startsWith(a) || a.startsWith(b) ? 0.9 : 1 - editDistance(a, b) / Math.max(a.length, b.length));

/**
 * Candidatos PARECIDOS com o nome pedido, para quando a busca exata não acha ninguém (erro de digitação, grafia diferente).
 * Barato e sem IA: serve de peneira antes de o Jev escolher. Devolve os mais parecidos primeiro, no máximo `max`.
 */
export function fuzzyCandidates(contacts: Contact[], query: string, max = 8): Contact[] {
  const terms = normalize(query).split(" ").filter((t) => t.length >= 3 && !NAME_NOISE.has(t));
  if (!terms.length) return [];
  return contacts
    .map((c) => {
      const words = normalize(c.nome).split(" ").filter(Boolean);
      const best = terms.map((t) => Math.max(0, ...words.map((w) => wordLikeness(t, w))));
      return { c, score: best.reduce((a, b) => a + b, 0) / terms.length };
    })
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score || byName(a.c, b.c))
    .slice(0, max)
    .map((x) => x.c);
}

// ─── Comandos ──────────────────────────────────────────────────

const KIND = "(?:telefone|numero|celular|whatsapp|zap|e-?mail|email|contato)";
/** Nomes que não são de pessoa: "e-mails de hoje" continua sendo o comando de e-mails. */
export const NOT_A_NAME = /^(hoje|ontem|amanha|agora|novos?|nao lidos?|ocultos?|spam|silenciados|interesse)$/;

/** "qual o telefone do Marcos", "email da Maria", "contato do João Silva". Devolve o nome pedido, ou null. */
export function contactQuery(flat: string): string | null {
  const m = flat.match(new RegExp(`^(?:por favor )?(?:me )?(?:(?:passa|manda|mostra|diz|fala|ve|busca|procura)\\s+)?(?:qual (?:e |eh )?)?(?:o |a )?${KIND}\\s+(?:do|da|de|dos|das)\\s+(.{2,60})$`));
  const name = m?.[1].replace(/\s+(por favor|pfv)$/, "").trim();
  return name && !NOT_A_NAME.test(name) ? name : null;
}

/** "atualizar contatos", "importar contatos do google". */
export function looksLikeContactsRefresh(flat: string): boolean {
  return /^(?:por favor )?(?:atualizar|atualiza|sincronizar|sincroniza|importar|importa|refazer|recarregar)\s+(?:os |meus |minha |a )?(?:lista de )?contatos(?: do google)?$/.test(flat);
}
