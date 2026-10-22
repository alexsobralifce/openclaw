import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

/**
 * Camadas de teste (detalhes em docs/TESTES.md). O arquivo vai para a camada pelo que importa, sem precisar renomear:
 * - unit: lógica pura (a base da pirâmide: rápida, sem dublês de serviço). Roda primeiro (bottom-up).
 * - flow: fluxos por menu, assistente, controllers e serviços com dublês do Google/banco (integração, de cima para baixo).
 */
const FLOW = /menu\.service|assistant\.service|\.controller|app-chat\.service|google\.service|inbound\.service|auth\.service|vault\.service|users\.service|webhooks\.service|inbox\.service|body-parsers|AppModule|@nestjs\/testing/;
const files = readdirSync("test").filter((f) => f.endsWith(".spec.ts"));
const flow = files.filter((f) => FLOW.test(readFileSync(`test/${f}`, "utf8"))).map((f) => `test/${f}`);
const unit = files.map((f) => `test/${f}`).filter((f) => !flow.includes(f));

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      { test: { name: "unit", include: unit, environment: "node" } },
      { test: { name: "flow", include: flow, environment: "node" } },
    ],
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/main.ts", "src/**/*.module.ts", "src/**/dto*.ts"], reporter: ["text-summary", "json-summary"] },
  },
});
