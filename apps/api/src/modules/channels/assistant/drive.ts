// Pedidos de arquivo do Google Drive (lógica pura).

/** Palavras de pedido/enchimento que não fazem parte do nome do arquivo. */
const FILLER = new Set(
  ("me mim a o as os um uma de do da dos das no na nos nas em pra para por favor pode poder podia quero preciso queria gostaria " +
    "buscar busque busca busco procurar procure procura achar ache pegar pegue pega baixar baixe mandar manda mande enviar envia envie " +
    "passar passe passa trazer traga traz abrir abra ver mostrar mostre arquivo arquivos documento documentos meu minha meus minhas " +
    "ouvir escutar tocar toca toque google drive gdrive ai la ali agora rapido rapidinho " +
    "liste listar listem mostra encontrou encontrei encontre achou achei tem tenho existe existem quais qual que todos todas " +
    "pasta autor autora escrito escrita extensao formato dentro eu").split(" "),
);

const strip = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** O texto pede algo do Drive? ("me manda o contrato do drive", "drive relatório", "buscar no drive"). */
export function looksLikeDriveRequest(flat: string): boolean {
  return /\b(g?drive)\b/.test(flat) && (/^(g?drive|google drive)\b/.test(flat) || /\b(busc\w*|procur\w*|ach\w*|peg\w*|baix\w*|mand\w*|envi\w*|pass\w*|traz\w*|quer\w*|precis\w*|abr\w*|list\w*|encontr\w*|mostr\w*)\b/.test(flat));
}

const MEDIA_NOUN = "(?:musicas?|cancao|cancoes|audios?|mp3|faixas?|fotos?|imagens?|videos?|planilhas?|pdfs?|apresentacao|slides?|livros?|ebooks?)";
const MEDIA_ASK = "(?:quer\\w*|list\\w*|preciso|precisa\\w*|baix\\w*|mand\\w*|envi\\w*|peg\\w*|traz\\w*|toc\\w*|ouvir|escutar|busc\\w*|procur\\w*|ach\\w*|abr\\w*|me da|tem)";
/** Depois do tipo vem outra coisa que não o nome do arquivo ("foto pro João", "pdf no e-mail"). */
const NOT_A_FILE_NAME = /^(para|pra|pro|ao|aos|no|na|nos|nas|num|numa|em|por|com|e|ou)$/;

/**
 * Pede um arquivo pelo tipo e nome, sem dizer "drive": "quero a música catingueira", "baixe a música X", "me manda a foto do contrato".
 * Exige verbo de pedido + tipo (música, foto, pdf, planilha...) + o nome logo depois; fala de e-mail, WhatsApp, agenda ou nota não conta.
 */
export function looksLikeMediaRequest(flat: string): boolean {
  if (/\b(e-?mails?|whatsapp|zap|agenda|eventos?|notas?|contato|telefone)\b/.test(flat)) return false;
  const m = flat.match(new RegExp(`^(?:por favor )?(?:eu )?(?:me )?${MEDIA_ASK}\\b.*?\\b${MEDIA_NOUN}\\s+(\\S{2,})`));
  return !!m && !NOT_A_FILE_NAME.test(m[1]);
}

/** Tira o pedido e deixa só o nome procurado, mantendo acentos e maiúsculas das palavras que sobram. */
export function driveQueryFrom(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => {
      const s = strip(w);
      return s && !FILLER.has(s);
    })
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
}

export function fileIcon(mime = ""): string {
  if (mime.includes("pdf")) return "📕";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "📊";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📽️";
  if (mime.includes("document") || mime.includes("word") || mime.startsWith("text/")) return "📝";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜️";
  return "📄";
}

export function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Busca aproximada: tipo de arquivo, variações das palavras e ordenação por semelhança ───

export type DriveKind = "audio" | "image" | "video" | "pdf" | "sheet" | "slides" | "book";

/** Tipos em que o filtro nunca é largado na busca aproximada (livro é só PDF ou EPUB, nunca código nem nota). */
export const STRICT_KINDS = new Set<DriveKind>(["book"]);

/** Como o tipo aparece na lista ("Achei 5 livros"). */
export const KIND_LABEL: Partial<Record<DriveKind, string>> = { book: "livros" };

/** Filtro de tipo na sintaxe de busca do Drive. */
export const KIND_Q: Record<DriveKind, string> = {
  audio: "mimeType contains 'audio/'",
  image: "mimeType contains 'image/'",
  video: "mimeType contains 'video/'",
  pdf: "mimeType = 'application/pdf'",
  sheet: "(mimeType contains 'spreadsheet' or mimeType contains 'excel' or mimeType = 'text/csv')",
  slides: "(mimeType contains 'presentation' or mimeType contains 'powerpoint')",
  // EPUB às vezes sobe ao Drive como application/octet-stream: entra na busca e o resto sai no isBook (pelo nome)
  book: "(mimeType = 'application/pdf' or mimeType = 'application/epub+zip' or mimeType = 'application/octet-stream')",
};

