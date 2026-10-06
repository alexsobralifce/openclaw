import { describe, expect, it } from "vitest";
import {
  applyTagEdit,
  categoryQuery,
  cleanCategory,
  docsInCategory,
  looksLikeCategoriesList,
  matchCategory,
  parseCategoryEdit,
  parseCategoryCreate,
  parseCategoryDelete,
  mergeCategories,
  topCategories,
  cleanTag,
  docFileName,
  docQuery,
  DocLike,
  docScore,
  isFileOriginNote,
  looksLikeDocsHome,
  looksLikeReclassify,
  looksLikeTagsList,
  parseDocPlan,
  parseTagEdit,
  sanitizeTags,
  searchDocs,
  searchTerms,
  tagsLine,
  topTags,
} from "../src/modules/channels/assistant/documents";
import { normalize } from "../src/modules/channels/assistant/voice";

const flat = normalize;
const doc = (id: string, title: string, topic: string, tags: string[], summary = "", day = "2026-10-01"): DocLike => ({ id, title, topic, tags, summary, createdAt: new Date(`${day}T10:00:00Z`) });

describe("tags", () => {
  it("ficam minúsculas, sem acento, com hífen e sem #", () => {
    expect(cleanTag("Plano de Saúde")).toBe("plano-de-saude");
    expect(cleanTag("#Imóvel!")).toBe("imovel");
    expect(cleanTag("  Finanças  ")).toBe("financas");
    expect(cleanTag("a".repeat(60)).length).toBeLessThanOrEqual(24);
    expect(cleanTag("---")).toBe("");
  });
  it("lista: sem vazias, sem repetidas, no máximo 8, aceita texto ou lista", () => {
    expect(sanitizeTags("contrato, aluguel e imóvel")).toEqual(["contrato", "aluguel", "imovel"]);
    expect(sanitizeTags("#contrato #aluguel #Contrato")).toEqual(["contrato", "aluguel"]);
    expect(sanitizeTags(["Saúde", "saude", "x", "", "exame"])).toEqual(["saude", "exame"]);
    expect(sanitizeTags(Array.from({ length: 20 }, (_, i) => `tag${i}`))).toHaveLength(8);
    expect(sanitizeTags(null)).toEqual([]);
  });
  it("aplica edição: trocar, acrescentar, tirar", () => {
    expect(applyTagEdit(["a1", "b2"], { mode: "set", tags: ["novo"] })).toEqual(["novo"]);
    expect(applyTagEdit(["contrato"], { mode: "add", tags: ["aluguel", "contrato"] })).toEqual(["contrato", "aluguel"]);
    expect(applyTagEdit(["contrato", "aluguel"], { mode: "remove", tags: ["aluguel"] })).toEqual(["contrato"]);
    expect(applyTagEdit(["contrato"], { mode: "remove", tags: ["inexistente"] })).toEqual(["contrato"]);
  });
  it("mostra como #tags", () => {
    expect(tagsLine(["contrato", "aluguel"])).toBe("#contrato #aluguel");
    expect(tagsLine([])).toBe("");
  });
});

describe("ficha vinda da IA", () => {
  it("lê título, assunto, tags e resumo, limpando tudo", () => {
    const raw = '```json\n{"titulo":"Contrato de aluguel / casa","assunto":"contratos","tags":["Aluguel","Imóvel","aluguel"],"resumo":"Contrato  de 12 meses\\ncom reajuste anual.","erro":null}\n```';
    const { doc: d, error } = parseDocPlan(raw);
    expect(error).toBeUndefined();
    expect(d).toEqual({ title: "Contrato de aluguel casa", topic: "Contratos", tags: ["aluguel", "imovel"], summary: "Contrato de 12 meses com reajuste anual." });
  });
  it("sem conteúdo aproveitável devolve o motivo; resumo longo é cortado", () => {
    expect(parseDocPlan('{"titulo":"","resumo":"","erro":"PDF escaneado, sem texto"}').error).toBe("PDF escaneado, sem texto");
    expect(parseDocPlan("não é json").error).toBeTruthy();
    expect(parseDocPlan(JSON.stringify({ titulo: "X", resumo: "y".repeat(2000) })).doc!.summary.length).toBe(500);
  });
  it("assunto vazio vira Geral e sem tags fica sem tags", () => {
    expect(parseDocPlan('{"titulo":"Recibo","resumo":"Recibo de pagamento"}').doc).toMatchObject({ topic: "Geral", tags: [] });
  });
  it("nome do arquivo guardado", () => {
    expect(docFileName("2026-10-04", "Contrato / aluguel")).toBe("2026-10-04 Contrato aluguel.pdf");
  });
});

