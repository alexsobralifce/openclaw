import { describe, expect, it } from "vitest";
import { classifyEmail, groupOrder, isHidden, looksLikeBatchReply, parseBatchPlan } from "../src/modules/channels/assistant/email-filter";

const c = (m: Parameters<typeof classifyEmail>[0]) => classifyEmail(m).kind;

describe("classificação de e-mails", () => {
  it("sinais fortes do Gmail/servidor viram spam", () => {
    expect(c({ de: "x@y.com", assunto: "oi", labels: ["SPAM"] })).toBe("spam");
    expect(c({ de: "x@y.com", assunto: "oi", sinais: { "x-spam-flag": "YES" } })).toBe("spam");
    expect(c({ de: "x@y.com", assunto: "oi", sinais: { "x-spam-status": "Yes, score=9" } })).toBe("spam");
  });

  it("golpes típicos (vários sinais) são spam", () => {
    expect(c({ de: "premio@x.com", assunto: "VOCÊ GANHOU um prêmio exclusivo!!!", resumo: "clique aqui" })).toBe("spam");
    expect(c({ de: "seg@banco-falso.com", assunto: "Sua conta foi bloqueada", resumo: "verifique seus dados agora", sinais: { "authentication-results": "spf=fail dkim=fail" } })).toBe("spam");
  });

  it("um sinal isolado não esconde: só avisa", () => {
    const r = classifyEmail({ de: "joao@empresa.com", assunto: "Verifique sua conta no portal", resumo: "segue o link" });
    expect(isHidden(r.kind)).toBe(false);
    expect(r.warn.length).toBeGreaterThan(0);
  });

  it("propaganda e newsletter em massa viram promo", () => {
    expect(c({ de: "loja@x.com", assunto: "50% OFF hoje", labels: ["CATEGORY_PROMOTIONS"] })).toBe("promo");
    expect(c({ de: "news@x.com", assunto: "Novidades", sinais: { "list-unsubscribe": "<mailto:x>", precedence: "bulk" } })).toBe("promo");
    expect(c({ de: "loja@x.com", assunto: "Aproveite o desconto", resumo: "frete grátis", sinais: { "list-unsubscribe": "<x>" } })).toBe("promo");
  });

  it("notificações automáticas são mostradas (auto), não escondidas", () => {
    expect(c({ de: "GitHub <noreply@github.com>", assunto: "Novo commit" })).toBe("auto");
    expect(c({ de: "Banco <x@banco.com>", assunto: "Fatura", labels: ["CATEGORY_UPDATES"] })).toBe("auto");
    expect(isHidden("auto")).toBe(false);
  });

  it("e-mail de pessoa fica como pessoa", () => {
    expect(c({ de: "Maria Souza <maria@empresa.com>", assunto: "Reunião de quinta", resumo: "Podemos remarcar?" })).toBe("person");
  });

  it("resposta dentro de conversa (Re:) nunca é escondida por sinais fracos", () => {
    expect(c({ de: "loja@x.com", assunto: "Re: desconto combinado", resumo: "aproveite a oferta", sinais: { "list-unsubscribe": "<x>", precedence: "bulk" } })).toBe("person");
  });

  it("ordena pessoas antes dos automáticos, mantendo a ordem dentro do grupo", () => {
    const items = [{ id: "a", kind: "auto" as const }, { id: "b", kind: "person" as const }, { id: "c", kind: "auto" as const }, { id: "d", kind: "person" as const }];
    expect(groupOrder(items).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("plano de respostas por áudio", () => {
  const ok = JSON.stringify({ itens: [
    { n: 1, acao: "responder", instrucao: "confirmo presença" },
    { n: 2, acao: "responder", instrucao: "peça mais prazo" },
    { n: 3, acao: "ignorar" },
  ] });

  it("separa o que responder do que ignorar", () => {
    const p = parseBatchPlan(ok, 3);
    expect(p.replies).toEqual([{ n: 1, instrucao: "confirmo presença" }, { n: 2, instrucao: "peça mais prazo" }]);
    expect(p.ignored).toEqual([3]);
  });

  it("descarta números fora da lista, repetidos e instruções vazias", () => {
    const raw = JSON.stringify({ itens: [
      { n: 9, acao: "responder", instrucao: "x" },
      { n: 1, acao: "responder", instrucao: "   " },
      { n: 2, acao: "responder", instrucao: "ok" },
      { n: 2, acao: "responder", instrucao: "duplicado" },
      { n: "1", acao: "apagar" },
    ] });
    expect(parseBatchPlan(raw, 3).replies).toEqual([{ n: 2, instrucao: "ok" }]);
  });

  it("JSON inválido ou fora do formato vira plano vazio", () => {
    expect(parseBatchPlan("não é json", 3)).toEqual({ replies: [], ignored: [] });
    expect(parseBatchPlan('{"itens":"x"}', 3)).toEqual({ replies: [], ignored: [] });
  });

  it("respeita o máximo de respostas por áudio", () => {
    const raw = JSON.stringify({ itens: Array.from({ length: 8 }, (_, i) => ({ n: i + 1, acao: "responder", instrucao: "ok" })) });
    expect(parseBatchPlan(raw, 8, 6).replies).toHaveLength(6);
  });
});

describe("fala de resposta em lote", () => {
  const f = (t: string) => looksLikeBatchReply(t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,!?]/g, ""));
  it("reconhece instruções de resposta com referência aos e-mails", () => {
    expect(f("No 1 confirme presença, no 2 peça mais prazo e ignore o 3")).toBe(true);
    expect(f("Responda o primeiro dizendo que confirmo a reunião")).toBe(true);
    expect(f("responda a todos dizendo que estou de acordo")).toBe(true);
  });
  it("não sequestra pedidos livres nem frases curtas", () => {
    expect(f("mostre a minha agenda de amanhã e depois")).toBe(false);
    expect(f("quais reuniões tenho hoje")).toBe(false);
    expect(f("responda 1")).toBe(false);
    expect(f("me dê um resumo dos e-mails")).toBe(false);
  });
});
