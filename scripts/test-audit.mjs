#!/usr/bin/env node
// Auditoria da suíte (evidência para podar sem achismo; método da skill test-suite-curation): roda cada arquivo de teste sozinho com cobertura
// e mostra quantas linhas de código cada um cobre e quantas SÓ ELE cobre. Arquivo sem linhas exclusivas é CANDIDATO a poda: confira o que ele
// afirma (cobrir uma linha não é o mesmo que verificar o resultado) e use quarentena antes de apagar. Nada é apagado por este script.
// Uso: `pnpm test:audit` (leva alguns minutos). Roda em apps/api.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "oc-audit-"));
const specs = readdirSync("test").filter((f) => f.endsWith(".spec.ts")).sort();
const covered = new Map();
const tests = new Map();
const failed = [];

for (const f of specs) {
  const dir = join(tmp, f);
  tests.set(f, (readFileSync(`test/${f}`, "utf8").match(/^\s*it\(/gm) ?? []).length);
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", "--coverage", "--coverage.reporter=json", `--coverage.reportsDirectory=${dir}`, `test/${f}`], { stdio: "ignore" });
  } catch {
    failed.push(f);
    continue;
  }
  const cov = JSON.parse(readFileSync(join(dir, "coverage-final.json"), "utf8"));
  const lines = new Set();
  for (const [file, d] of Object.entries(cov)) for (const [id, n] of Object.entries(d.s)) if (n > 0) lines.add(`${file}:${d.statementMap[id].start.line}`);
  covered.set(f, lines);
}

const rows = [...covered.entries()].map(([f, lines]) => {
  const others = new Set();
  for (const [g, s] of covered) if (g !== f) for (const l of s) others.add(l);
  const unique = [...lines].filter((l) => !others.has(l)).length;
  return { f, tests: tests.get(f), lines: lines.size, unique };
});

console.log("arquivo".padEnd(36), "testes".padStart(6), "linhas".padStart(7), "exclusivas".padStart(11));
for (const r of rows.sort((a, b) => a.unique - b.unique || b.tests - a.tests)) console.log(r.f.padEnd(36), String(r.tests).padStart(6), String(r.lines).padStart(7), String(r.unique).padStart(11), r.unique === 0 ? "  ← candidato a poda" : "");
if (failed.length) console.log(`\nNão rodaram sozinhos (dependem de outro arquivo ou falharam): ${failed.join(", ")}`);
const total = new Set([...covered.values()].flatMap((s) => [...s])).size;
console.log(`\n${rows.length} arquivos, ${rows.reduce((n, r) => n + r.tests, 0)} testes, ${total} linhas cobertas no total`);
rmSync(tmp, { recursive: true, force: true });
