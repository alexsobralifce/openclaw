"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type DocumentView } from "@/lib/api";
import { fileSizeLabel } from "@/lib/chat-file";

const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";

export default function DocumentosPage() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [data, setData] = useState<{ documents: DocumentView[]; tags: { tag: string; count: number }[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.documents.list(q, tag));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [q, tag]);

  // Busca com um pequeno atraso, para não consultar a cada letra
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function setTags(d: DocumentView, tags: string[]) {
    setBusy(d.id);
    try {
      const updated = await api.documents.update(d.id, { tags });
      setData((cur) => (cur ? { ...cur, documents: cur.documents.map((x) => (x.id === d.id ? updated : x)) } : cur));
      void load(); // a contagem das tags mudou
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function addTag(d: DocumentView) {
    const t = newTag.trim();
    if (!t) return;
    setNewTag("");
    await setTags(d, [...d.tags, t]);
  }

  async function download(d: DocumentView) {
    setBusy(d.id);
    setError("");
    try {
      const blob = await api.documents.download(d.id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${d.title}.${d.kind === "pdf" ? "pdf" : "md"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      if (e.link) window.open(e.link, "_blank", "noopener");
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: DocumentView) {
    setBusy(d.id);
    try {
      await api.documents.remove(d.id);
      setConfirm(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const docs = data?.documents ?? [];

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-5 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Documentos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Seus PDFs guardados no Drive, com título, assunto, tags e resumo. Para guardar um novo, mande o PDF no{" "}
          <Link href="/dashboard/chat" className="text-violet-400 underline">chat do Assistente</Link> ou pelo WhatsApp.
        </p>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por tag, título, assunto ou resumo"
        aria-label="Buscar documentos"
        autoComplete="off"
        className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
      />

      {!!data?.tags.length && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tag">
          <button onClick={() => setTag("")} className={`${chip} ${tag === "" ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>Todas ({data.total})</button>
          {data.tags.map((t) => (
            <button key={t.tag} onClick={() => setTag(tag === t.tag ? "" : t.tag)} aria-pressed={tag === t.tag} className={`${chip} ${tag === t.tag ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
              #{t.tag} ({t.count})
            </button>
          ))}
        </div>
      )}

      {error && <div className="text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-300" role="alert">{error}</div>}
      {!data && !error && <p className="text-sm text-gray-500">Carregando...</p>}
      {data && !docs.length && (
        <p className="text-sm text-gray-500">{data.total ? "Nenhum documento com essa busca." : "Ainda não há documentos guardados."}</p>
      )}

      <ul className="space-y-3">
        {docs.map((d) => (
          <li key={d.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
            <div className="flex items-start gap-3">
              <span aria-hidden className="text-2xl leading-none">{d.kind === "pdf" ? "📄" : "📝"}</span>
              <div className="min-w-0 flex-1">
                <h2 className="font-medium text-gray-200 break-words">{d.title}</h2>
                <p className="text-xs text-gray-500">
                  {d.topic} · {new Date(d.createdAt).toLocaleDateString("pt-BR")}
                  {d.sizeBytes ? ` · ${fileSizeLabel(d.sizeBytes)}` : ""}
                  {d.pages ? ` · ${d.pages} pág.` : ""}
                  {d.kind === "nota" ? " · nota antiga" : ""}
                </p>
              </div>
            </div>

            {d.summary && <p className="text-sm text-gray-400 line-clamp-3">{d.summary}</p>}

            <div className="flex flex-wrap items-center gap-1.5">
              {d.tags.length === 0 && <span className="text-xs text-gray-500">sem tags</span>}
              {d.tags.map((t) => (
                <span key={t} className={`${chip} bg-violet-500/15 text-violet-300`}>
                  #{t}
                  {editing === d.id && (
                    <button onClick={() => void setTags(d, d.tags.filter((x) => x !== t))} disabled={busy === d.id} aria-label={`Tirar a tag ${t}`} className="ml-0.5 text-violet-300 hover:text-red-300 disabled:opacity-50">×</button>
                  )}
                </span>
              ))}
              {editing === d.id && d.tags.length < 8 && (
                <form onSubmit={(e) => { e.preventDefault(); void addTag(d); }} className="inline-flex gap-1">
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="nova tag" aria-label="Nova tag" maxLength={24} className="w-28 bg-gray-800 border border-gray-700 rounded-full px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-violet-500" />
                  <button type="submit" disabled={!newTag.trim() || busy === d.id} className={`${chip} bg-violet-500 text-white disabled:opacity-40`}>+</button>
                </form>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => void download(d)} disabled={busy === d.id} className={`${btn} bg-violet-500 text-white disabled:opacity-50`}>⬇ Baixar</button>
              <button onClick={() => { setEditing(editing === d.id ? null : d.id); setNewTag(""); }} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>{editing === d.id ? "Concluir edição" : "Editar tags"}</button>
              {confirm === d.id ? (
                <span className="inline-flex items-center gap-2 text-xs text-gray-300">
                  {d.kind === "pdf" ? "Vai para a lixeira do Drive (30 dias)." : "Só sai do catálogo."}
                  <button onClick={() => void remove(d)} disabled={busy === d.id} className={`${btn} bg-red-500 text-white disabled:opacity-50`}>Apagar</button>
                  <button onClick={() => setConfirm(null)} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Cancelar</button>
                </span>
              ) : (
                <button onClick={() => setConfirm(d.id)} className={`${btn} bg-gray-800 text-red-300 hover:bg-gray-700`}>Apagar</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
