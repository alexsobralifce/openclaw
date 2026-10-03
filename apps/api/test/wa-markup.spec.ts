import { describe, expect, it } from "vitest";
import { parseWaMarkup, WaSeg } from "../../web/src/lib/wa-markup";

const flat = (segs: WaSeg[]): string => segs.map((g) => (g.t === "text" ? g.v : `<${g.t}>${flat(g.v)}</${g.t}>`)).join("");

describe("marcação do WhatsApp no chat do app", () => {
  it("negrito, itálico e tachado viram trechos sem os símbolos", () => {
    expect(flat(parseWaMarkup("📧 *E-mails não lidos*\n_IFCE · do mais antigo ao mais novo_"))).toBe("📧 <b>E-mails não lidos</b>\n<i>IFCE · do mais antigo ao mais novo</i>");
    expect(flat(parseWaMarkup("~errado~ certo"))).toBe("<s>errado</s> certo");
  });
  it("aceita o símbolo colado em pontuação e emoji, como no WhatsApp", () => {
    expect(flat(parseWaMarkup("👤 *Hérique Costa* (_30/09 16:12_)"))).toBe("👤 <b>Hérique Costa</b> (<i>30/09 16:12</i>)");
    expect(flat(parseWaMarkup("🕐 _00:14_"))).toBe("🕐 <i>00:14</i>");
  });
  it("aninha negrito com itálico", () => {
    expect(flat(parseWaMarkup("*_junto_*"))).toBe("<b><i>junto</i></b>");
  });
  it("não mexe no que não é marcação: palavras com _, contas, símbolo solto", () => {
    expect(flat(parseWaMarkup("arquivo snake_case_nome.pdf"))).toBe("arquivo snake_case_nome.pdf");
    expect(flat(parseWaMarkup("2*3*4 e a * b"))).toBe("2*3*4 e a * b");
    expect(flat(parseWaMarkup("* lista *"))).toBe("* lista *");
    expect(flat(parseWaMarkup("uma_ só"))).toBe("uma_ só");
  });
  it("não atravessa linhas e devolve o texto original quando não há marcação", () => {
    expect(flat(parseWaMarkup("*a\nb*"))).toBe("*a\nb*");
    expect(flat(parseWaMarkup("só texto"))).toBe("só texto");
    expect(parseWaMarkup("")).toEqual([]);
  });
});
