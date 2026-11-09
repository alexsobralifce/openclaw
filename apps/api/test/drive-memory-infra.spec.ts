import { describe, expect, it, vi } from "vitest";

const rows: any[] = [];
vi.mock("@magobox/database", () => ({
  prisma: {
    memory: {
      findMany: async ({ where }: any) => rows.filter((r) => r.workspaceId === where.workspaceId && (where.kind?.not ? r.kind !== where.kind.not : where.kind ? r.kind === where.kind : true)),
      findFirst: async ({ where }: any) => rows.find((r) => r.workspaceId === where.workspaceId && (where.content ? r.content === where.content : true) && (where.kind?.not ? r.kind !== where.kind.not : true)) ?? null,
      count: async ({ where }: any) => rows.filter((r) => r.workspaceId === where.workspaceId && (where.kind?.not ? r.kind !== where.kind.not : true)).length,
      create: async ({ data }: any) => void rows.push({ id: `m${rows.length + 1}`, createdAt: new Date(), ...data }),
      updateMany: async ({ where, data }: any) => void rows.filter((r) => r.id === where.id).forEach((r) => Object.assign(r, data)),
      delete: async ({ where }: any) => void rows.splice(rows.findIndex((r) => r.id === where.id), 1),
      deleteMany: async ({ where }: any) => void rows.splice(rows.findIndex((r) => r.id === where.id), 1),
    },
  },
}));

import { GoogleService } from "../src/modules/integrations/google/google.service";
import { MemoryService } from "../src/modules/channels/assistant/memory.service";

function drive() {
  const g = vi.fn(async () => ({ files: [] }));
  const svc = Object.create(GoogleService.prototype) as any;
  svc.g = g;
  const qOf = (i: number) => new URL((g.mock.calls[i] as any)[2]).searchParams.get("q")!;
  return { svc: svc as GoogleService, g, qOf };
}

describe("consultas ao Drive", () => {
  it("strict: todas as palavras no nome + filtro de tipo, com aspas escapadas", async () => {
    const { svc, qOf } = drive();
    await svc.driveSearch("w", { terms: ["Evidências", "D'Ávila"], kind: "audio" }, "a@x.com", 6, "strict");
    const q = qOf(0);
    expect(q).toContain("name contains 'Evidências' and name contains 'D\\'Ávila'");
    expect(q).toContain("mimeType contains 'audio/'");
    expect(q).toContain("trashed=false");
    expect(q).toContain("!='application/vnd.google-apps.folder'");
  });

  it("fuzzy: qualquer palavra/variação no nome; depois sem o tipo; depois no conteúdo", async () => {
    const { svc, qOf, g } = drive();
    await svc.driveSearch("w", { terms: ["Relatórios"], alternates: ["balanço"], kind: "pdf" }, "a@x.com", 6, "fuzzy");
    expect(g).toHaveBeenCalledTimes(4);
    expect(qOf(0)).toMatch(/name contains 'relatorios' or .*name contains 'relatorio'.* or .*name contains 'balanço'/);
    expect(qOf(0)).toContain("application/pdf");
    expect(qOf(1)).not.toContain("application/pdf");
    expect(qOf(2)).toContain("fullText contains 'relatorio'");
  });

  it("para na primeira consulta que achar algo", async () => {
    const { svc, g } = drive();
    g.mockResolvedValueOnce({ files: [{ id: "1", name: "Relatório.pdf", mimeType: "application/pdf", size: "10", modifiedTime: "2026-01-01", webViewLink: "l" }] } as any);
    const r = await svc.driveSearch("w", { terms: ["relatorio"] }, "a@x.com", 6, "fuzzy");
    expect(g).toHaveBeenCalledTimes(1);
    expect(r[0]).toMatchObject({ id: "1", nome: "Relatório.pdf", tamanho: 10 });
  });

  it("sem palavras e sem tipo não consulta nada; erros viram mensagem clara", async () => {
    const { svc, g } = drive();
    expect(await svc.driveSearch("w", { terms: [] }, "a@x.com")).toEqual([]);
    expect(g).not.toHaveBeenCalled();
    g.mockRejectedValueOnce(new Error("Google API 403: ACCESS_TOKEN_SCOPE_INSUFFICIENT"));
    await expect(svc.driveSearch("w", { terms: ["x"] }, "a@x.com")).rejects.toThrow("Reconecte o Google");
    g.mockRejectedValueOnce(new Error("Google API 403: SERVICE_DISABLED"));
    await expect(svc.driveSearch("w", { terms: ["x"] }, "a@x.com")).rejects.toThrow("Google Drive API");
  });
});

describe("rotina na memória", () => {
  it("o mesmo tema atualiza em vez de duplicar; remover por tema; fatos comuns ficam separados", async () => {
    rows.length = 0;
    const mem = new MemoryService();
    expect((await mem.setRoutine("w", { topic: "Aulas", description: "Cálculo", days: [2], time: "19:00" })).updated).toBe(false);
    expect((await mem.setRoutine("w", { topic: "aulas", description: "Cálculo", days: [3], time: "20:00" })).updated).toBe(true);
    const list = await mem.listRoutine("w");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ days: [3], time: "20:00" });

    await mem.add("w", "prefere respostas curtas");
    expect((await mem.list("w")).map((m) => m.content)).toEqual(["prefere respostas curtas"]);
    const prompt = await mem.promptBlock("w");
    expect(prompt).toContain("Rotina do dono");
    expect(prompt).toContain("aulas (qua · 20:00): Cálculo");
    expect(prompt).toContain("prefere respostas curtas");

    // Estourar o teto de memórias comuns nunca apaga a rotina
    for (let i = 0; i < 105; i++) await mem.add("w", `fato ${i}`);
    expect(await mem.listRoutine("w")).toHaveLength(1);

    expect(await mem.removeRoutine("w", "AULAS")).toBe(true);
    expect(await mem.removeRoutine("w", "AULAS")).toBe(false);
  });
});
