"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type NoteTopic } from "@/lib/api";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40";
const primary = `${btn} bg-teal-500 text-white hover:bg-teal-400`;
const ghost = `${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`;

type Open = { name: string; topic: string; content: string; link?: string };

/** Tira as propriedades do topo (--- ... ---) que o Obsidian lê; no painel só atrapalham a leitura. */
const body = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

export default function NotesPage() {
  const [topics, setTopics] = useState<NoteTopic[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [note, setNote] = useState<Open | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ topic: "", title: "", content: "" });

  const load = useCallback(async () => {
    try {
      const r = await api.assistant.notes();
      setTopics(r.topics);
      setCurrent((c) => (c && r.topics.some((t) => t.id === c) ? c : r.topics[0]?.id ?? null));
    } catch (e: any) {
      setTopics([]);
      setMsg({ ok: false, text: e.message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    setMsg(null);
    try {
      setNote(await api.assistant.note(id));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.assistant.createNote(form);
      setForm({ topic: "", title: "", content: "" });
      setMsg({ ok: true, text: `Nota criada em ${r.assunto}.` });
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const topic = topics?.find((t) => t.id === current);

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-5 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Notas</h1>
        <p className="text-sm text-gray-500 mt-1">Organizadas por assunto no seu Drive (pasta Assist.IA/Notas). Pelo WhatsApp, mande um PDF ou foto e eu crio a nota.</p>
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-teal-500/10 text-teal-300" : "bg-red-500/10 text-red-300"}`}>{msg.text}</div>}

      <div className={`${card} space-y-3`}>
        <h2 className="text-sm font-medium text-gray-300">Nova nota</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={input} placeholder="Assunto (ex.: Contratos)" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} aria-label="Assunto" />
          <input className={input} placeholder="Título (opcional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Título" />
        </div>
        <textarea className={`${input} min-h-28`} placeholder="Conteúdo da nota" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} aria-label="Conteúdo" />
        <button className={primary} disabled={busy || !form.content.trim()} onClick={create}>{busy ? "Salvando..." : "Criar nota"}</button>
      </div>

      {!topics ? (
        <p className="text-sm text-gray-500">Carregando...</p>
      ) : topics.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma nota por assunto ainda. Crie uma acima ou mande um PDF pelo WhatsApp.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <div className="flex md:flex-col gap-2 overflow-x-auto">
            {topics.map((t) => (
              <button key={t.id} onClick={() => { setCurrent(t.id); setNote(null); }} className={`${current === t.id ? primary : ghost} text-left whitespace-nowrap`}>
                📂 {t.name} <span className="opacity-60">({t.notes.length})</span>
              </button>
            ))}
          </div>
          <div className="space-y-3 min-w-0">
            {topic?.notes.length === 0 && <p className="text-sm text-gray-500">Esse assunto está vazio.</p>}
            {topic?.notes.map((n) => (
              <button key={n.id} onClick={() => open(n.id)} className={`${card} block w-full text-left text-sm text-gray-200 hover:border-gray-700`}>
                📄 {n.name}
              </button>
            ))}
            {note && (
              <div className={card}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium text-gray-200">{note.name}</h3>
                  <div className="flex gap-2 shrink-0">
                    {note.link && <a className={ghost} href={note.link} target="_blank" rel="noreferrer">Abrir no Drive</a>}
                    <button className={ghost} onClick={() => setNote(null)}>Fechar</button>
                  </div>
                </div>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-300 font-sans">{body(note.content)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
