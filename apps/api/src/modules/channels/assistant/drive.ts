// Pedidos de arquivo do Google Drive (lógica pura).

/** Palavras de pedido/enchimento que não fazem parte do nome do arquivo. */
const FILLER = new Set(
  ("me mim a o as os um uma de do da dos das no na nos nas em pra para por favor pode poder podia quero preciso queria gostaria " +
    "buscar busque busca busco procurar procure procura achar ache pegar pegue pega baixar baixe mandar manda mande enviar envia envie " +
    "passar passe passa trazer traga traz abrir abra ver mostrar mostre arquivo arquivos documento documentos meu minha meus minhas " +
    "google drive gdrive ai la ali agora rapido rapidinho").split(" "),
);

const strip = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** O texto pede algo do Drive? ("me manda o contrato do drive", "drive relatório", "buscar no drive"). */
export function looksLikeDriveRequest(flat: string): boolean {
  return /\b(g?drive)\b/.test(flat) && (/^(g?drive|google drive)\b/.test(flat) || /\b(busc\w*|procur\w*|ach\w*|peg\w*|baix\w*|mand\w*|envi\w*|pass\w*|traz\w*|quer\w*|precis\w*|abr\w*)\b/.test(flat));
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

export type DriveKind = "audio" | "image" | "video" | "pdf" | "sheet" | "slides";

/** Filtro de tipo na sintaxe de busca do Drive. */
export const KIND_Q: Record<DriveKind, string> = {
  audio: "mimeType contains 'audio/'",
  image: "mimeType contains 'image/'",
  video: "mimeType contains 'video/'",
  pdf: "mimeType = 'application/pdf'",
  sheet: "(mimeType contains 'spreadsheet' or mimeType contains 'excel' or mimeType = 'text/csv')",
  slides: "(mimeType contains 'presentation' or mimeType contains 'powerpoint')",
};

const KIND_WORDS: [RegExp, DriveKind][] = [
  [/^(musica|musicas|cancao|cancoes|som|audio|audios|mp3|faixa|song)$/, "audio"],
  [/^(foto|fotos|imagem|imagens|print|screenshot|png|jpg|jpeg)$/, "image"],
  [/^(video|videos|filme|mp4)$/, "video"],
  [/^pdf$/, "pdf"],
  [/^(planilha|planilhas|excel|xlsx|csv|tabela)$/, "sheet"],
  [/^(apresentacao|apresentacoes|slide|slides|powerpoint|ppt|pptx)$/, "slides"],
];

export interface DriveSpec {
  /** palavras do nome que o dono lembra (sem "me manda", "do drive"...) */
  terms: string[];
  /** tipo pedido: "música X" filtra áudios, "planilha de gastos" filtra planilhas */
  kind?: DriveKind;
  /** palavras extras para a busca aproximada: sinônimos, correções, a palavra do tipo... */
  alternates: string[];
}

/** "me manda a música evidências do drive" → { terms: ["evidências"], kind: "audio", alternates: ["música"] }. */
export function parseDriveQuery(text: string): DriveSpec {
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
  return { terms: terms.slice(0, 6), kind, alternates };
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
