import { describe, expect, it } from "vitest";
import { buildDocGraph, searchGraph } from "../src/modules/channels/assistant/document-graph";
import type { DocLike } from "../src/modules/channels/assistant/documents";

const doc = (id: string, over: Partial<DocLike> & { createdAt?: string } = {}): DocLike => ({
  id,
  title: over.title ?? `Documento ${id}`,
  topic: over.topic ?? "",
  tags: over.tags ?? [],
  summary: over.summary ?? "",
  createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
});

describe("buildDocGraph e searchGraph", () => {
  it("mesma entrada devolve a mesma ordem, mesmo com os documentos embaralhados", () => {
    const docs = [
      doc("a", { topic: "Saúde", tags: ["unimed", "plano-de-saude"], title: "Carteirinha" }),
      doc("b", { tags: ["plano-de-saude"], title: "Reembolso" }),
      doc("c", { summary: "contrato com a unimed", title: "Contrato" }),
    ];
    const g1 = buildDocGraph(docs);
    const g2 = buildDocGraph([...docs].reverse());
    const r1 = searchGraph(g1, "unimed");
    expect(searchGraph(g1, "unimed")).toEqual(r1);
    expect(searchGraph(g2, "unimed")).toEqual(r1);
  });

  it("casamento por tag fica acima de casamento só no resumo", () => {
    const docs = [
      doc("resumo", { title: "Outro assunto", summary: "fala de saude de forma geral" }),
      doc("tag", { title: "Outro assunto", tags: ["saude"] }),
    ];
    const hits = searchGraph(buildDocGraph(docs), "saude");
    expect(hits.map((h) => h.id)).toEqual(["tag", "resumo"]);
    expect(hits[0].reasons).toContain("tag saude");
    expect(hits[1].reasons.length).toBeGreaterThan(0);
  });

  it("documento sem o termo, mas com tag vizinha forte, aparece com motivo de vizinha de tag", () => {
    const docs = [
      doc("a", { tags: ["unimed", "plano-de-saude"], title: "Carteirinha" }),
      doc("b", { tags: ["plano-de-saude"], title: "Reembolso de consulta" }),
    ];
    const hits = searchGraph(buildDocGraph(docs), "unimed");
    const b = hits.find((h) => h.id === "b");
    expect(b).toBeDefined();
    expect(b?.reasons).toContain("vizinha de tag unimed");
    expect(hits.every((h) => h.reasons.length >= 1)).toBe(true);
  });

  it("busca vazia devolve os documentos por data, mais novos primeiro", () => {
    const docs = [
      doc("antigo", { createdAt: "2025-01-01T00:00:00.000Z" }),
      doc("novo", { createdAt: "2026-06-01T00:00:00.000Z" }),
      doc("meio", { createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const hits = searchGraph(buildDocGraph(docs), "   ");
    expect(hits.map((h) => h.id)).toEqual(["novo", "meio", "antigo"]);
    expect(hits.every((h) => h.reasons.length >= 1)).toBe(true);
  });

  it("500 documentos: montar o grafo leva menos de 50 ms e a consulta menos de 20 ms", () => {
    const topics = ["Saúde", "Finanças", "Trabalho", "Viagem", "Casa"];
    const docs: DocLike[] = Array.from({ length: 500 }, (_, i) =>
      doc(`d${i}`, {
        title: `Documento ${i} sobre tema ${i % 37}`,
        topic: topics[i % topics.length],
        tags: [`tag-${i % 23}`, `outra-${i % 11}`, `geral-${i % 7}`],
        summary: `resumo do item ${i} com termos variados ${i % 19} e fornecedor ${i % 13}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
      }),
    );
    const t0 = performance.now();
    const graph = buildDocGraph(docs);
    const tBuild = performance.now() - t0;
    const t1 = performance.now();
    const hits = searchGraph(graph, "tag-3 fornecedor");
    const tSearch = performance.now() - t1;
    expect(tBuild).toBeLessThan(50);
    expect(tSearch).toBeLessThan(20);
    expect(hits.length).toBeGreaterThan(0);
  });
});
