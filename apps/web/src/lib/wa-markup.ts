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

// ─── Opções numeradas do menu ───────────────────────────────────────

const KEYCAPS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const OPTION_LINE = /^\s*(0️⃣|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣|🔟)\s+(.+)$/;
const SUB_LINE = /^\s{3,}_(.+)_\s*$/;

export type ChatBlock = { kind: "text"; text: string } | { kind: "option"; n: number; label: string; sub?: string };

/**
 * Separa a resposta do assistente em texto e opções numeradas ("1️⃣ 📧 E-mails", com a linha de apoio "     _sub_" logo abaixo).
 * O app mostra cada opção como botão: tocar envia o número, igual a digitá-lo.
 */
export function splitOptions(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const buf: string[] = [];
  const flush = () => {
    const t = buf.splice(0).join("\n").replace(/^\n+|\n+$/g, "");
    if (t) blocks.push({ kind: "text", text: t });
  };
  for (const line of text.split("\n")) {
    const m = OPTION_LINE.exec(line);
    if (m) {
      flush();
      blocks.push({ kind: "option", n: KEYCAPS.indexOf(m[1]), label: m[2].trim() });
      continue;
    }
    const sub = SUB_LINE.exec(line);
    const prev = blocks[blocks.length - 1];
    if (sub && buf.length === 0 && prev?.kind === "option" && !prev.sub) {
      prev.sub = sub[1].trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}