describe("busca por tag, título, assunto e resumo", () => {
  const docs = [
    doc("1", "Contrato de aluguel", "Contratos", ["contrato", "aluguel", "imovel"], "Aluguel de 12 meses", "2026-10-01"),
    doc("2", "Exame de sangue", "Saúde", ["saude", "exame"], "Resultado do hemograma", "2026-10-03"),
    doc("3", "Contrato de estágio", "Contratos", ["contrato", "estagio"], "Estágio na empresa X", "2026-10-02"),
    doc("4", "Apólice do plano", "Seguros", ["plano-de-saude", "seguro"], "Plano de saúde familiar", "2026-09-20"),
  ];
  const ids = (q: string) => searchDocs(docs, q).map((d) => d.id);

  it("tira as palavras de pedido e fica com o que importa", () => {
    expect(searchTerms("documentos com a tag contrato")).toEqual(["contrato"]);
    expect(searchTerms("me mostra os pdfs sobre plano de saúde")).toEqual(["plano", "saude"]);
  });
  it("acha pela tag, e o mais novo vem primeiro no empate", () => {
    expect(ids("contrato")).toEqual(["3", "1"]);
    expect(ids("tag aluguel")).toEqual(["1"]);
  });
  it("acha pelo título, pelo assunto e pelo resumo, sem acento nem maiúscula", () => {
    expect(ids("EXAME")).toEqual(["2"]);
    expect(ids("seguros")).toEqual(["4"]);
    expect(ids("hemograma")).toEqual(["2"]);
    expect(ids("estagio")).toEqual(["3"]);
  });
  it("tag composta casa por parte e por inteiro", () => {
    expect(ids("plano-de-saude")).toContain("4");
    expect(ids("saude")).toEqual(expect.arrayContaining(["2", "4"]));
  });
  it("todos os termos precisam bater; tag pesa mais que resumo", () => {
    expect(ids("contrato aluguel")).toEqual(["1"]);
    expect(ids("contrato saude")).toEqual([]);
    expect(docScore(docs[0], ["aluguel"])).toBeGreaterThan(docScore({ ...docs[0], tags: [] }, ["aluguel"]));
  });
  it("sem termos devolve todos, do mais novo ao mais antigo; sem acerto devolve nada", () => {
    expect(ids("documentos")).toEqual(["2", "3", "1", "4"]);
    expect(ids("xyzkw")).toEqual([]);
  });
  it("conta as tags mais usadas", () => {
    expect(topTags(docs, 2)).toEqual([{ tag: "contrato", count: 2 }, { tag: "aluguel", count: 1 }]);
    expect(topTags([])).toEqual([]);
  });
});

describe("comandos do catálogo", () => {
  it("abrir o catálogo e ver as tags", () => {
    for (const t of ["documentos", "meus documentos", "ver pdfs", "biblioteca", "abrir catalogo"]) expect(looksLikeDocsHome(flat(t)), t).toBe(true);
    for (const t of ["documentos com a tag contrato", "quero ler o pdf", "tags do documento 2: a"]) expect(looksLikeDocsHome(flat(t)), t).toBe(false);
    for (const t of ["tags", "minhas tags", "ver tags", "quais são as tags"]) expect(looksLikeTagsList(flat(t)), t).toBe(true);
  });
  it("buscar por tag, assunto ou nome", () => {
    expect(docQuery(flat("documentos com a tag contrato"))).toBe("contrato");
    expect(docQuery(flat("me mostra os pdfs sobre aluguel"))).toBe("aluguel");
    expect(docQuery(flat("quero o documento do plano de saúde"))).toBe("plano de saude");
    expect(docQuery(flat("tag contrato"))).toBe("contrato");
    expect(docQuery(flat("buscar documentos de estágio"))).toBe("estagio");
  });
  it("não sequestra outros pedidos", () => {
    expect(docQuery(flat("documentos"))).toBeNull();
    expect(docQuery(flat("agenda de hoje"))).toBeNull();
    expect(docQuery(flat("quero a música catingueira"))).toBeNull();
    expect(docQuery(flat("documentos com a tag"))).toBeNull();
  });
  it("editar tags: trocar, acrescentar, tirar, com ou sem número do documento", () => {
    expect(parseTagEdit("Tags: contrato, aluguel")).toEqual({ mode: "set", tags: ["contrato", "aluguel"] });
    expect(parseTagEdit(("tags do documento 2: contrato, aluguel"))).toEqual({ mode: "set", tags: ["contrato", "aluguel"], n: 2 });
    expect(parseTagEdit(("adicionar tag imóvel"))).toEqual({ mode: "add", tags: ["imovel"] });
    expect(parseTagEdit(("adicionar tags no documento 3: saúde e exame"))).toEqual({ mode: "add", tags: ["saude", "exame"], n: 3 });
    expect(parseTagEdit(("tirar tag antigo"))).toEqual({ mode: "remove", tags: ["antigo"] });
    expect(parseTagEdit(("remover tag do documento 1 contrato"))).toEqual({ mode: "remove", tags: ["contrato"], n: 1 });
  });
  it("frases que não são edição de tag", () => {
    for (const t of ["tags", "adicionar na agenda", "tirar spam", "apagar", "tags:", "documentos"]) expect(parseTagEdit((t)), t).toBeNull();
  });
});