const KIND_WORDS: [RegExp, DriveKind][] = [
  [/^(musica|musicas|cancao|cancoes|som|audio|audios|mp3|faixa|song)$/, "audio"],
  [/^(foto|fotos|imagem|imagens|print|screenshot|png|jpg|jpeg)$/, "image"],
  [/^(video|videos|filme|mp4)$/, "video"],
  [/^pdf$/, "pdf"],
  [/^(planilha|planilhas|excel|xlsx|csv|tabela)$/, "sheet"],
  [/^(apresentacao|apresentacoes|slide|slides|powerpoint|ppt|pptx)$/, "slides"],
  [/^(livro|livros|ebook|ebooks|epub|epubs)$/, "book"],
];

/** Livro: PDF ou EPUB, pelo tipo ou pela extensão (o Drive às vezes guarda EPUB como arquivo genérico). */
export function isBook(f: { nome?: string; tipo?: string }): boolean {
  return f.tipo === "application/pdf" || f.tipo === "application/epub+zip" || /\.(pdf|epub)$/i.test(f.nome ?? "");
}

/** Extensão pedida → filtro de tipo na busca do Drive (o Drive não filtra por extensão). Sem tipo conhecido, só o nome serve. */
const EXT_MIME: Record<string, string> = {
  pdf: "mimeType = 'application/pdf'",
  epub: "(mimeType = 'application/epub+zip' or mimeType = 'application/octet-stream')",
  docx: "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
  xlsx: "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
  pptx: "mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'",
  csv: "mimeType = 'text/csv'",
  txt: "mimeType = 'text/plain'",
  mp3: "mimeType = 'audio/mpeg'",
  mp4: "mimeType = 'video/mp4'",
  jpg: "mimeType = 'image/jpeg'",
  png: "mimeType = 'image/png'",
};
const EXT_ALIAS: Record<string, string> = { doc: "docx", xls: "xlsx", ppt: "pptx", jpeg: "jpg" };

export function extQuery(ext: string): string {
  return EXT_MIME[ext] ?? "";
}

/** Tipos ambíguos (EPUB e extensão desconhecida) só se confirmam pela terminação do nome. */
export function needsNameCheck(ext: string): boolean {
  return !EXT_MIME[ext] || ext === "epub";
}

export function nameHasExt(nome: string, ext: string): boolean {
  return nome.toLowerCase().endsWith(`.${ext}`);
}

export interface DriveSpec {
  /** palavras do nome que o dono lembra (sem "me manda", "do drive"...) */
  terms: string[];
  /** tipo pedido: "música X" filtra áudios, "planilha de gastos" filtra planilhas */
  kind?: DriveKind;
  /** extensão pedida ("em epub", ".pdf"): filtro duro */
  ext?: string;
  /** nome da pasta ("na pasta Faculdade"): procura dentro dela e das subpastas */
  folder?: string;
  /** palavras do nome do autor ("do autor Machado de Assis"): têm de aparecer no nome ou no texto do arquivo */
  author?: string[];
  /** pedido de listagem ("liste os livros", "quais planilhas eu tenho"): mostra a lista, nunca envia sozinho */
  list?: boolean;
  /** palavras extras para a busca aproximada: sinônimos, correções, a palavra do tipo... */
  alternates: string[];
}

/** "me manda a música evidências do drive" → { terms: ["evidências"], kind: "audio", alternates: ["música"] }. */
const NAME_STOP = new Set("que com na no nas nos em pasta arquivo arquivos livro livros pdf epub drive google e ou para pra por pelo pela".split(" "));
const CONNECTOR = new Set(["de", "da", "do", "dos", "das"]);

/** Pega o nome logo depois da deixa ("Machado de Assis que eu baixei" → "Machado de Assis"), até 4 palavras. */
function takeName(rest: string): { name: string; used: string } {
  const words = rest.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < 4; i++) {
    const raw = words[i];
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!w) break;
    const next = (words[i + 1] ?? "").replace(/^[^\p{L}\p{N}]+/u, "");
    const connector = CONNECTOR.has(strip(w)) && out.length > 0 && /^\p{Lu}/u.test(next);
    if (NAME_STOP.has(strip(w)) || (CONNECTOR.has(strip(w)) && !connector)) break;
    out.push(w);
    if (/[,.;?!]$/.test(raw)) break;
  }
  const name = out.join(" ");
  return { name, used: name };
}

