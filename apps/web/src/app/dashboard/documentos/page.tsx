"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocumentView } from "@/lib/api";
import { fileSizeLabel } from "@/lib/chat-file";

const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";

type Cat = { name: string; count: number };

/** Escolher a categoria de um documento: lista as que existem e cria uma nova se o nome digitado não existe. */
function CategoryPicker({ current, cats, onPick, onClose }: { current: string; cats: Cat[]; onPick: (name: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [idx, setIdx] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // clicar fora fecha (o botão que abre fica dentro do mesmo contêiner relativo)
  useEffect(() => {
    const out = (e: MouseEvent) => { if (!box.current?.parentElement?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [onClose]);
  const flat = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = flat(text.trim());
  const rows = cats.filter((c) => !q || flat(c.name).includes(q)).map((c) => ({ name: c.name, count: c.count, make: false }));
  const typed = text.trim();
  if (typed && !cats.some((c) => flat(c.name) === q)) rows.push({ name: typed[0].toUpperCase() + typed.slice(1), count: 0, make: true });
  const active = Math.min(idx, Math.max(rows.length - 1, 0));
  return (
    <div ref={box} role="dialog" aria-label="Escolher categoria" className="absolute right-0 top-full mt-1 z-20 w-64 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-2 space-y-1" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <input
        autoFocus
        value={text}
        maxLength={40}
        onChange={(e) => { setText(e.target.value); setIdx(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx(Math.min(active + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(active - 1, 0)); }
          else if (e.key === "Enter" && rows[active]) { e.preventDefault(); onPick(rows[active].name); }
        }}
        placeholder="Buscar ou criar categoria"
        aria-label="Buscar ou criar categoria"
        autoComplete="off"
        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
      />
      <ul className="max-h-52 overflow-y-auto">
        {rows.map((r, i) => (
          <li key={r.name}>
            <button onClick={() => onPick(r.name)} onMouseEnter={() => setIdx(i)} className={`w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5 text-sm ${i === active ? "bg-gray-800" : ""} ${r.make ? "text-violet-300 font-medium" : "text-gray-200"}`}>
              <span className="truncate">{r.make ? `Criar “${r.name}”` : r.name}{r.name === current ? " (atual)" : ""}</span>
              {!r.make && <span className="ml-auto text-xs text-gray-500 tabular-nums">{r.count}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-500 px-1">Digite um nome novo para criar a categoria.</p>
    </div>
  );
}

export default function DocumentosPage() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [category, setCategory] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [data, setData] = useState<{ documents: DocumentView[]; tags: { tag: string; count: number }[]; categories: Cat[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.documents.list(q, tag, category);
      setData(r);
      // a categoria filtrada deixou de existir (o último documento dela mudou de categoria): volta para Todos
      if (category && !r.categories.some((c) => c.name === category)) setCategory("");
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [q, tag, category]);

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

  async function setCategoryOf(d: DocumentView, name: string) {
    setPicking(null);
    if (name === d.topic) return;
    setBusy(d.id);
    try {
      await api.documents.update(d.id, { topic: name });
      await load(); // a lista e a contagem das categorias mudaram
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
          Seus PDFs guardados no Drive, com título, categoria, tags e resumo. Para guardar um novo, mande o PDF no{" "}
          <Link href="/dashboard/chat" className="text-violet-400 underline">chat do Assistente</Link> ou pelo WhatsApp.
        </p>
      </div>

      <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-5 space-y-4 md:space-y-0">
      <nav aria-label="Categorias" className="flex md:flex-col gap-1.5 md:gap-0.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:self-start md:sticky md:top-0">
        <h2 className="hidden md:block text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 pb-1.5">Categorias</h2>
        {[{ name: "", count: data?.total ?? 0 }, ...(data?.categories ?? [])].map((c) => (
          <button
            key={c.name || "todos"}
            onClick={() => setCategory(c.name)}
            aria-pressed={category === c.name}
            className={`flex items-center gap-2 whitespace-nowrap text-left text-sm rounded-full md:rounded-lg border md:border-transparent px-3 py-1.5 md:px-2 md:py-1.5 ${category === c.name ? "bg-gray-900 border-violet-500 md:border-transparent md:shadow-[inset_3px_0_0_rgb(139_92_246)] text-gray-100 font-medium" : "border-gray-800 text-gray-300 hover:bg-gray-800"}`}
          >
            <span className="truncate max-w-[10rem] md:max-w-none">{c.name || "Todos"}</span>
            <span className="md:ml-auto text-xs text-gray-500 tabular-nums">{c.count}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-5">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por categoria, tag, título ou resumo"
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
                  {new Date(d.createdAt).toLocaleDateString("pt-BR")}
                  {d.sizeBytes ? ` · ${fileSizeLabel(d.sizeBytes)}` : ""}
                  {d.pages ? ` · ${d.pages} pág.` : ""}
                  {d.kind === "nota" ? " · nota antiga" : ""}
                </p>
              </div>
              <div className="relative shrink-0">
                <button onClick={() => setPicking(picking === d.id ? null : d.id)} disabled={busy === d.id} aria-haspopup="dialog" aria-expanded={picking === d.id} aria-label={`Categoria ${d.topic}, mudar`} className={`${chip} bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 max-w-[10rem]`}>
                  <span className="truncate">{d.topic}</span>
                  <span aria-hidden className="text-[10px] opacity-70">▾</span>
                </button>
                {picking === d.id && <CategoryPicker current={d.topic} cats={data?.categories ?? []} onPick={(name) => void setCategoryOf(d, name)} onClose={() => setPicking(null)} />}
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
      </div>
    </div>
  );
}
