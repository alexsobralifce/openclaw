import { describe, expect, it } from "vitest";
import { cleanSubject, composeSeed, extractAddresses, verbatimBody } from "../src/modules/channels/assistant/email-compose";

describe("extractAddresses", () => {
  it("acha endereços, em minúsculas e sem repetir", () => {
    expect(extractAddresses("para Fulana@Email.com e fulana@email.com, outro@ifce.edu.br")).toEqual(["fulana@email.com", "outro@ifce.edu.br"]);
    expect(extractAddresses("sem endereço aqui")).toEqual([]);
    expect(extractAddresses("quebrado@sem")).toEqual([]);
  });
  it("limita a 5 destinatários", () => {
    expect(extractAddresses(Array.from({ length: 9 }, (_, i) => `p${i}@x.com`).join(" "))).toHaveLength(5);
  });
  it("não deixa quebra de linha nem cabeçalho escapar para dentro do endereço", () => {
    for (const a of extractAddresses("a@x.com\nBcc: invasor@y.com\r\nx@z.com")) expect(a).not.toMatch(/[\s:]/);
  });
});

describe("cleanSubject", () => {
  it("tira o 'assunto:' e deixa numa linha só", () => {
    expect(cleanSubject("assunto: Fulano avisa que vai pagar hoje")).toBe("Fulano avisa que vai pagar hoje");
    expect(cleanSubject("Assunto - aviso\nde pagamento")).toBe("aviso de pagamento");
    expect(cleanSubject("   ")).toBe("");
    expect(cleanSubject("a".repeat(500))).toHaveLength(200);
  });
});

describe("verbatimBody", () => {
  it("reconhece 'texto: ...' e devolve só o texto", () => {
    expect(verbatimBody("texto: Olá, tudo bem?\nAbraço")).toBe("Olá, tudo bem?\nAbraço");
    expect(verbatimBody("exatamente - confirmo a reunião")).toBe("confirmo a reunião");
  });
  it("uma instrução comum não é texto pronto", () => {
    expect(verbatimBody("avisa que vou pagar hoje")).toBeNull();
    expect(verbatimBody("texto sem dois pontos")).toBeNull();
  });
});

describe("composeSeed", () => {
  it("o comando sozinho abre o passo a passo vazio", () => {
    for (const t of ["enviar e-mail", "Enviar email", "escrever um e-mail", "novo e-mail", "mandar um novo email", "compor e-mail", "por favor, enviar e-mail"]) expect(composeSeed(t), t).toEqual({ to: [] });
  });
  it("já traz destinatário e assunto quando ditos", () => {
    expect(composeSeed("enviar e-mail para fulana@email.com assunto: fulano avisa que vai pagar dinheiro de fulanda hoje")).toEqual({
      to: ["fulana@email.com"],
      subject: "fulano avisa que vai pagar dinheiro de fulanda hoje",
    });
    expect(composeSeed("enviar email para a@x.com e b@y.com")).toEqual({ to: ["a@x.com", "b@y.com"] });
    expect(composeSeed("novo e-mail assunto: reunião de quinta")).toEqual({ to: [], subject: "reunião de quinta" });
  });
  it("pedido livre vai para a IA (null)", () => {
    expect(composeSeed("mandar um e-mail pro Marcos dizendo que vou atrasar")).toBeNull();
    expect(composeSeed("enviar e-mail para fulana@email.com dizendo que vou pagar hoje")).toBeNull();
    expect(composeSeed("escrever e-mail para o Marcos")).toBeNull();
  });
  it("não pega outras frases", () => {
    expect(composeSeed("ler e-mails")).toBeNull();
    expect(composeSeed("apague os emails 1 a 3")).toBeNull();
    expect(composeSeed("buscar e-mails do Marcos")).toBeNull();
    expect(composeSeed("email do Marcos")).toBeNull();
  });
});
