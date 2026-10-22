// Conversão do texto do assistente (marcação do WhatsApp) para o HTML aceito pelo Telegram, e divisão em mensagens.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** *negrito* e _itálico_ do WhatsApp viram <b> e <i>; o resto do texto é escapado (o Telegram recusa HTML inválido). */
export function waToTelegramHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1<i>$2</i>");
}

/** O Telegram aceita até 4.096 caracteres por mensagem: divide em linhas, sem cortar uma marcação ao meio. */
export function splitForTelegram(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const piece = line.length > max ? line.match(new RegExp(`.{1,${max}}`, "gs")) ?? [line] : [line];
    for (const p of piece) {
      if (cur && cur.length + p.length + 1 > max) {
        out.push(cur);
        cur = p;
      } else cur = cur ? `${cur}\n${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Código de vínculo: curto, sem letras que se confundem. */
export function newLinkCode(random: (n: number) => Buffer): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(random(8), (b) => alphabet[b % alphabet.length]).join("");
}

/** Do texto "/start CODIGO" (ou "/start@bot CODIGO"), devolve o código; nulo se não for isso. */
export function startCode(text: string): string | null {
  const m = text.trim().match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,12})$/);
  return m ? m[1].toUpperCase() : null;
}
