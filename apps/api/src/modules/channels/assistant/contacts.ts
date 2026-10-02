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
  const head = `# ${title} — ${letter}\n\n<!-- Gerado automaticamente pelo Assist.IA em ${day}. Edições neste arquivo são sobrescritas na próxima atualização; para anotar algo, use uma nota normal. -->\n`;
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

/** Acha pelo nome: todas as palavras buscadas começam alguma palavra do nome ("marcos", "m silva", "silva"). */
export function findContacts(contacts: Contact[], query: string, max = 5): Contact[] {
  const terms = normalize(query).split(" ").filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const full = terms.join(" ");
  const scored = contacts.flatMap((c) => {
    const name = normalize(c.nome);
    const words = name.split(" ");
    if (!terms.every((t) => words.some((w) => w.startsWith(t)))) return [];
    return [{ c, score: name === full ? 3 : words[0].startsWith(terms[0]) ? 2 : 1 }];
  });
  return scored.sort((a, b) => b.score - a.score || byName(a.c, b.c)).slice(0, max).map((x) => x.c);
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
