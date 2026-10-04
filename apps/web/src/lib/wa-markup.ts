/** Marcação de texto do WhatsApp que o assistente usa: *negrito*, _itálico_ e ~tachado~. */
export type WaSeg = { t: "text"; v: string } | { t: "b" | "i" | "s"; v: WaSeg[] } | { t: "link"; v: string };

const KIND = { "*": "b", _: "i", "~": "s" } as const;
const PATTERN = /\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
const WORD = /[\p{L}\p{N}]/u;

/**
 * Quebra o texto em trechos de texto, negrito, itálico e tachado (podem se aninhar: "*_x_*").
 * Como no WhatsApp, o símbolo só vale colado numa palavra e com borda: "snake_case_nome" e "2*3*4" ficam como estão.
 */
export function parseWaMarkup(text: string): WaSeg[] {
  const out: WaSeg[] = [];
  let last = 0;
  const re = new RegExp(PATTERN.source, "g");
  const plain = (to: number) => {
    if (to > last) out.push({ t: "text", v: text.slice(last, to) });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const mark = m[0][0] as keyof typeof KIND;
    const inner = m[1] ?? m[2] ?? m[3];
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    const edgeOk = !(before && WORD.test(before)) && !(after && WORD.test(after)) && inner.trim() === inner;
    if (!edgeOk) {
      re.lastIndex = m.index + 1; // não é marcação: o símbolo é texto comum
      continue;
    }
    plain(m.index);
    out.push({ t: KIND[mark], v: parseWaMarkup(inner) });
    last = m.index + m[0].length;
  }
  plain(text.length);
  return out;
}

const URL_RE = /https?:\/\/[^\s<>"]+/g;

/**
 * Como `parseWaMarkup`, mas endereços http(s) viram trechos de link clicável. Os links são separados ANTES da marcação, para que
 * "_" e "*" dentro de um endereço não virem itálico ou negrito. Pontuação colada no fim ("…/x.") fica fora do link.
 */
export function parseWaRich(text: string): WaSeg[] {
  const out: WaSeg[] = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    if (m.index > last) out.push(...parseWaMarkup(text.slice(last, m.index)));
    out.push({ t: "link", v: url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push(...parseWaMarkup(text.slice(last)));
  return out;
}
