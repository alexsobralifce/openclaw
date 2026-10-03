/** Quanto tempo o arquivo enviado pelo assistente fica disponível para baixar (o mesmo FILE_TTL_MS da API: 1 hora). */
export const FILE_AVAILABLE_MS = 60 * 60_000;

export const fileExpired = (createdAt: string, now = Date.now()) => now - new Date(createdAt).getTime() > FILE_AVAILABLE_MS;

/** Ícone do tipo do arquivo, para o cartão de download. */
export function fileEmoji(mime = ""): string {
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎞️";
  if (mime === "application/pdf") return "📄";
  if (/spreadsheet|excel|csv/.test(mime)) return "📊";
  return "📎";
}

/** "3,2 MB", "820 KB"; vazio se não souber o tamanho. */
export function fileSizeLabel(bytes?: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** A mensagem é só o "📎 nome" automático: o cartão já mostra o nome, então o texto não se repete. */
export const isAutoFileNote = (text: string, name?: string) => !!name && text.trim() === `📎 ${name}`;
