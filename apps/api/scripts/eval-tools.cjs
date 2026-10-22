// Avaliação com serviços de verdade (gasta poucos centavos): escolha de ferramentas (palavras-chave + Jev), comportamento do
// chat com e sem corte de ferramentas, modelo reserva com ferramentas e pensamento do Gemini em PDF.
// Uso (precisa das chaves de produção; roda na sua máquina, nada é gravado no servidor):
//   pnpm --filter @openclaw/api build && railway run --service api node apps/api/scripts/eval-tools.cjs [fases: a,b,c,d]
const path = require("node:path");
const dist = (f) => require(path.join(__dirname, "..", "dist", "src", "modules", "channels", "assistant", f));
const cases = require("../test/fixtures/tool-eval-cases.json");

const phases = (process.argv[2] || "a,b,c,d").split(",");
const { TOOLS, systemPrompt, toolAllowed } = dist("assistant.service");
const { GROUP_IDS, pickTools, selectToolNames, JEV_INCLUDE_MIN, JEV_NONE_MAX } = dist("tool-select");
const { IntentService } = dist("intent.service");
const intents = new IntentService();

const groupsOfTool = {};
for (const id of GROUP_IDS) {
  // reaproveita a seleção por palavras para descobrir o grupo de cada ferramenta: usa uma frase-semente por assunto
}
// ferramenta → assuntos (derivado de TOOLS + pickTools por assunto, via texto-semente simples)
const SEEDS = { clientes: "conversas de clientes", memoria: "lembra que", email: "email", drive: "arquivo", contatos: "telefone de", notas: "anota", rotina: "minha rotina", clima: "clima", agenda: "agenda" };
for (const id of GROUP_IDS) for (const name of selectToolNames(SEEDS[id]) || []) (groupsOfTool[name] ??= new Set()).add(id);
const domainsOf = (expect) => new Set(expect.flatMap((n) => [...(groupsOfTool[n] || [])]));
const SYSTEM = systemPrompt("Teste", { name: "Fortaleza, CE", source: "saved" }, "");
const ALL = TOOLS.filter((t) => toolAllowed(["email", "calendar", "drive", "inbox", "assistant", "contacts"], t.function.name));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function openai(model, text, tools) {
  const body = { model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }], ...(tools.length ? { tools } : {}) };
  const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 160)}` };
  const d = await res.json();
  const m = d.choices[0].message;
  return { calls: (m.tool_calls || []).map((c) => c.function.name), prompt: d.usage?.prompt_tokens || 0, out: d.usage?.completion_tokens || 0, model: d.model };
}
const okCall = (c, r) => (c.expect.length === 0 ? r.calls.length === 0 : r.calls.length > 0 && r.calls.some((n) => c.expect.includes(n)));

(async () => {
  const report = {};
  // ── A. Escolha de ferramentas: palavras-chave, Jev sozinho e combinado ───────────────
  if (phases.includes("a")) {
    console.log(`\n== A. Escolha de ferramentas (${cases.length} casos) ==`);
    const withTools = cases.filter((c) => c.expect.length);
    const jev = await pool(cases, 6, async (c) => ({ c, j: await intents.toolDomains(c.text) }));
    const jevOk = jev.filter((x) => x.j);
    console.log(`Jev respondeu em ${jevOk.length}/${cases.length} casos`);
    let rec = 0, miss = [];
    for (const { c, j } of jevOk) {
      if (!c.expect.length) continue;
      const need = domainsOf(c.expect);
      if (j.some((x) => x.p >= JEV_INCLUDE_MIN && need.has(x.id))) rec++; else miss.push(`${c.text} → precisa ${[...need].join("/")}; Jev: ${j.filter((x) => x.p > 0.2).map((x) => `${x.id}=${x.p.toFixed(2)}`).join(", ") || "nada >0,2"}`);
    }
    const jevWith = jevOk.filter((x) => x.c.expect.length).length;
    console.log(`Jev sozinho, casos com ferramenta: recall ${pct(rec, jevWith)} (${rec}/${jevWith})`);
    miss.slice(0, 12).forEach((m) => console.log("  falha:", m));
    const gen = jevOk.filter((x) => !x.c.expect.length);
    const none = gen.filter((x) => x.j.every((d) => d.p < JEV_NONE_MAX)).length;
    const mid = gen.filter((x) => !x.j.every((d) => d.p < JEV_NONE_MAX) && !x.j.some((d) => d.p >= JEV_INCLUDE_MIN)).length;
    console.log(`Jev em conversa geral (${gen.length}): certeza de "nenhum assunto" ${none}, meio-termo ${mid}, apontou assunto ${gen.length - none - mid}`);
    // combinado (produção): palavras-chave primeiro, Jev se não reconhecerem
    let comb = 0, combMiss = [], allTools = 0, charsAll = JSON.stringify(ALL).length, sum = 0;
    const cache = new Map(jev.map((x) => [x.c.text, x.j]));
    for (const c of cases) {
      const picked = await pickTools(c.text, async (t) => cache.get(t) || null);
      const size = picked ? JSON.stringify(ALL.filter((t) => picked.has(t.function.name))).length : charsAll;
      sum += size; if (!picked) allTools++;
      if (c.expect.length && (!picked || c.expect.some((e) => picked.has(e)))) comb++; else if (c.expect.length) combMiss.push(c.text);
    }
    console.log(`Combinado (produção): recall ${pct(comb, withTools.length)} (${comb}/${withTools.length}) · ${allTools} casos com todas as ferramentas · corte médio ${pct(charsAll * cases.length - sum, charsAll * cases.length)} do tamanho das ferramentas`);
    combMiss.forEach((m) => console.log("  FALTOU ferramenta em:", m));
    report.a = { jevRecall: [rec, jevWith], combinedRecall: [comb, withTools.length], combMiss };
  }

  // ── B. Comportamento do chat: todas as ferramentas × só as escolhidas ─────────────────
  if (phases.includes("b")) {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    console.log(`\n== B. Chat (${model}): todas as ferramentas × escolhidas, ${cases.length} casos ==`);
    const cache = new Map();
    const rows = await pool(cases, 6, async (c) => {
      const j = await intents.toolDomains(c.text);
      const picked = await pickTools(c.text, async () => j);
      const tools = picked ? ALL.filter((t) => picked.has(t.function.name)) : ALL;
      const [base, cut] = await Promise.all([openai(model, c.text, ALL), picked ? openai(model, c.text, tools) : null]);
      return { c, base, cut: cut || base, reduced: !!picked };
    });
    const ok = rows.filter((r) => !r.base.error && !r.cut.error);
    const bOk = ok.filter((r) => okCall(r.c, r.base)).length, cOk = ok.filter((r) => okCall(r.c, r.cut)).length;
    const same = ok.filter((r) => JSON.stringify(r.base.calls) === JSON.stringify(r.cut.calls)).length;
    const pb = ok.reduce((a, r) => a + r.base.prompt, 0), pc = ok.reduce((a, r) => a + r.cut.prompt, 0);
    console.log(`Erros de API: ${rows.length - ok.length}`);
    console.log(`Acerto (ferramenta esperada): todas ${pct(bOk, ok.length)} · escolhidas ${pct(cOk, ok.length)}`);
    console.log(`Mesma decisão nas duas versões: ${pct(same, ok.length)}`);
    console.log(`Tokens de entrada: ${pb} → ${pc} (${pct(pb - pc, pb)} a menos)`);
    ok.filter((r) => okCall(r.c, r.base) && !okCall(r.c, r.cut)).forEach((r) => console.log(`  PIOROU: "${r.c.text}" esperava ${r.c.expect.join("/") || "nenhuma"}; todas→[${r.base.calls}] escolhidas→[${r.cut.calls}]`));
    ok.filter((r) => !okCall(r.c, r.base)).slice(0, 8).forEach((r) => console.log(`  (já errava com todas) "${r.c.text}" → [${r.base.calls}] esperava ${r.c.expect.join("/") || "nenhuma"}`));
    report.b = { baseOk: [bOk, ok.length], cutOk: [cOk, ok.length], tokens: [pb, pc] };
  }

  // ── C. Modelo reserva do chat, com as ferramentas ────────────────────────────────────
  if (phases.includes("c")) {
    const fb = process.env.OPENAI_FALLBACK_MODEL || "gpt-6-luna";
    const sample = cases.filter((_, i) => i % 3 === 0);
    console.log(`\n== C. Reserva ${fb} com ferramentas (${sample.length} casos) ==`);
    const rows = await pool(sample, 5, async (c) => {
      const j = await intents.toolDomains(c.text);
      const picked = await pickTools(c.text, async () => j);
      return { c, r: await openai(fb, c.text, picked ? ALL.filter((t) => picked.has(t.function.name)) : ALL) };
    });
    const errs = rows.filter((x) => x.r.error);
    errs.slice(0, 5).forEach((x) => console.log("  ERRO:", x.c.text, "→", x.r.error));
    const good = rows.filter((x) => !x.r.error);
    const valid = good.filter((x) => x.r.calls.every((n) => ALL.some((t) => t.function.name === n))).length;
    console.log(`Erros de API: ${errs.length}/${rows.length} · chamadas de ferramenta com nome válido: ${pct(valid, good.length)} · acerto: ${pct(good.filter((x) => okCall(x.c, x.r)).length, good.length)} · tokens de entrada médios: ${Math.round(good.reduce((a, x) => a + x.r.prompt, 0) / Math.max(1, good.length))} · modelo que respondeu: ${good[0]?.r.model || "?"}`);
    report.c = { errors: errs.length, total: rows.length };
  }

  // ── D. Pensamento do Gemini em PDF ───────────────────────────────────────────────────
  if (phases.includes("d")) {
    console.log("\n== D. Gemini: pensamento 'low' × padrão, leitura de PDF ==");
    const { makePdf, FACTS } = require("./sample-pdf.cjs");
    const pdf = makePdf().toString("base64");
    const prompt = 'Você transforma um documento em uma nota organizada, em português. Responda SOMENTE JSON: {"titulo":string,"assunto":string,"conteudo":string,"erro":string|null}. conteudo: Markdown com resumo de 2 a 4 linhas e pontos principais, mantendo datas, valores, prazos e nomes.';
    const models = [process.env.GEMINI_MODEL || "gemini-3.8-flash", process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite"];
    for (const model of models) {
      for (const level of ["low", null]) {
        const t0 = Date.now();
        const body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "application/pdf", data: pdf } }] }], ...(level ? { generationConfig: { thinkingConfig: { thinkingLevel: level } } } : {}) };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
        const label = `${model} · pensamento ${level || "padrão"}`;
        if (!res.ok) { console.log(`  ${label}: ERRO ${res.status} ${(await res.text()).slice(0, 140).replace(/\s+/g, " ")}`); continue; }
        const d = await res.json();
        const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        const u = d.usageMetadata || {};
        const found = FACTS.filter((f) => text.includes(f)).length;
        console.log(`  ${label}: entrada ${u.promptTokenCount} · saída ${u.candidatesTokenCount} · pensamento ${u.thoughtsTokenCount || 0} · fatos preservados ${found}/${FACTS.length} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    }
  }
  console.log("\nFim.");
})().catch((e) => { console.error("Falha na avaliação:", e); process.exit(1); });