describe("reclassificar notas antigas", () => {
  it("reconhece o pedido", () => {
    for (const t of ["reclassificar notas", "reclassificar documentos", "catalogar meus pdfs antigos", "catalogar as notas de pdf", "continuar reclassificação", "reclassificar as notas antigas com tags"]) expect(looksLikeReclassify(flat(t)), t).toBe(true);
    for (const t of ["notas", "documentos", "apagar notas", "classificar", "documentos com a tag contrato"]) expect(looksLikeReclassify(flat(t)), t).toBe(false);
  });
  it("só nota que veio de arquivo (PDF/foto) conta", () => {
    expect(isFileOriginNote("---\nassunto: Contratos\ncriada: 2026-10-01\norigem: arquivo\ntags: [contratos]\n---\n# Contrato")).toBe(true);
    expect(isFileOriginNote("---\nassunto: Geral\norigem: whatsapp\ntags: [geral]\n---\n# Nota")).toBe(false);
    expect(isFileOriginNote("# Sem propriedades\norigem: arquivo")).toBe(false);
    expect(isFileOriginNote("---\nassunto: A\n---\ntexto com origem: arquivo no corpo")).toBe(false);
  });
});

describe("categorias dos documentos", () => {
  const d = (topic: string, createdAt = "2026-10-01"): any => ({ id: topic + createdAt, title: "x", topic, tags: [], summary: "", createdAt });

  it("agrupa nomes iguais sem diferenciar acento ou maiúscula e conta", () => {
    const cats = topCategories([d("Saúde"), d("saude", "2026-10-02"), d("Saúde", "2026-10-03"), d("Finanças"), d("")]);
    expect(cats).toEqual([{ name: "Saúde", count: 3 }, { name: "Finanças", count: 1 }]);
  });

  it("filtra a categoria, do mais novo ao mais antigo", () => {
    const docs = [d("Saúde", "2026-10-01"), d("Finanças"), d("saude", "2026-10-05")];
    expect(docsInCategory(docs, "SAÚDE").map((x) => x.createdAt)).toEqual(["2026-10-05", "2026-10-01"]);
  });

  it("acha a categoria pelo nome ou pelo começo único", () => {
    const cats = [{ name: "Finanças", count: 2 }, { name: "Faculdade", count: 1 }];
    expect(matchCategory(cats, "financas")?.name).toBe("Finanças");
    expect(matchCategory(cats, "fin")?.name).toBe("Finanças");
    expect(matchCategory(cats, "f")).toBeNull();
    expect(matchCategory(cats, "saude")).toBeNull();
  });

  it("limpa o nome da categoria", () => {
    expect(cleanCategory("  saúde   e *bem-estar* ")).toBe("Saúde e bem-estar");
    expect(cleanCategory("x".repeat(80))).toHaveLength(40);
    expect(cleanCategory(null)).toBe("");
  });

  it("entende os comandos de categoria", () => {
    expect(looksLikeCategoriesList("categorias")).toBe(true);
    expect(looksLikeCategoriesList("minhas categorias")).toBe(true);
    expect(looksLikeCategoriesList("categoria saude")).toBe(false);
    expect(categoryQuery("categoria saude")).toBe("saude");
    expect(categoryQuery("documentos da categoria financas")).toBe("financas");
    expect(categoryQuery("categorias")).toBeNull();
    expect(parseCategoryEdit("categoria: Saúde")).toEqual({ name: "Saúde" });
    expect(parseCategoryEdit("Categoria do documento 2: finanças")).toEqual({ name: "Finanças", n: 2 });
    expect(parseCategoryEdit("mudar categoria para Trabalho")).toEqual({ name: "Trabalho" });
    expect(parseCategoryEdit("categoria educação")).toBeNull();
    expect(parseCategoryEdit("tags: saúde")).toBeNull();
  });
});

describe("criar e apagar categorias (texto)", () => {
  it("entende criar e apagar, com o nome limpo", () => {
    expect(parseCategoryCreate("criar categoria saúde")).toBe("Saúde");
    expect(parseCategoryCreate("Nova categoria: Viagens")).toBe("Viagens");
    expect(parseCategoryCreate("adicionar uma nova categoria chamada Faculdade")).toBe("Faculdade");
    expect(parseCategoryCreate("criar categoria")).toBeNull();
    expect(parseCategoryCreate("categoria saúde")).toBeNull();
    expect(parseCategoryDelete("apagar categoria saude")).toBe("saude");
    expect(parseCategoryDelete("excluir a categoria: viagens")).toBe("viagens");
    expect(parseCategoryDelete("apagar documento")).toBeNull();
  });

  it("junta as categorias dos documentos com as criadas à mão, sem repetir", () => {
    const merged = mergeCategories([{ name: "Saúde", count: 2 }], ["saude", "Faculdade"]);
    expect(merged).toEqual([{ name: "Saúde", count: 2 }, { name: "Faculdade", count: 0 }]);
  });
});
