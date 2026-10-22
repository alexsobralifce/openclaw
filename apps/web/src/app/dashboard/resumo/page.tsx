"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api, type DocumentView } from "@/lib/api";
import { hasService, useMe } from "@/hooks/useMe";

type State<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: T };

/** Cada cartão busca os próprios dados: um que falha ou demora não trava os outros. */
function useCard<T>(enabled: boolean, load: () => Promise<T>): State<T> | null {
  const [state, setState] = useState<State<T>>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    load()
      .then((data) => alive && setState({ status: "ok", data }))
      .catch((e: Error) => alive && setState({ status: "error", message: e.message }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return enabled ? state : null;
}

const usd = (n: number) => `US$ ${n.toFixed(2)}`;

function Card({ title, href, linkLabel, state, children }: { title: string; href?: string; linkLabel?: string; state: State<unknown>; children?: ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 min-w-0" aria-busy={state.status === "loading"}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-300">{title}</h2>
        {href && <Link href={href} className="text-xs text-violet-400 hover:underline whitespace-nowrap">{linkLabel ?? "Abrir"} →</Link>}
      </header>
      {state.status === "loading" && (
        <div className="space-y-2" role="status" aria-label="Carregando">
          <div className="h-8 w-20 rounded bg-gray-800 animate-pulse" />
          <div className="h-3 w-full rounded bg-gray-800 animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-gray-800 animate-pulse" />
        </div>
      )}
      {state.status === "error" && <p className="text-xs text-gray-500">Não consegui carregar agora. {state.message}</p>}
      {state.status === "ok" && children}
    </section>
  );
}

/** Número grande com o que ele conta. */
const Big = ({ value, label }: { value: ReactNode; label: string }) => (
  <p className="flex items-baseline gap-2">
    <span className="text-3xl font-semibold text-gray-100 tabular-nums">{value}</span>
    <span className="text-xs text-gray-500">{label}</span>
  </p>
);

/** Barras horizontais proporcionais ao maior valor (o rótulo e o número ficam em texto, para leitura e acessibilidade). */
function Bars({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-xs text-gray-500">Nada por aqui ainda.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.name} className="text-xs">
          <div className="flex justify-between gap-2 text-gray-300">
            <span className="truncate">{r.name}</span>
            <span className="tabular-nums text-gray-500">{r.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 mt-0.5 overflow-hidden" aria-hidden>
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-violet-500/15 text-violet-300";

export default function ResumoPage() {
  const me = useMe();
  const has = (s: string) => !me || hasService(me, s);
  const ready = !!me;

  const docs = useCard(ready && has("drive"), () => api.documents.list());
  const notes = useCard(ready && has("drive"), () => api.assistant.notes());
  const contacts = useCard(ready && has("contacts"), () => api.contacts.list());
  const inbox = useCard(ready && has("inbox"), () => api.inbox.list());
  const vault = useCard(ready && has("vault"), async () => {
    const st = await api.vault.status();
    // Só a contagem: o conteúdo das senhas nunca passa por aqui
    return { exists: st.exists, unlocked: st.unlocked, count: st.exists && st.unlocked ? (await api.vault.list()).length : null };
  });
  const assistant = useCard(ready && has("assistant"), () => api.assistant.overview());
  const usage = useCard(ready, () => api.usage.mine());

  const cards = [docs, notes, contacts, inbox, vault, assistant, usage];
  const none = ready && cards.every((c) => c === null);

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-200">Resumo</h1>
          <p className="text-sm text-gray-500 mt-1">O que o MagoBox guarda para você, num relance.</p>
        </div>

        {none && <p className="text-sm text-gray-500">Nenhum serviço liberado para esta conta ainda.</p>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {docs && (
            <Card title="Documentos" href="/dashboard/documentos" state={docs}>
              {docs.status === "ok" && (
                <>
                  <Big value={docs.data.total} label={docs.data.total === 1 ? "documento guardado" : "documentos guardados"} />
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Por categoria</p>
                    <Bars rows={docs.data.categories.slice(0, 5)} />
                  </div>
                  {!!docs.data.tags.length && (
                    <div className="flex flex-wrap gap-1.5" aria-label="Tags mais usadas">
                      {docs.data.tags.slice(0, 8).map((t) => <span key={t.tag} className={chip}>#{t.tag} · {t.count}</span>)}
                    </div>
                  )}
                  {!!docs.data.documents.length && (
                    <ul className="text-xs text-gray-400 space-y-1 border-t border-gray-800 pt-2">
                      {docs.data.documents.slice(0, 3).map((d: DocumentView) => (
                        <li key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.title}</span><span className="text-gray-500 whitespace-nowrap">{new Date(d.createdAt).toLocaleDateString("pt-BR")}</span></li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>
          )}

          {notes && (
            <Card title="Notas" href="/dashboard/notes" state={notes}>
              {notes.status === "ok" && (() => {
                const total = notes.data.topics.reduce((n, t) => n + t.notes.length, 0);
                const rows = notes.data.topics.map((t) => ({ name: t.name, count: t.notes.length })).sort((a, b) => b.count - a.count).slice(0, 5);
                return (
                  <>
                    <Big value={total} label={`${total === 1 ? "nota" : "notas"} em ${notes.data.topics.length} ${notes.data.topics.length === 1 ? "assunto" : "assuntos"}`} />
                    <Bars rows={rows} />
                  </>
                );
              })()}
            </Card>
          )}

          {assistant && (
            <Card title="Rotina e memória" href="/dashboard/chat" linkLabel="Falar com o assistente" state={assistant}>
              {assistant.status === "ok" && (
                <>
                  <div className="flex gap-6">
                    <Big value={assistant.data.routine.total} label="na rotina" />
                    <Big value={assistant.data.memories} label="na memória" />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Hoje</p>
                    {assistant.data.routine.today.length ? (
                      <ul className="text-xs text-gray-300 space-y-1">
                        {assistant.data.routine.today.map((i) => (
                          <li key={i.topic + i.when} className="flex justify-between gap-2"><span className="truncate">{i.topic}</span><span className="text-gray-500 whitespace-nowrap">{i.when}</span></li>
                        ))}
                      </ul>
                    ) : <p className="text-xs text-gray-500">Nada marcado na rotina para hoje.</p>}
                  </div>
                </>
              )}
            </Card>
          )}

          {contacts && (
            <Card title="Contatos" href="/dashboard/contacts" state={contacts}>
              {contacts.status === "ok" && <Big value={contacts.data.length} label={contacts.data.length === 1 ? "contato" : "contatos"} />}
            </Card>
          )}

          {inbox && (
            <Card title="Conversas de clientes" href="/dashboard/inbox" state={inbox}>
              {inbox.status === "ok" && (() => {
                const open = inbox.data.filter((c: any) => c.status === "OPEN").length;
                return (
                  <>
                    <Big value={open} label={open === 1 ? "conversa aberta" : "conversas abertas"} />
                    <p className="text-xs text-gray-500">{inbox.data.length} no total</p>
                  </>
                );
              })()}
            </Card>
          )}

          {vault && (
            <Card title="Cofre de senhas" href="/dashboard/vault" state={vault}>
              {vault.status === "ok" && (
                !vault.data.exists ? <p className="text-xs text-gray-500">O cofre ainda não foi criado.</p>
                : vault.data.count !== null ? <Big value={vault.data.count} label={vault.data.count === 1 ? "senha guardada" : "senhas guardadas"} />
                : <p className="text-xs text-gray-400">🔒 Cofre trancado. Destranque para ver quantas senhas há.</p>
              )}
            </Card>
          )}

          {usage && (
            <Card title="Uso da IA no mês" state={usage}>
              {usage.status === "ok" && (() => {
                const { monthUsd, limitUsd, plan } = usage.data;
                const pct = limitUsd > 0 ? Math.min(100, (monthUsd / limitUsd) * 100) : 0;
                return (
                  <>
                    <Big value={usd(monthUsd)} label={limitUsd > 0 ? `de ${usd(limitUsd)}` : "sem teto definido"} />
                    {limitUsd > 0 && (
                      <div className="h-2 rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Uso do teto mensal de IA">
                        <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-violet-500"}`} style={{ width: `${Math.max(2, pct)}%` }} />
                      </div>
                    )}
                    {plan && <p className="text-xs text-gray-500">Plano {plan.name}</p>}
                  </>
                );
              })()}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
