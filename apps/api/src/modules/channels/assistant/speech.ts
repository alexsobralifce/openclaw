/** Converte uma mensagem formatada para WhatsApp em um texto natural para ser falado. */
export function toSpeech(text: string): string {
  const spoken: string[] = [];
  const options: string[] = [];

  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || /^[━─\-=_\s]+$/.test(line)) continue;
    if (line.startsWith("💡")) continue;
    line = line
      .replace(/\p{Extended_Pictographic}|️|⃣|‍/gu, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (!line || /^(Conta|Para):?\s*\S+@/i.test(line)) continue;
    // não faz sentido ler endereços, datas soltas e títulos de seção em voz alta
    if (/^\S+@\S+$/.test(line) || /^\d{1,2}\/\d{1,2}(,|\s)\s*\d{1,2}:\d{2}$/.test(line) || /^Resumo$/i.test(line) || /^Vai dirigir/i.test(line)) continue;

    const opt = /^([0-9])\s+(.+)$/.exec(line);
    if (opt) {
      options.push(opt[2].toLowerCase());
      continue;
    }
    spoken.push(line.replace(/\s{2,}/g, " "));
  }

  let out = spoken.map((l) => l.replace(/[.:]+$/, "")).join(". ");
  if (options.length) {
    const list = options.length > 1 ? `${options.slice(0, -1).join(", ")} ou ${options[options.length - 1]}` : options[0];
    out += `. Diga: ${list}.`;
  }
  return out.length > 700 ? `${out.slice(0, 697)}...` : out;
}
