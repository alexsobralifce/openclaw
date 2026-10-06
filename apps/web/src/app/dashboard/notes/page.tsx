"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ListNote, type NoteItem } from "@/lib/api";

const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40";
const primary = `${btn} bg-violet-500 text-white hover:bg-violet-400`;
const ghost = `${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`;

/** Valor do campo datetime-local ("2026-10-07T09:00") no horário do navegador. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function NoteCard({ note, onChange, onDelete, onError }: { note: ListNote; onChange: (n: ListNote) => void; onDelete: (id: string) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [add, setAdd] = useState("");
  const [when, setWhen] = useState(toLocalInput(note.remindAt));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const done = note.items.filter((i) => i.done).length;
  const pending = !!note.remindAt && !note.remindedAt;

  async function save(patch: { title?: string; items?: NoteItem[]; remindAt?: string | null }) {
    setBusy(true);
    try {
      const n = await api.notes.update(note.id, patch);
      onChange(n);
      setTitle(n.title);
      setWhen(toLocalInput(n.remindAt));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const setItems = (items: NoteItem[]) => save({ items });
  const addItems = () => {
    const texts = add.split(/\n|[;,]/).map((t) => t.trim()).filter(Boolean);
    if (!texts.length) return;
    setAdd("");
    void setItems([...note.items, ...texts.map((text) => ({ text, done: false }))]);
  };

  return (
    <li className="bg-gray-900 border border-gray-800 rounded-xl">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center gap-3 text-left px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-200 truncate">{note.title}</span>
          <span className="block text-xs text-gray-500">
            {note.items.length} {note.items.length === 1 ? "item" : "itens"}{done ? ` · ${done} feitos` : ""}
            {pending && <span className="text-violet-300"> · ⏰ {fmtWhen(note.remindAt!)}</span>}
          </span>
        </span>
        <span aria-hidden className="text-gray-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800 pt-3">
          <div className="flex gap-2">
            <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} aria-label="Título da nota" className={input} />
            <button onClick={() => void save({ title })} disabled={busy || title.trim().length < 2 || title === note.title} className={primary}>Salvar</button>
          </div>

          <ul className="space-y-1">
            {note.items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <input type="checkbox" checked={it.done} disabled={busy} onChange={() => void setItems(note.items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} aria-label={`Marcar ${it.text}`} className="accent-violet-500 w-4 h-4 shrink-0" />
                {editing === i ? (
                  <form className="flex flex-1 gap-1.5" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) void setItems(note.items.map((x, j) => (j === i ? { ...x, text: t } : x))); setEditing(null); }}>
                    <input autoFocus value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} aria-label="Texto do item" className={input} />
                    <button type="submit" className={primary}>OK</button>
                  </form>
                ) : (
                  <>
                    <span className={`flex-1 min-w-0 text-sm break-words ${it.done ? "line-through text-gray-500" : "text-gray-200"}`}>{it.text}</span>
                    <button onClick={() => { setEditing(i); setDraft(it.text); }} aria-label={`Editar ${it.text}`} title="Editar" className="text-gray-500 hover:text-gray-200 w-7 h-7 shrink-0">✏️</button>
                    <button onClick={() => void setItems(note.items.filter((_, j) => j !== i))} disabled={busy} aria-label={`Tirar ${it.text}`} title="Tirar" className="text-gray-500 hover:text-red-300 w-7 h-7 shrink-0">×</button>
                  </>
                )}
              </li>
            ))}
            {!note.items.length && <li className="text-xs text-gray-500">Sem itens ainda.</li>}
          </ul>

          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addItems(); }}>
            <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Novo item (ou vários, separados por vírgula)" aria-label="Novo item" className={input} />
            <button type="submit" disabled={busy || !add.trim()} className={primary}>Adicionar</button>
          </form>

          <div className="space-y-1.5">
            <label className="block text-xs text-gray-400" htmlFor={`when-${note.id}`}>⏰ Receber esta nota como lembrete</label>
            <div className="flex flex-wrap gap-2">
              <input id={`when-${note.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${input} sm:w-auto`} />
              <button onClick={() => void save({ remindAt: new Date(when).toISOString() })} disabled={busy || !when} className={primary}>{pending ? "Mudar lembrete" : "Marcar lembrete"}</button>
              {note.remindAt && <button onClick={() => void save({ remindAt: null })} disabled={busy} className={ghost}>Tirar lembrete</button>}
            </div>
            {note.remindAt && !pending && <p className="text-xs text-gray-500">Lembrete enviado em {fmtWhen(note.remindAt)}.</p>}
            <p className="text-[11px] text-gray-500">A mensagem chega pelo seu canal principal do assistente (WhatsApp, app ou Telegram).</p>
          </div>

          <div className="flex justify-end">
            {confirm ? (
              <span className="flex items-center gap-2 text-xs text-red-200" role="alertdialog" aria-label="Apagar a nota?">
                Apagar “{note.title}”?
                <button onClick={() => onDelete(note.id)} className={`${btn} bg-red-500/80 text-white`}>Apagar</button>
                <button onClick={() => setConfirm(false)} className={ghost}>Cancelar</button>
              </span>
            ) : (
              <button onClick={() => setConfirm(true)} className={`${btn} text-red-300 hover:bg-gray-800`}>🗑️ Apagar nota</button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default function NotesPage() {
  const [notes, setNotes] = useState<ListNote[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes((await api.notes.list()).notes);
      setError("");
    } catch (e: any) {
      setNotes([]);
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const list = items.split(/\n|[;,]/).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, done: false }));
      const n = await api.notes.create({ title, items: list });
      setNotes((cur) => [n, ...(cur ?? [])]);
      setTitle("");
      setItems("");
      setCreating(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.notes.remove(id);
      setNotes((cur) => (cur ?? []).filter((n) => n.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4 h-full overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-200">Notas</h1>
          <p className="text-sm text-gray-500 mt-1">Listas com itens que você edita e marca. Escolha uma data e hora e o assistente manda a nota como lembrete.</p>
        </div>
        <button onClick={() => setCreating((v) => !v)} aria-expanded={creating} className={`${primary} px-4 py-2 text-sm`}>➕ Nova nota</button>
      </div>

      {error && <div className="text-xs rounded-lg px-3 py-2 bg-red-500/10 text-red-300" role="alert">{error}</div>}

      {creating && (
        <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3" aria-label="Nova nota">
          <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ex.: Compras)" aria-label="Título da nota" autoFocus className={input} />
          <textarea value={items} onChange={(e) => setItems(e.target.value)} rows={4} placeholder={"Itens, um por linha ou separados por vírgula\nleite\npão\novos"} aria-label="Itens da nota" className={`${input} resize-y`} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || title.trim().length < 2} className={primary}>{busy ? "Criando…" : "Criar nota"}</button>
            <button type="button" onClick={() => setCreating(false)} className={ghost}>Cancelar</button>
          </div>
        </form>
      )}

      {notes === null ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : notes.length ? (
        <ul className="space-y-2">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} onChange={(u) => setNotes((cur) => (cur ?? []).map((x) => (x.id === u.id ? u : x)))} onDelete={(id) => void remove(id)} onError={setError} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">Você ainda não tem notas. Crie a primeira, ou diga ao assistente: <em>nota Compras: leite, pão, ovos</em>.</p>
      )}
    </div>
  );
}
