import { describe, expect, it } from "vitest";
import { normalize } from "../src/modules/channels/assistant/voice";
import { emailSearchSpec } from "../src/modules/channels/assistant/email-search";
import { buildBook, isAutomatic, looksLikeEmailBookRefresh, parseAddresses } from "../src/modules/channels/assistant/email-book";

const q = (t: string) => emailSearchSpec(normalize(t));

describe("busca de e-mails no Gmail", () => {
  it("por pessoa: from/to", () => {
    expect(q("buscar e-mails do Marcos")).toEqual({ gmail: "(from:(marcos) OR to:(marcos))", label: "de marcos", person: "marcos" });
    expect(q("procura emails da Maria Souza")).toEqual({ gmail: "(from:(maria souza) OR to:(maria souza))", label: "de maria souza", person: "maria souza" });
    expect(q("e-mails do João")).toEqual({ gmail: "(from:(joao) OR to:(joao))", label: "de joao", person: "joao" });
  });
  it("por assunto: termos soltos", () => {
    expect(q("e-mails sobre contrato")).toEqual({ gmail: "contrato", label: "sobre contrato" });
    expect(q("pesquisar no gmail prova de calculo")).toEqual({ gmail: "prova de calculo", label: "sobre prova de calculo" });
    expect(q("procurar emails com boleto")).toEqual({ gmail: "boleto", label: "sobre boleto" });
  });
  it("não deixa o usuário injetar operadores do Gmail", () => {
    const s = q("buscar e-mails sobre contrato OR in:anywhere label:x")!;
    expect(s.gmail).not.toMatch(/[:()"]/);
  });
  it("não sequestra os outros comandos", () => {
    expect(q("e-mails de hoje")).toBeNull();
    expect(q("ler e-mails")).toBeNull();
    expect(q("email do Marcos")).toBeNull(); // singular: contato
    expect(q("buscar no drive o contrato")).toBeNull();
    expect(q("procura nas minhas notas contrato")).toBeNull();
    expect(q("apague os emails 1 a 3")).toBeNull();
  });
});

describe("parseAddresses", () => {
  it("lê nome e endereço em vários formatos", () => {
    expect(parseAddresses('"Silva, Marcos" <Marcos@X.com>, maria@y.com, Ana Lima <ana@z.com>')).toEqual([
      { email: "marcos@x.com", name: "Silva, Marcos" },
      { email: "maria@y.com" },
      { email: "ana@z.com", name: "Ana Lima" },
    ]);
    expect(parseAddresses(undefined)).toEqual([]);
    expect(parseAddresses("lixo sem endereco")).toEqual([]);
  });
});

describe("isAutomatic", () => {
  it("separa sistemas e listas de pessoas", () => {
    for (const e of ["noreply@x.com", "no-reply@github.com", "notifications@github.com", "newsletter@loja.com", "mailer-daemon@googlemail.com", "bounce+abc@mail.x.com", "ab1234567890@x.com", "alguem@sendgrid.net"]) expect(isAutomatic(e), e).toBe(true);
    for (const e of ["marcos@empresa.com", "maria.souza@ifce.edu.br", "joao_pedro@gmail.com"]) expect(isAutomatic(e), e).toBe(false);
  });
});

describe("buildBook", () => {
  const seen = (email: string, sent = false, name?: string) => ({ email, sent, ...(name ? { name } : {}) });
  it("guarda quem você escreveu, ou quem escreveu 2 vezes; ignora o resto", () => {
    const b = buildBook([seen("a@x.com", true, "Ana"), seen("b@x.com"), seen("c@x.com"), seen("c@x.com"), seen("d@x.com")]);
    expect(b.map((c) => c.emails[0])).toEqual(["a@x.com", "c@x.com"]);
  });
  it("tira os seus endereços, os automáticos e os que já estão nos contatos", () => {
    const b = buildBook(
      [seen("eu@gmail.com", true), seen("noreply@x.com", true), seen("ja@tem.com", true), seen("novo@x.com", true)],
      { own: ["EU@gmail.com"], known: new Set(["ja@tem.com"]) },
    );
    expect(b.map((c) => c.emails[0])).toEqual(["novo@x.com"]);
  });
  it("usa o nome mais frequente, ou o endereço embelezado, e ordena por quem você escreveu e frequência", () => {
    const b = buildBook([seen("m@x.com", false, "Marcos"), seen("m@x.com", false, "Marcos S."), seen("m@x.com", false, "Marcos"), seen("ana.lima@x.com", true), seen("p@x.com", false), seen("p@x.com", false)]);
    expect(b[0]).toEqual({ nome: "Ana Lima", telefones: [], emails: ["ana.lima@x.com"] });
    expect(b[1].nome).toBe("Marcos");
  });
  it("respeita o máximo e não deixa o nome quebrar o Markdown", () => {
    expect(buildBook(Array.from({ length: 10 }, (_, i) => seen(`p${i}@x.com`, true)), { max: 3 })).toHaveLength(3);
    const b = buildBook([seen("x@x.com", true, "## Mal\n<!-- x -->")]);
    expect(b[0].nome).not.toMatch(/\n|<!--|-->|^#/);
  });
});

describe("atualizar o banco de e-mails", () => {
  const r = (t: string) => looksLikeEmailBookRefresh(normalize(t));
  it("reconhece só o pedido explícito", () => {
    expect(r("atualizar banco de e-mails")).toBe(true);
    expect(r("atualizar o catálogo de endereços")).toBe(true);
    expect(r("sincronizar endereços")).toBe(true);
    expect(r("atualizar e-mails")).toBe(false);
    expect(r("atualizar contatos")).toBe(false);
  });
});

describe("busca por remetente com sufixo", () => {
  it("'emails do arnaud jr' procura só por arnaud no Gmail", () => {
    const spec = emailSearchSpec("buscar emails do arnaud jr");
    expect(spec?.gmail).toBe("(from:(arnaud) OR to:(arnaud))");
    expect(spec?.label).toBe("de arnaud");
  });
  it("mantém o nome completo quando não há sufixo", () => {
    expect(emailSearchSpec("emails do joao silva")?.gmail).toBe("(from:(joao silva) OR to:(joao silva))");
  });
});
