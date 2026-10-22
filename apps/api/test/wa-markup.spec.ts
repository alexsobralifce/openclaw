import { describe, expect, it } from "vitest";
import { parseWaMarkup, parseWaRich, splitOptions, WaSeg } from "../../web/src/lib/wa-markup";

const flat = (segs: WaSeg[]): string => segs.map((g) => (g.t === "text" || g.t === "link" ? g.v : `<${g.t}>${flat(g.v)}</${g.t}>`)).join("");

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

describe("links clicáveis", () => {
  const rich = (t: string) => parseWaRich(t);

  it("endereço http(s) vira link; texto e negrito ao redor continuam", () => {
    expect(rich("*Catingueira* — Xangai\nhttps://open.spotify.com/track/7psOzl8llrGpLLl27lFb87\nok")).toEqual([
      { t: "b", v: [{ t: "text", v: "Catingueira" }] },
      { t: "text", v: " — Xangai\n" },
      { t: "link", v: "https://open.spotify.com/track/7psOzl8llrGpLLl27lFb87" },
      { t: "text", v: "\nok" },
    ]);
  });

  it("sublinhado dentro do endereço não vira itálico; pontuação do fim fica fora do link", () => {
    const segs = rich("veja https://exemplo.com/a_b_c e (https://exemplo.com/x).");
    expect(segs.filter((s) => s.t === "link").map((s) => s.v)).toEqual(["https://exemplo.com/a_b_c", "https://exemplo.com/x"]);
    expect(segs.some((s) => s.t === "i")).toBe(false);
  });

  it("só http e https: outros esquemas ficam como texto", () => {
    expect(rich("javascript:alert(1) e ftp://x.com")).toEqual([{ t: "text", v: "javascript:alert(1) e ftp://x.com" }]);
  });
});

describe("opções numeradas do menu", () => {
  it("transforma cada linha numerada em opção, com a linha de apoio, e mantém o resto como texto", () => {
    const menu = ["🌤️ *Boa tarde! Sou o MagoBox*", "O que vamos ver agora?", "━━━━━━━━━━━━━━━━━━", "1️⃣ 📧 E-mails", "2️⃣ 📚 Documentos", "     _PDFs guardados, com tags_", "0️⃣ ⬅️ Voltar", "━━━━━━━━━━━━━━━━━━", "💡 _Responda com o número_"].join("\n");
    const blocks = splitOptions(menu);
    expect(blocks.filter((b) => b.kind === "option")).toEqual([
      { kind: "option", n: 1, label: "📧 E-mails" },
      { kind: "option", n: 2, label: "📚 Documentos", sub: "PDFs guardados, com tags" },
      { kind: "option", n: 0, label: "⬅️ Voltar" },
    ]);
    expect(blocks[0]).toEqual({ kind: "text", text: "🌤️ *Boa tarde! Sou o MagoBox*\nO que vamos ver agora?\n━━━━━━━━━━━━━━━━━━" });
    expect(blocks[blocks.length - 1]).toEqual({ kind: "text", text: "━━━━━━━━━━━━━━━━━━\n💡 _Responda com o número_" });
  });

  it("🔟 vale 10; texto comum e linhas que só citam número não viram opção", () => {
    expect(splitOptions("🔟 🧾 Outros")).toEqual([{ kind: "option", n: 10, label: "🧾 Outros" }]);
    expect(splitOptions("Você tem 1 e-mail\n2 documentos")).toEqual([{ kind: "text", text: "Você tem 1 e-mail\n2 documentos" }]);
  });

  it("a linha de apoio só vale logo depois de uma opção", () => {
    const b = splitOptions("texto\n     _solto_\n1️⃣ Item");
    expect(b[0]).toEqual({ kind: "text", text: "texto\n     _solto_" });
  });
});
