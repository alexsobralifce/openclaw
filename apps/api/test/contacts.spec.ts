import { describe, expect, it } from "vitest";
import { normalize } from "../src/modules/channels/assistant/voice";
import {
  contactQuery,
  Contact,
  fileOfLetter,
  findContacts,
  fromPerson,
  groupByLetter,
  letterOf,
  looksLikeContactsRefresh,
  parseLetterFile,
  renderLetterFile,
} from "../src/modules/channels/assistant/contacts";

const person = (nome: string, phones: string[] = [], emails: string[] = [], org?: string) => ({
  names: [{ displayName: nome }],
  phoneNumbers: phones.map((value) => ({ value })),
  emailAddresses: emails.map((value) => ({ value })),
  ...(org ? { organizations: [{ name: org }] } : {}),
});

describe("fromPerson", () => {
  it("pega nome, telefones, e-mails e empresa", () => {
    expect(fromPerson(person("Marcos Silva", ["(85) 99999-0000"], ["Marcos@Empresa.com"], "IFCE"))).toEqual({
      nome: "Marcos Silva",
      telefones: ["(85) 99999-0000"],
      emails: ["marcos@empresa.com"],
      empresa: "IFCE",
    });
  });
  it("descarta quem não tem nome, ou não tem telefone nem e-mail", () => {
    expect(fromPerson(person("", ["85999990000"]))).toBeNull();
    expect(fromPerson(person("Sem Contato"))).toBeNull();
    expect(fromPerson({})).toBeNull();
  });
  it("ignora e-mail e telefone inválidos", () => {
    expect(fromPerson(person("A B", ["123", "abc"], ["nao-e-email"]))).toBeNull();
    expect(fromPerson(person("A B", ["123", "+55 85 98888-7777"]))?.telefones).toEqual(["+55 85 98888-7777"]);
  });
  it("não deixa o nome quebrar o Markdown (título, comentário, quebra de linha)", () => {
    const c = fromPerson(person("## Evil\n# Outro <!-- x --> nome", ["85999990000"]))!;
    expect(c.nome).not.toMatch(/[\n#]|<!--|-->/);
    const md = renderLetterFile("E", [c], "2026-10-01");
    expect(parseLetterFile(md)).toHaveLength(1);
  });
  it("limita a 5 telefones e 5 e-mails sem repetir", () => {
    const c = fromPerson(person("Muitos", Array.from({ length: 9 }, (_, i) => `8599999000${i}`), ["a@x.com", "a@x.com", "b@x.com"]))!;
    expect(c.telefones).toHaveLength(5);
    expect(c.emails).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("letras e arquivos", () => {
  it("letra é a inicial sem acento; o resto vai para #", () => {
    expect(letterOf("Álvaro Souza")).toBe("A");
    expect(letterOf("marcos")).toBe("M");
    expect(letterOf("123 Pizzaria")).toBe("#");
    expect(letterOf("🙂 Fulano")).toBe("#");
    expect(fileOfLetter("M")).toBe("M.md");
    expect(fileOfLetter("#")).toBe("Outros.md");
  });
  it("agrupa por letra, em ordem alfabética e sem repetir o mesmo contato", () => {
    const cs: Contact[] = [
      { nome: "Maria", telefones: ["85911112222"], emails: [] },
      { nome: "Marcos", telefones: [], emails: ["m@x.com"] },
      { nome: "Maria", telefones: ["85911112222"], emails: [] },
      { nome: "Ana", telefones: ["85900001111"], emails: [] },
    ];
    const g = groupByLetter(cs);
    expect([...g.keys()].sort()).toEqual(["A", "M"]);
    expect(g.get("M")!.map((c) => c.nome)).toEqual(["Marcos", "Maria"]);
  });
});

describe("arquivo da letra", () => {
  const cs: Contact[] = [
    { nome: "Marcos Silva", telefones: ["(85) 99999-0000", "(85) 3222-1111"], emails: ["marcos@empresa.com"], empresa: "IFCE" },
    { nome: "Maria Souza", telefones: [], emails: ["maria@x.com"] },
  ];
  it("tem aviso de gerado automaticamente e um bloco por pessoa", () => {
    const md = renderLetterFile("M", cs, "2026-10-01");
    expect(md).toContain("# Contatos — M");
    expect(md).toContain("Gerado automaticamente pelo MagoBox em 2026-10-01");
    expect(md).toContain("## Marcos Silva\n- 📞 (85) 99999-0000\n- 📞 (85) 3222-1111\n- ✉️ marcos@empresa.com\n- 🏢 IFCE");
  });
  it("ler de volta devolve os mesmos contatos", () => {
    expect(parseLetterFile(renderLetterFile("M", cs, "2026-10-01"))).toEqual(cs);
  });
  it("letra sem contatos fica com um aviso e nenhum bloco", () => {
    const md = renderLetterFile("Z", [], "2026-10-01");
    expect(md).toContain("Nenhum contato");
    expect(parseLetterFile(md)).toEqual([]);
  });
});

describe("findContacts", () => {
  const cs: Contact[] = [
    { nome: "Marcos Silva", telefones: ["1"], emails: [] },
    { nome: "Marcos", telefones: ["2"], emails: [] },
    { nome: "Maria Marcos", telefones: ["3"], emails: [] },
    { nome: "João Pedro Silva", telefones: ["4"], emails: [] },
  ];
  it("acha por nome, sobrenome e prefixo, sem acento nem maiúscula", () => {
    expect(findContacts(cs, "joao").map((c) => c.nome)).toEqual(["João Pedro Silva"]);
    expect(findContacts(cs, "silva").map((c) => c.nome)).toEqual(["João Pedro Silva", "Marcos Silva"]);
    expect(findContacts(cs, "marc silva").map((c) => c.nome)).toEqual(["Marcos Silva"]);
  });
  it("nome exato primeiro, depois quem começa com a palavra", () => {
    expect(findContacts(cs, "marcos").map((c) => c.nome)).toEqual(["Marcos", "Marcos Silva", "Maria Marcos"]);
  });
  it("busca vazia ou sem acerto devolve nada, e respeita o máximo", () => {
    expect(findContacts(cs, "")).toEqual([]);
    expect(findContacts(cs, "xyz")).toEqual([]);
    expect(findContacts(cs, "marcos", 1)).toHaveLength(1);
  });
});

describe("findContacts: nomes que não batem exatamente", () => {
  const c = (nome: string): Contact => ({ nome, telefones: [], emails: [] });
  const names = (list: Contact[], q: string) => findContacts(list, q).map((x) => x.nome);

  it("ignora sufixo no pedido: 'arnaud jr' acha 'Arnaud'", () => {
    expect(names([c("Arnaud"), c("Maria")], "arnaud jr")).toEqual(["Arnaud"]);
    expect(names([c("Arnaud Souza"), c("Maria")], "Arnaud Junior")).toEqual(["Arnaud Souza"]);
  });
  it("se o sufixo está cadastrado, o nome completo continua ganhando", () => {
    expect(names([c("Arnaud"), c("Arnaud Jr")], "arnaud jr")).toEqual(["Arnaud Jr"]);
  });
  it("ignora ligações: 'maria da silva' acha 'Maria Silva'", () => {
    expect(names([c("Maria Silva"), c("Pedro")], "maria da silva")).toEqual(["Maria Silva"]);
  });
  it("sobrenome que não está cadastrado cai no primeiro nome, mais parecidos primeiro", () => {
    expect(names([c("Arnaud Souza"), c("Maria")], "arnaud costa")).toEqual(["Arnaud Souza"]);
    // quem bate em todas as palavras vence; o primeiro nome só entra quando ninguém bate
    expect(names([c("Arnaud Souza"), c("Arnaud Costa Lima")], "arnaud costa")).toEqual(["Arnaud Costa Lima"]);
    expect(names([c("Arnaud Souza"), c("Arnaud Pereira")], "arnaud costa")).toEqual(["Arnaud Pereira", "Arnaud Souza"]);
  });
  it("não inventa: nome desconhecido, ou só sufixo, não acha ninguém", () => {
    expect(names([c("Maria")], "arnaud jr")).toEqual([]);
    expect(names([c("Arnaud")], "jr")).toEqual([]);
  });
});

describe("comandos", () => {
  const q = (t: string) => contactQuery(normalize(t));
  it("reconhece pedidos de telefone e e-mail por nome", () => {
    expect(q("qual o telefone do Marcos?")).toBe("marcos");
    expect(q("email da Maria Souza")).toBe("maria souza");
    expect(q("contato do João")).toBe("joao");
    expect(q("me passa o numero da Ana por favor")).toBe("ana");
    expect(q("whatsapp do Pedro")).toBe("pedro");
  });
  it("não sequestra os comandos de e-mail", () => {
    expect(q("ler e-mails")).toBeNull();
    expect(q("e-mails de hoje")).toBeNull();
    expect(q("email de hoje")).toBeNull();
    expect(q("o email")).toBeNull();
    expect(q("apague os emails 1 a 3")).toBeNull();
  });
  it("atualizar contatos", () => {
    const r = (t: string) => looksLikeContactsRefresh(normalize(t));
    expect(r("atualizar contatos")).toBe(true);
    expect(r("importar meus contatos do google")).toBe(true);
    expect(r("sincroniza os contatos")).toBe(true);
    expect(r("contatos")).toBe(false);
    expect(r("telefone do marcos")).toBe(false);
  });
});
