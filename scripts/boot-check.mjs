#!/usr/bin/env node
// Confere que a API SOBE (o Nest monta todas as dependências), sem banco de verdade e sem rede. Pega o defeito que os testes não pegam e que
// derruba a produção: dependência que o Nest não consegue injetar (ex.: `import type` num parâmetro de construtor). Como não há CI, rode antes do deploy.
// Uso: `pnpm boot-check` (compila a API e sobe por até 30 s).
import { execFileSync, spawn } from "node:child_process";

execFileSync("pnpm", ["--filter", "@openclaw/api", "build"], { stdio: "ignore" });
const child = spawn("node", ["dist/main"], {
  cwd: "apps/api",
  env: { ...process.env, PORT: "3998", DATABASE_URL: "postgresql://x:x@127.0.0.1:1/x", JWT_SECRET: "boot-check", WEBHOOK_SECRET: "boot-check" },
});
let log = "";
const done = (ok, msg) => {
  child.kill();
  console.log(ok ? `✓ a API sobe (${msg})` : `✗ a API NÃO sobe\n${msg}`);
  process.exit(ok ? 0 : 1);
};
const timer = setTimeout(() => done(false, "não terminou de subir em 30 s"), 30_000);
child.stdout.on("data", (d) => scan(d));
child.stderr.on("data", (d) => scan(d));
function scan(d) {
  log += d.toString();
  const bad = log.match(/Nest can't resolve[^\n]*|Cannot find module[^\n]*|TypeError[^\n]*/);
  if (bad) { clearTimeout(timer); done(false, bad[0].replace(/\x1b\[[0-9;]*m/g, "").slice(0, 400)); }
  if (/Nest application successfully started/.test(log)) { clearTimeout(timer); done(true, "dependências montadas e rotas registradas"); }
}
