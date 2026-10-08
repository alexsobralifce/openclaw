"use client";

import { useState } from "react";
import { TOUR_EVENT } from "@/components/onboarding/WelcomeTour";
import { countDocs, filterDocs, MENU_DOCS, type DocNode } from "@/lib/menu-docs";

const chip = "inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

function Field({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="text-sm text-gray-300">
      <span className={`${chip} ${tone} mr-2`}>{label}</span>
      {children}
    </div>
  );
}

function Details({ n }: { n: DocNode }) {
  return (
    <div className="space-y-1.5">
      {n.needs && <Field label="Precisa de" tone="bg-amber-500/15 text-amber-300">{n.needs}</Field>}
      {!!n.say?.length && (
        <div className="text-sm text-gray-300">
          <span className={`${chip} bg-violet-500/15 text-violet-300 mr-2`}>Diga</span>
          {n.say.map((s) => (
            <code key={s} className="mr-1.5 mb-1 inline-block rounded bg-gray-800 px-1.5 py-0.5 text-[13px] text-gray-200">{s}</code>
          ))}
        </div>
      )}
      {n.add && <Field label="Adicionar" tone="bg-green-500/15 text-green-300">{n.add}</Field>}
      {n.remove && <Field label="Apagar" tone="bg-red-500/15 text-red-300">{n.remove}</Field>}
      {n.limits && <Field label="Atenção" tone="bg-gray-700/60 text-gray-300">{n.limits}</Field>}
    </div>
  );
}

function Node({ n, openAll, version }: { n: DocNode; openAll: boolean; version: number }) {
  const hasBody = !!(n.needs || n.say?.length || n.add || n.remove || n.limits || n.children?.length);
  const head = (
    <>
      <span aria-hidden className="mt-0.5 flex-shrink-0 text-lg leading-none">{n.icon}</span>
      <span className="min-w-0">
        <span className="font-medium text-gray-200">{n.title}</span>
        <span className="block text-sm text-gray-500">{n.summary}</span>
      </span>
    </>
  );
  if (!hasBody) return <li id={n.id} className="flex items-start gap-2 px-2 py-1.5 pl-8">{head}</li>;
  return (
    <li id={n.id}>
      {/* a chave troca quando o usuário usa "Abrir tudo", "Fechar tudo" ou a busca: remonta o item já no estado pedido */}
      <details key={`${version}-${openAll}`} open={openAll} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-800/60 [&::-webkit-details-marker]:hidden">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-1 flex-shrink-0 text-gray-500 transition-transform group-open:rotate-90"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {head}
        </summary>
        <div className="ml-4 mt-1 space-y-2 border-l border-gray-800 pl-4 pb-2">
          <Details n={n} />
          {!!n.children?.length && (
            <ul className="space-y-0.5">
              {n.children.map((c) => (
                <Node key={c.id} n={c} openAll={openAll} version={version} />
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

export default function AjudaPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState({ all: false, version: 0 });
  const searching = query.trim() !== "";
  const shown = filterDocs(MENU_DOCS, query);

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Ajuda: menu do assistente</h1>
        <p className="text-sm text-gray-500 mt-1">
          O que cada item do menu faz e como adicionar e apagar. Os mesmos comandos valem no WhatsApp, no app e no Telegram.
          Itens que a sua conta não tem liberados não aparecem no seu menu.
        </p>
        <button type="button" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))} className="mt-3 px-3 py-2 rounded-lg text-xs font-medium bg-violet-600/20 text-violet-300 hover:bg-violet-600/30">Ver o tour de boas-vindas</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar (ex.: apagar, música, agenda)"
          aria-label="Buscar na ajuda"
          autoComplete="off"
          className="flex-1 min-w-[12rem] bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
        />
        <button onClick={() => setOpen((o) => ({ all: true, version: o.version + 1 }))} className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700">Abrir tudo</button>
        <button onClick={() => setOpen((o) => ({ all: false, version: o.version + 1 }))} className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700">Fechar tudo</button>
      </div>

      {searching && <p className="text-xs text-gray-500" role="status">{shown.length ? `${countDocs(shown)} itens encontrados` : "Nada encontrado. Tente outra palavra, como “e-mail”, “agenda” ou “apagar”."}</p>}

      <ul className="space-y-0.5" aria-label="Menu do assistente">
        {shown.map((n) => (
          <Node key={n.id} n={n} openAll={searching || open.all} version={open.version} />
        ))}
      </ul>
    </div>
  );
}
