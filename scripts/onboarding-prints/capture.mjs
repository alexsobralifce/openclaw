// Tira os prints do tour de boas-vindas (public/onboarding/<passo>-desktop|mobile.webp) com contas de DEMONSTRAÇÃO.
// Pré-requisitos (tudo local): Postgres do docker-compose.dev.yml, API em PRINTS_API (3011) e web em PRINTS_WEB (3010).
// Veja docs/TOUR-PRINTS.md para subir cada peça. Uso: pnpm prints:onboarding
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DEMO, NOVO, seed } from "./seed.mjs";

const WEB = process.env.PRINTS_WEB || "http://localhost:3010";
const OUT = new URL("../../apps/web/public/onboarding/", import.meta.url).pathname;
const TMP = new URL("./.tmp/", import.meta.url).pathname;
const SENHA_MESTRA = "frase-longa-de-demonstracao-2026";

const VIEWS = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// Esconde o indicador do `next dev` e contorna o elemento que o passo quer mostrar
const HIDE_DEV = "nextjs-portal{display:none!important}";
async function mark(page, locator) {
  await page.addStyleTag({ content: HIDE_DEV });
  if (!locator) return;
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  await el.evaluate((n) => {
    // véu escuro sobre a tela e o elemento por cima, com contorno roxo
    const veu = document.createElement("div");
    veu.style.cssText = "position:fixed;inset:0;background:rgba(15,10,40,.30);z-index:40;pointer-events:none";
    document.body.appendChild(veu);
    n.style.outline = "3px solid #8b5cf6";
    n.style.outlineOffset = "4px";
    n.style.position = n.style.position || "relative";
    n.style.zIndex = "50";
  });
  await page.waitForTimeout(150);
}

async function shot(page, id, kind) {
  mkdirSync(OUT, { recursive: true });
  const png = await page.screenshot({ type: "png" });
  const info = await sharp(png).webp({ quality: 78 }).toFile(`${OUT}${id}-${kind}.webp`);
  console.log(`  ${id}-${kind}.webp  ${(info.size / 1024).toFixed(0)} KB`);
}

async function login(page, u) {
  await page.goto(`${WEB}/auth/login`);
  await page.fill("input[type=email]", u.email);
  await page.fill("input[type=password]", u.password);
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/, { timeout: 30000 });
}

async function open(page, path, ready) {
  await page.goto(`${WEB}/dashboard/${path}`, { waitUntil: "networkidle" });
  if (ready) await ready.first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
}

const openMenu = async (page, kind) => {
  if (kind !== "mobile") return page.locator("aside");
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.waitForTimeout(400);
  return page.locator('[aria-label="Menu"]').first();
};

async function run(kind) {
  console.log(`\n${kind}`);
  const browser = await chromium.launch();
  try {
    await passos(browser, kind);
  } catch (e) {
    // deixa um print do que estava na tela quando falhou, para achar o motivo
    mkdirSync(TMP, { recursive: true });
    for (const [n, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: `${TMP}falha-${n}.png` }).catch(() => undefined);
    console.error(`Falhou (prints do erro em ${TMP})`);
    throw e;
  } finally {
    await browser.close();
  }
}

