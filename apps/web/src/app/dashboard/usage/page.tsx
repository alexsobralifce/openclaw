"use client";

import { useEffect, useState } from "react";
import { api, type UsageReport } from "@/lib/api";
import { useMe } from "@/hooks/useMe";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const PERIODS = [7, 30, 90];
const nf = new Intl.NumberFormat("pt-BR");
const PROVIDERS: Record<string, string> = { openai: "OpenAI", gemini: "Gemini", whisper: "Whisper" };

export default function UsagePage() {
  const me = useMe();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (me && me.platformRole !== "ROOT") return;
    setError("");
    api.usage.report(days).then(setData).catch((e) => setError(e.message));
  }, [days, me]);

  if (me && me.platformRole !== "ROOT") return <div className="p-6 text-sm text-gray-500">Apenas o root vê o consumo de tokens.</div>;

  const max = Math.max(1, ...(data?.byDay.map((d) => d.tokens) ?? [1]));

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-5 h-full overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-200">Consumo de tokens</h1>
          <p className="text-sm text-gray-500 mt-1">Uso de IA (OpenAI, Gemini, Whisper) por usuário. Chamadas sem usuário (rotinas automáticas) aparecem como Sistema.</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setDays(p)} className={`${btn} ${days === p ? "bg-teal-500 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>{p} dias</button>
          ))}
        </div>
      </div>

      {error && <div className="text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-300">{error}</div>}
      {!data && !error && <p className="text-sm text-gray-500">Carregando...</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Total de tokens", data.total.totalTokens],
              ["Entrada", data.total.inputTokens],
              ["Saída", data.total.outputTokens],
              ["Chamadas", data.total.calls],
            ].map(([label, v]) => (
              <div key={label as string} className={card}>
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-lg font-semibold text-gray-200 tabular-nums">{nf.format(v as number)}</div>
              </div>
            ))}
          </div>

          <div className={card}>
            <h2 className="text-sm font-medium text-gray-300 mb-3">Por dia</h2>
            {data.byDay.length === 0 ? (
              <p className="text-sm text-gray-500">Sem consumo registrado neste período.</p>
            ) : (
              <div className="flex items-end gap-1 h-28" role="img" aria-label="Tokens por dia">
                {data.byDay.map((d) => (
                  <div key={d.day} title={`${d.day}: ${nf.format(d.tokens)} tokens`} className="flex-1 min-w-[3px] bg-teal-500/70 rounded-t" style={{ height: `${Math.max(3, (d.tokens / max) * 100)}%` }} />
                ))}
              </div>
            )}
          </div>

          <div className={`${card} overflow-x-auto`}>
            <h2 className="text-sm font-medium text-gray-300 mb-3">Por usuário</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3 font-medium">Usuário</th>
                  <th className="pb-2 pr-3 font-medium text-right">Tokens</th>
                  <th className="pb-2 pr-3 font-medium text-right">Entrada</th>
                  <th className="pb-2 pr-3 font-medium text-right">Saída</th>
                  <th className="pb-2 pr-3 font-medium text-right">Chamadas</th>
                  <th className="pb-2 font-medium">Provedores</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {data.users.map((u) => (
                  <tr key={u.userId} className="border-t border-gray-800 align-top">
                    <td className="py-2 pr-3">
                      <div className="text-gray-200">{u.name}</div>
                      <div className="text-xs text-gray-500">{u.email ?? "—"} · último uso {u.lastDay}</div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">{nf.format(u.totalTokens)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nf.format(u.inputTokens)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nf.format(u.outputTokens)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nf.format(u.calls)}</td>
                    <td className="py-2 text-xs text-gray-400">
                      {Object.entries(u.byProvider).map(([p, v]) => `${PROVIDERS[p] ?? p}: ${nf.format(v.tokens)}`).join(" · ")}
                    </td>
                  </tr>
                ))}
                {data.users.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-gray-500">Nenhum consumo registrado ainda. O contador começa a valer a partir do deploy.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
