const NUM_WORDS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
// Voz no carro: quanto mais curto, mais rápido o Gemini termina de ler e o motorista responde
const MAX_LEN = Number(process.env.CAR_SPEECH_MAX_CHARS || 350);

const strip = (line: string) =>
  line
    .replace(/\p{Extended_Pictographic}|️|⃣|‍/gu, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Converte uma mensagem formatada para WhatsApp em texto natural para ser lido em voz alta
 * (Gemini no Android Auto, Siri no CarPlay, ou a voz do próprio assistente).
 * - Ações curtas viram "Diga: ler, apagar ou responder".
 * - Itens de lista (com linhas de detalhe) viram "Um, Fulano, assunto. Dois, ...".
 */
export function toSpeech(text: string): string {
  const spoken: string[] = [];
  const options: { n: number; label: string; details: string[] }[] = [];

  for (const raw of text.split("\n")) {
    // Linha recuada logo depois de uma opção é detalhe dela (ex.: assunto do e-mail)
    const indented = /^\s{3,}/.test(raw);
    let line = raw.trim();
    if (!line || /^[━─\-=_\s]+$/.test(line)) continue;
    if (line.startsWith("💡")) continue;
    line = strip(line);
    if (!line || /^(Conta|Para):?\s*\S+@/i.test(line)) continue;
    // não faz sentido ler endereços, datas soltas e títulos de seção em voz alta
    if (/^\S+@\S+$/.test(line) || /^\d{1,2}\/\d{1,2}(,|\s)\s*\d{1,2}:\d{2}$/.test(line) || /^Resumo$/i.test(line) || /^Vai dirigir/i.test(line) || /^aberta · pendente$/.test(line)) continue;

    if (indented && options.length) {
      options[options.length - 1].details.push(line);
      continue;
    }
    const opt = /^(\d{1,2})\.?\s+(.+)$/.exec(line);
    if (opt) {
      options.push({ n: Number(opt[1]), label: opt[2], details: [] });
      continue;
    }
    spoken.push(line);
  }

  let body = spoken.map((l) => l.replace(/[.:]+$/, "")).join(". ");
  let tail = "";
  const items = options.filter((o) => o.n !== 0);
  const isList = items.some((o) => o.details.length) || items.length > 5;

  if (isList) {
    const read = items.map((o) => `${NUM_WORDS[o.n] ?? o.n}, ${[o.label, ...o.details].map((x) => x.replace(/[.:]+$/, "")).join(", ")}`);
    tail = `${read.join(". ")}. Diga o número.`;
  } else if (items.length) {
    // "Voltar" não precisa ser dito: quem quer sair já sabe
    const labels = items.map((o) => o.label.toLowerCase());
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} ou ${labels[labels.length - 1]}` : labels[0];
    tail = `Diga: ${list}.`;
  }
  // As instruções do fim nunca são cortadas; o texto antes delas encurta numa fronteira de frase
  const room = MAX_LEN - tail.length - 2;
  if (body.length > room) {
    const cut = body.slice(0, Math.max(0, room));
    const end = cut.lastIndexOf(". ");
    body = end > room / 2 ? cut.slice(0, end) : `${cut.slice(0, Math.max(0, room - 3))}...`;
  }
  return [body, tail].filter(Boolean).join(". ");
}
