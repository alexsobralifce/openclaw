// Interpretação de escolhas ditadas por voz (Gemini no Android Auto, Siri no CarPlay, áudios transcritos).

const CARDINALS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};
const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4,
  quinto: 5, quinta: 5, sexto: 6, sexta: 6, setimo: 7, setima: 7, oitavo: 8, oitava: 8, ultimo: -1, ultima: -1,
};

/** Minúsculas, sem acentos e sem pontuação (o ditado costuma acrescentar ponto final e maiúsculas). */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.!?,;:"“”'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Número escolhido numa lista: "2", "dois", "opção 2", "número dois", "a segunda", "o último"...
 * `count` resolve "último". Devolve null se a frase não for uma escolha.
 */
export function parseChoice(text: string, count?: number): number | null {
  let t = normalize(text);
  t = t.replace(/^(eu )?(quero|escolho|abre|abrir|abra|ver|ler|seleciona|selecionar)( a| o)? /, "");
  t = t.replace(/^(a |o )?(opcao|numero|item|alternativa|tecla) /, "");
  t = t.replace(/^(a|o) /, "").replace(/ (opcao|item|email|e-mail|conversa|mensagem)$/, "").replace(/ (por favor|pfv)$/, "");
  if (/^\d{1,2}$/.test(t)) return Number(t);
  if (t in CARDINALS) return CARDINALS[t];
  if (t in ORDINALS) {
    const n = ORDINALS[t];
    return n === -1 ? (count ? count : null) : n;
  }
  return null;
}

const STOP = new Set(["de", "da", "do", "das", "dos", "a", "o", "as", "os", "e", "em", "no", "na", "com", "para", "pra", "que", "um", "uma", "sobre"]);
const words = (s: string) => normalize(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * Escolhe um item da lista pelo nome falado ("a do João", "conversas", "agenda").
 * Só considera frases curtas, para não sequestrar pedidos livres à IA, e exige um único melhor candidato.
 */
export function pickByLabel(text: string, labels: string[]): number | null {
  const said = words(text);
  if (!said.length || normalize(text).split(" ").length > 5) return null;
  const scores = labels.map((l) => {
    const lw = words(l);
    return said.filter((w) => lw.some((x) => x === w || (w.length >= 4 && x.startsWith(w)))).length;
  });
  const best = Math.max(0, ...scores);
  if (!best) return null;
  const idx = scores.flatMap((s, i) => (s === best ? [i] : []));
  return idx.length === 1 ? idx[0] + 1 : null;
}
