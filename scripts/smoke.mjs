#!/usr/bin/env node
// Teste de fumaça de ponta a ponta (de cima para baixo): confere o sistema NO AR, como um usuário de fora, sem login e sem alterar dados.
// Cada checagem existe porque já houve (ou poderia haver) um defeito que os testes com dublês não pegam: corpo JSON vazio em todo POST,
// rota protegida aberta, CORS aberto demais, página pública fora do ar. Uso: `pnpm smoke` (SMOKE_API e SMOKE_WEB trocam os endereços).
const API = (process.env.SMOKE_API || "https://api.magobox.com.br").replace(/\/$/, "");
const WEB = (process.env.SMOKE_WEB || "https://app.magobox.com.br").replace(/\/$/, "");
const SITE = (process.env.SMOKE_SITE || "https://www.magobox.com.br").replace(/\/$/, "");

const get = (url, init = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
const json = (body, extra = {}) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra });

const checks = [
  ["API saudável", async () => { const r = await get(`${API}/api/v1/health`); const b = await r.json(); return r.status === 200 && b.status === "ok" ? "" : `status ${r.status} ${JSON.stringify(b)}`; }],
  ["API lê JSON (login inválido = 401, não 400 de corpo vazio)", async () => { const r = await get(`${API}/api/v1/auth/login`, json({ email: "smoke@example.com", password: "x" })); return r.status === 401 ? "" : `esperado 401, veio ${r.status}`; }],
  ["API recusa ticket do Google inválido (401)", async () => { const r = await get(`${API}/api/v1/auth/google/exchange`, json({ ticket: "x" })); return r.status === 401 ? "" : `esperado 401, veio ${r.status}`; }],
  ...["/api/v1/auth/me", "/api/v1/documents", "/api/v1/app-chat/messages", "/api/v1/users", "/api/v1/vault/status"].map((p) => [`Rota protegida sem login: ${p}`, async () => { const r = await get(`${API}${p}`); return r.status === 401 ? "" : `esperado 401, veio ${r.status}`; }]),
  ["Spotify: rota protegida sem login (401) e callback sem código volta ao painel com erro", async () => {
    const a = await get(`${API}/api/v1/integrations/spotify/status`);
    const b = await get(`${API}/api/v1/integrations/spotify/callback`);
    return a.status === 401 && b.status === 302 && (b.headers.get("location") || "").endsWith("/dashboard/channels?spotify=error") ? "" : `status=${a.status} callback=${b.status} ${b.headers.get("location")}`;
  }],
  ["Webhook do Telegram sem o segredo (403)", async () => { const r = await get(`${API}/api/v1/channels/telegram/webhook`, json({ message: {} })); return r.status === 403 ? "" : `esperado 403, veio ${r.status}`; }],
  ["CORS: o painel é aceito e um site qualquer não", async () => {
    const ask = (origin) => get(`${API}/api/v1/auth/login`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
    const ok = (await ask(WEB)).headers.get("access-control-allow-origin");
    const bad = (await ask("https://site-qualquer.example")).headers.get("access-control-allow-origin");
    return ok === WEB && !bad ? "" : `painel=${ok} estranho=${bad}`;
  }],
  ["Login com Google redireciona ao Google", async () => { const r = await get(`${API}/api/v1/integrations/google/login`); const loc = r.headers.get("location") || ""; return r.status === 302 && loc.startsWith("https://accounts.google.com/") && loc.includes("openid") ? "" : `status ${r.status} ${loc.slice(0, 60)}`; }],
  ["Painel: login abre (200)", async () => { const r = await get(`${WEB}/auth/login`); return r.status === 200 ? "" : `veio ${r.status}`; }],
  ["Painel: área logada sem login redireciona (307)", async () => { const r = await get(`${WEB}/dashboard/chat`); return r.status === 307 ? "" : `esperado 307, veio ${r.status}`; }],
  ...["/privacidade", "/termos", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"].map((p) => [`Site público: ${p}`, async () => { const r = await get(`${SITE}${p}`); return r.status === 200 ? "" : `veio ${r.status}`; }]),
  ["Service worker sem cache", async () => { const r = await get(`${WEB}/sw.js`); const cc = r.headers.get("cache-control") || ""; return r.status === 200 && /no-cache|max-age=0/.test(cc) ? "" : `status ${r.status} cache-control="${cc}"`; }],
  ["Cabeçalho libera o microfone só para o próprio site", async () => { const r = await get(`${WEB}/auth/login`); const p = r.headers.get("permissions-policy") || ""; return p.includes("microphone=(self)") ? "" : `permissions-policy="${p}"`; }],
];

let failed = 0;
for (const [name, run] of checks) {
  let problem;
  try { problem = await run(); } catch (e) { problem = `erro: ${e.message}`; }
  if (problem) failed++;
  console.log(`${problem ? "✗" : "✓"} ${name}${problem ? `\n    ${problem}` : ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checagens ok${failed ? `, ${failed} com problema` : ""}`);
process.exit(failed ? 1 : 0);
