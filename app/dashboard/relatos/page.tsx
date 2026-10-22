"use client";

import { useEffect, useState } from "react";
import { api, type BugReport } from "@/lib/api";
import { isAdmin, useMe } from "@/hooks/useMe";

const STATUS: Record<BugReport["status"], string> = { NOVO: "Novo", EM_ANALISE: "Em análise", RESOLVIDO: "Resolvido" };
const FILTERS: { id: string; label: string }[] = [{ id: "", label: "Todos" }, { id: "NOVO", label: "Novos" }, { id: "EM_ANALISE", label: "Em análise" }, { id: "RESOLVIDO", label: "Resolvidos" }];
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function ReportsPage() {
  const me = useMe();
  const [filter, setFilter] = useState("NOVO");
  const [items, setItems] = useState<BugReport[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (me && !isAdmin(me)) return;
    setError("");
    api.bugReports.list(filter || undefined).then(setItems).catch((e) => setError(e.message));
  }, [filter, me]);

  async function change(id: string, status: string) {
    try {
      const updated = await api.bugReports.setStatus(id, status);
      setItems((prev) => (prev ?? []).flatMap((r) => (r.id !== id ? [r] : filter && filter !== updated.status ? [] : [updated])));
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (me && !isAdmin(me)) return <div className="p-6 text-sm text-gray-500">Apenas administradores veem os relatos.</div>;

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Problemas relatados</h1>
        <p className="text-sm text-gray-500 mt-1">O que os usuários enviaram pelo botão “Relatar problema”.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === f.id ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>{f.label}</button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {items === null && !error && <p className="text-sm text-gray-500">Carregando…</p>}
      {items?.length === 0 && <p className="text-sm text-gray-500">Nenhum relato aqui.</p>}
      {items?.map((r) => (
        <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-200 font-medium">{r.userName} <span className="text-xs text-gray-500 font-normal">· {r.userEmail}</span></p>
            <p className="text-xs text-gray-500">{when(r.createdAt)}{r.page ? ` · ${r.page}` : ""}</p>
          </div>
          <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{r.message}</p>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Status
            <select value={r.status} onChange={(e) => void change(r.id, e.target.value)} className="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-200">
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
      ))}
    </div>
  );
}