async function passos(browser, kind) {

  // Ana: conta com plano, para as telas internas
  const ana = await browser.newContext({ ...VIEWS[kind], colorScheme: "light", locale: "pt-BR" });
  const p = await ana.newPage();
  await login(p, DEMO);

  await open(p, "resumo", p.getByRole("heading", { name: "Resumo" }));
  await mark(p);
  await shot(p, "boas-vindas", kind);

  await open(p, "resumo", p.getByRole("heading", { name: "Resumo" }));
  const menu = await openMenu(p, kind);
  await mark(p, menu);
  await shot(p, "menus", kind);
  if (kind === "mobile") await p.reload();

  await open(p, "chat", p.getByPlaceholder("Escreva uma mensagem"));
  await mark(p, p.getByPlaceholder("Escreva uma mensagem"));
  await shot(p, "assistente", kind);

  await open(p, "channels", p.getByRole("button", { name: "Conectar Google" }));
  await mark(p, p.getByRole("button", { name: "Conectar Google" }));
  await shot(p, "google", kind);

  await open(p, "documentos", p.getByText("Contrato de aluguel"));
  await mark(p);
  await shot(p, "documentos", kind);

  // Cofre: o formulário vazio, depois criar de verdade (conta demo) e abrir "Nova entrada"
  await open(p, "vault", p.getByRole("heading", { name: "Criar o cofre" }));
  await mark(p, p.getByRole("heading", { name: "Criar o cofre" }).locator(".."));
  await shot(p, "cofre-senha", kind);
  if (await p.getByRole("button", { name: "Criar cofre" }).count()) {
    const campos = p.locator("input[type=password]");
    await campos.nth(0).fill(SENHA_MESTRA);
    await campos.nth(1).fill(SENHA_MESTRA);
    await p.getByRole("button", { name: "Criar cofre" }).click();
    await p.getByText("Guardei a chave de recuperação").click();
    await p.getByRole("button", { name: "Continuar" }).click();
  }
  await p.getByRole("button", { name: "Nova entrada" }).waitFor({ timeout: 20000 }).catch(async (e) => { await p.screenshot({ path: "/private/tmp/claude-501/-Users-alexandrerocha-openclaw/368c0829-0ba2-44ba-aa4d-514b00d90348/scratchpad/err.png" }); throw e; });
  await p.getByRole("button", { name: "Nova entrada" }).click();
  await p.getByPlaceholder("Ex.: GitHub").fill("Banco Exemplo");
  await p.getByPlaceholder("https://...").fill("https://banco.exemplo.com.br");
  await p.locator("label", { hasText: "Usuário ou e-mail de entrada" }).locator("input").fill("ana@exemplo.com");
  await p.getByText("Senha", { exact: true }).locator("..").locator("input").fill("Exemplo#Senha-2026");
  await mark(p, p.getByRole("heading", { name: "Nova entrada" }).locator(".."));
  await shot(p, "cofre-salvar", kind);
  await ana.close();

  // Novo usuário (sem plano): a tela de Assinatura aparece como a pessoa a vê no 1º acesso
  const novo = await browser.newContext({ ...VIEWS[kind], colorScheme: "light", locale: "pt-BR" });
  const q = await novo.newPage();
  await login(q, NOVO);
  // sem plano, a API manda este usuário para Configurações sozinha; o redirecionamento pode abortar o goto
  await q.goto(`${WEB}/dashboard/settings`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await q.getByRole("heading", { name: "Assinatura" }).waitFor({ timeout: 20000 });
  await q.waitForTimeout(800);
  // o tour abre sozinho para esta conta: fecha para fotografar a tela de baixo
  const pular = q.getByRole("button", { name: "Pular" });
  if (await pular.count()) await pular.click();
  await mark(q, q.getByRole("heading", { name: "Assinatura" }).locator("../.."));
  await shot(q, "assinar", kind);
  await shot(q, "pronto", kind);
  await novo.close();
}

rmSync(TMP, { recursive: true, force: true });
await seed();
// O cofre só pode ser criado uma vez por conta e a criação tem limite por hora: antes de cada rodada (computador e celular)
// apaga o cofre da Ana e os contadores de limite do banco LOCAL, para o passo "criar a senha mestra" sempre sair igual.
function resetCofre() {
  const sql = [
    `DELETE FROM "VaultBlock" WHERE "vaultId" IN (SELECT id FROM "Vault" WHERE "userId" IN (SELECT id FROM "User" WHERE email='${DEMO.email}'))`,
    `DELETE FROM "Vault" WHERE "userId" IN (SELECT id FROM "User" WHERE email='${DEMO.email}')`,
    `DELETE FROM "KvEntry" WHERE key LIKE 'rl:%'`,
  ];
  execFileSync("docker", ["exec", "openclaw-postgres-1", "psql", "-U", "openclaw", "-d", "openclaw", ...sql.flatMap((q) => ["-c", q])], { stdio: "ignore" });
}
for (const kind of ["desktop", "mobile"]) {
  resetCofre();
  await run(kind);
}
console.log("\nPronto. Confira os arquivos em apps/web/public/onboarding/ antes de fazer commit.");