/** Tira do texto os filtros ditos às claras (pasta, autor, extensão) e devolve o que sobrou. */
function extractFilters(text: string): { rest: string; ext?: string; folder?: string; author?: string[] } {
  let rest = text;
  let folder: string | undefined;
  let author: string[] | undefined;
  let ext: string | undefined;
  const q = rest.match(/\bpasta\s+(?:chamada\s+|de nome\s+)?(?:"([^"]+)"|“([^”]+)”)/iu);
  if (q) {
    folder = (q[1] ?? q[2]).trim();
    rest = rest.replace(q[0], " ");
  } else {
    const m = rest.match(/\bpasta\s+(?:chamada\s+|de nome\s+)?(?=\S)/iu);
    if (m) {
      const after = rest.slice((m.index ?? 0) + m[0].length);
      const { name } = takeName(after);
      if (name) {
        folder = name;
        rest = rest.slice(0, m.index ?? 0) + " " + after.slice(after.indexOf(name) + name.length);
      }
    }
  }
  const a = rest.match(/\b(?:d[oa]s?\s+autor(?:a|es)?|de\s+autor(?:a)?|autor(?:a)?|escrit[oa]s?\s+por|de\s+autoria\s+d[aeo])\s*:?\s+(?=\S)/iu);
  if (a) {
    const after = rest.slice((a.index ?? 0) + a[0].length);
    const { name } = takeName(after);
    if (name) {
      author = name.split(/\s+/).filter((w) => !CONNECTOR.has(strip(w)) && strip(w).length >= 2);
      rest = rest.slice(0, a.index ?? 0) + " " + after.slice(after.indexOf(name) + name.length);
    }
  }
  const e = rest.match(/(?:\bem\s+|\bformato\s+|\bextens[aã]o\s+|\s\.|^\.)(pdf|epub|docx?|xlsx?|pptx?|csv|txt|mp3|mp4|jpe?g|png)\b/iu);
  if (e) {
    const x = e[1].toLowerCase();
    ext = EXT_ALIAS[x] ?? x;
    rest = rest.replace(e[0], " ");
  }
  return { rest, ext, folder, author };
}

export function parseDriveQuery(text: string): DriveSpec {
  const original = text;
  const filters = extractFilters(text);
  text = filters.rest;
  const terms: string[] = [];
  const alternates: string[] = [];
  let kind: DriveKind | undefined;
  for (const w of driveQueryFrom(text).split(" ").filter(Boolean)) {
    const hit = KIND_WORDS.find(([re]) => re.test(strip(w)));
    if (hit && !kind) {
      kind = hit[1];
      alternates.push(w);
    } else terms.push(w);
  }
  const flat = original.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const list = /^(liste|listar|lista|listem|quais|mostre|mostra|ver)\b/.test(flat) || /\btod[oa]s\s+(os|as)\b/.test(flat);
  return {
    terms: terms.slice(0, 6),
    kind,
    alternates,
    ...(filters.ext ? { ext: filters.ext } : {}),
    ...(filters.folder ? { folder: filters.folder } : {}),
    ...(filters.author?.length ? { author: filters.author } : {}),
    ...(list ? { list: true } : {}),
  };
}

const noAccent = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A palavra e suas variações comuns: sem acento e no singular. Usado na busca aproximada. */
export function wordVariants(w: string): string[] {
  const base = w.toLowerCase();
  const out = new Set([base, noAccent(base)]);
  for (const v of [...out]) if (v.length > 4 && v.endsWith("s")) out.add(v.replace(/(es|s)$/, ""));
  return [...out].filter((v) => v.length >= 2);
}

/** Palavras-chave sugeridas pela IA → lista limpa (só palavras soltas, sem repetir, no máximo 10). */
export function sanitizeAlternates(input: unknown, max = 10): string[] {
  const out = new Set<string>();
  for (const raw of Array.isArray(input) ? input : []) {
    for (const w of String(raw ?? "").split(/\s+/)) {
      const t = w.replace(/[^\p{L}\p{N}-]/gu, "").slice(0, 30);
      if (t.length >= 3) out.add(t);
      if (out.size >= max) return [...out];
    }
  }
  return [...out];
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Nota de semelhança do nome com o que o dono lembra: palavra igual pesa 2, com 1 letra errada 1,5 (só palavras
 * de 5+ letras), palavra sugerida pela IA/variação pesa 1. Sem nota 0 (ex.: achado pelo conteúdo do arquivo).
 */
export function similarity(name: string, terms: string[], alternates: string[] = []): number {
  const n = noAccent(name.toLowerCase());
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const t of terms) {
    const w = noAccent(t.toLowerCase());
    if (n.includes(w)) score += 2;
    else if (w.length >= 5 && tokens.some((k) => Math.abs(k.length - w.length) <= 1 && lev(k, w) <= 1)) score += 1.5;
  }
  for (const a of alternates) if (n.includes(noAccent(a.toLowerCase()))) score += 1;
  return score;
}

/** Mais parecidos primeiro; empate, o modificado mais recentemente. */
export function rankFiles<T extends { nome: string; modificado?: string }>(files: T[], terms: string[], alternates: string[] = []): T[] {
  return files
    .map((f) => ({ f, s: similarity(f.nome, terms, alternates) }))
    .sort((a, b) => b.s - a.s || String(b.f.modificado ?? "").localeCompare(String(a.f.modificado ?? "")))
    .map((x) => x.f);
}
