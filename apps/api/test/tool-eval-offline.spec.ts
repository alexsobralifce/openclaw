// Avaliação sem custo: com a escolha de ferramentas pelo assunto, a ferramenta certa continua disponível?
import { describe, expect, it, vi } from "vitest";
import cases from "./fixtures/tool-eval-cases.json";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { TOOLS } from "../src/modules/channels/assistant/assistant.service";
import { selectToolNames } from "../src/modules/channels/assistant/tool-select";

const size = (names: Set<string> | null) => JSON.stringify(names ? TOOLS.filter((t) => names.has(t.function.name)) : TOOLS).length;
const all = size(null);

describe("avaliação offline: escolha de ferramentas", () => {
  const withTools = cases.filter((c) => c.expect.length);

  it("a ferramenta esperada nunca fica de fora (recall de 100%)", () => {
    const misses = withTools.filter((c) => {
      const picked = selectToolNames(c.text);
      return picked !== null && !c.expect.some((e) => picked.has(e));
    });
    expect(misses.map((c) => `${c.text} → esperava ${c.expect.join("/")}`)).toEqual([]);
  });

  it("o corte médio de tamanho das ferramentas é relevante (resultado impresso)", () => {
    const sizes = cases.map((c) => size(selectToolNames(c.text)));
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const reduced = cases.filter((c) => selectToolNames(c.text) !== null).length;
    const cut = 1 - avg / all;
    console.log(`[avaliação] ${cases.length} casos · ${reduced} com ferramentas reduzidas · ${cases.length - reduced} com todas · corte médio ${(cut * 100).toFixed(0)}% do tamanho das ferramentas`);
    expect(cut).toBeGreaterThan(0.3);
  });

  it("perguntas gerais não levam ferramentas de ação por engano mais do que o necessário", () => {
    const geral = cases.filter((c) => c.area === "geral");
    for (const c of geral) {
      const picked = selectToolNames(c.text);
      expect(picked === null || !picked.has("gmail_send")).toBe(true);
    }
  });
});
