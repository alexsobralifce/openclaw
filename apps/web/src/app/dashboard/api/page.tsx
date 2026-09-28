"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const SCOPE_LABEL: Record<string, string> = {
  "contacts:read": "Ler contatos",
  "contacts:write": "Criar/editar contatos",
  "conversations:read": "Ler conversas",
  "conversations:write": "Alterar conversas",
  "messages:read": "Ler mensagens",
  "messages:send": "Enviar WhatsApp",
  "email:read": "Ler e-mails",
  "email:send": "Enviar e-mails",
  "calendar:read": "Ler agenda",
  "calendar:write": "Criar eventos",
  "webhooks:manage": "Gerenciar webhooks",
};
const SENSITIVE = new Set(["email:read", "email:send", "calendar:read", "calendar:write", "messages:send"]);

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-teal-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const fmt = (d?: string) => (d ? new Date(d).toLocaleString("pt-BR") : "nunca");

export default function ApiPage() {
  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-10 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">API</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Chaves e webhooks para integrar CRM, site, BI, e-mail, agenda e WhatsApp.{" "}
          <a href="/api-publica.html" target="_blank" rel="noopener" className="text-teal-400 hover:underline">Ver projeto</a>{" · "}
          <a href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/public/v1/openapi.json`} target="_blank" rel="noopener" className="text-teal-400 hover:underline">OpenAPI</a>
        </p>
      </div>
      <Keys />
      <Webhooks />
    </div>
  );
}

function Keys() {
  const [keys, setKeys] = useState<any[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    try { setKeys(await api.apiKeys.list()); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => {
    load();
    api.apiKeys.scopes().then(setScopes).catch(() => {});
  }, []);

  async function create() {
    setErr("");
    try {
      const r = await api.apiKeys.create({ name, scopes: picked });
      setCreated(r.key);
      setName("");
      setPicked([]);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function revoke(id: string) {
    if (!confirm("Revogar esta chave? Os sistemas que a usam deixarão de funcionar.")) return;
    try { await api.apiKeys.revoke(id); load(); } catch (e: any) { setErr(e.message); }
  }

  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Chaves de API</h2>
      {err && <div className="mb-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">{err}</div>}

      {created && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <p className="text-sm text-amber-300 font-medium">Copie a chave agora. Ela não será mostrada de novo.</p>
          <code className="block mt-2 break-all text-xs text-gray-200 bg-gray-950 rounded p-2 select-all">{created}</code>
          <div className="mt-2 flex gap-2">
            <button className={`${btn} bg-teal-500 text-white hover:bg-teal-400`} onClick={() => navigator.clipboard?.writeText(created)}>Copiar</button>
            <button className={`${btn} border border-gray-700 text-gray-300 hover:bg-gray-800`} onClick={() => setCreated(null)}>Já guardei</button>
          </div>
        </div>
      )}

      <div className={`${card} mb-4 space-y-3`}>
        <input className={input} placeholder="Nome da chave (ex.: CRM, Site)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {scopes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={picked.includes(s)} onChange={() => toggle(s)} className="accent-teal-500" />
              {SCOPE_LABEL[s] ?? s}
              {SENSITIVE.has(s) && <span className="text-[9px] text-amber-400 uppercase">sensível</span>}
            </label>
          ))}
        </div>
        <button disabled={!name.trim() || !picked.length} onClick={create} className={`${btn} bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-40`}>
          Criar chave
        </button>
      </div>

      <div className="space-y-2">
        {keys.length === 0 && <p className="text-xs text-gray-600">Nenhuma chave criada.</p>}
        {keys.map((k) => (
          <div key={k.id} className={`${card} flex items-start gap-3 ${k.revokedAt ? "opacity-50" : ""}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-200">
                {k.name} <code className="text-xs text-gray-500 font-normal">{k.prefix}…</code>
                {k.revokedAt && <span className="ml-2 text-[10px] text-red-400 uppercase">revogada</span>}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {k.scopes.map((s: string) => SCOPE_LABEL[s] ?? s).join(" · ")}
              </p>
              <p className="text-[11px] text-gray-600 mt-0.5">Último uso: {fmt(k.lastUsed)} · {k.rateLimit} req/min</p>
            </div>
            {!k.revokedAt && (
              <button onClick={() => revoke(k.id)} className={`${btn} text-red-400 hover:bg-red-500/10`}>Revogar</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Webhooks() {
  const [hooks, setHooks] = useState<any[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [err, setErr] = useState("");

  async function load() {
    try { setHooks(await api.webhooks.list()); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => {
    load();
    api.webhooks.events().then(setEvents).catch(() => {});
  }, []);

  async function create() {
    setErr("");
    try {
      const r = await api.webhooks.create({ url, events: picked });
      setSecret(r.secret);
      setUrl("");
      setPicked([]);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function showDeliveries(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    try { setDeliveries((await api.webhooks.deliveries(id)).data); } catch (e: any) { setErr(e.message); }
  }

  const act = async (fn: () => Promise<any>, after?: () => void) => {
    setErr("");
    try { await fn(); after?.(); load(); } catch (e: any) { setErr(e.message); }
  };
  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const color = (s: string) => (s === "SUCCESS" ? "text-teal-400" : s === "FAILED" ? "text-red-400" : "text-amber-400");

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Webhooks</h2>
      {err && <div className="mb-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">{err}</div>}

      {secret && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <p className="text-sm text-amber-300 font-medium">Segredo de assinatura (não será mostrado de novo):</p>
          <code className="block mt-2 break-all text-xs text-gray-200 bg-gray-950 rounded p-2 select-all">{secret}</code>
          <button className={`${btn} mt-2 border border-gray-700 text-gray-300 hover:bg-gray-800`} onClick={() => setSecret(null)}>Já guardei</button>
        </div>
      )}

      <div className={`${card} mb-4 space-y-3`}>
        <input className={input} placeholder="https://seu-sistema.com/webhooks/openclaw" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {events.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={picked.includes(ev)} onChange={() => toggle(ev)} className="accent-teal-500" />
              <code>{ev}</code>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-gray-600">Sem seleção, recebe todos os eventos.</p>
        <button disabled={!url.trim()} onClick={create} className={`${btn} bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-40`}>
          Criar webhook
        </button>
      </div>

      <div className="space-y-2">
        {hooks.length === 0 && <p className="text-xs text-gray-600">Nenhum webhook cadastrado.</p>}
        {hooks.map((h) => (
          <div key={h.id} className={card}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-200 break-all">{h.url}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {h.events.join(", ")} ·{" "}
                  <span className={h.isActive ? "text-teal-400" : "text-red-400"}>{h.isActive ? "ativo" : "desativado por falhas"}</span>
                  {h.failureCount > 0 && ` · ${h.failureCount} falha(s)`}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => act(() => api.webhooks.test(h.id))} className={`${btn} border border-gray-700 text-gray-300 hover:bg-gray-800`}>Testar</button>
                <button onClick={() => showDeliveries(h.id)} className={`${btn} border border-gray-700 text-gray-300 hover:bg-gray-800`}>Entregas</button>
                <button
                  onClick={() => confirm("Remover este webhook?") && act(() => api.webhooks.remove(h.id))}
                  className={`${btn} text-red-400 hover:bg-red-500/10`}
                >
                  Remover
                </button>
              </div>
            </div>
            {open === h.id && (
              <div className="mt-3 border-t border-gray-800 pt-3 space-y-1">
                {deliveries.length === 0 && <p className="text-xs text-gray-600">Nenhuma entrega ainda.</p>}
                {deliveries.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 text-[11px]">
                    <code className="text-gray-400 w-44 truncate">{d.type}</code>
                    <span className={`${color(d.status)} w-16`}>{d.status}</span>
                    <span className="text-gray-500 flex-1 truncate">{d.lastError ?? (d.responseCode ? `HTTP ${d.responseCode}` : "")} · {d.attempts} tent.</span>
                    {d.status === "FAILED" && (
                      <button onClick={() => act(() => api.webhooks.retry(h.id, d.id), () => showDeliveries(h.id).then(() => showDeliveries(h.id)))} className="text-teal-400 hover:underline">
                        Reenviar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
