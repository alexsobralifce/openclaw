"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, type ChatMessage } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { disablePush, enablePush } from "@/lib/push";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "app", label: "App" },
  { id: "telegram", label: "Telegram" },
] as const;

export default function ChatPage() {
  const me = useMe();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(false);
  const [tg, setTg] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [tgLink, setTgLink] = useState<{ code: string; url: string | null; bot: string } | null>(null);
  const [push, setPush] = useState<{ enabled: boolean; publicKey: string; subscribed: boolean } | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const active = channel ?? me?.assistantChannel ?? "whatsapp";
  const bottom = useRef<HTMLDivElement>(null);

  const add = useCallback((m: ChatMessage) => setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m])), []);

  useEffect(() => {
    api.appChat.messages().then(setMessages).catch((e) => setError(e.message));
    api.telegram.status().then(setTg).catch(() => undefined);
    api.appChat.pushStatus().then(setPush).catch(() => undefined);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("oc_token");
    if (!token) return;
    const socket = io(`${API}/chat`, { auth: { token }, transports: ["websocket"] });
    socket.on("chat:message", add);
    socket.on("chat:typing", (p: { on: boolean }) => setTyping(p.on));
    socket.on("chat:redacted", ({ id }: { id: string }) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: "••••" } : m))));
    // Ao reconectar, busca o que chegou enquanto esteve fora
    socket.on("connect", () => setMessages((prev) => {
      api.appChat.messages(prev[prev.length - 1]?.createdAt).then((novas) => novas.forEach(add)).catch(() => undefined);
      return prev;
    }));
    return () => { socket.disconnect(); };
  }, [add]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setError("");
    document.querySelector<HTMLTextAreaElement>('textarea[name="mensagem-assistente"]')?.style.removeProperty("height");
    try {
      add(await api.appChat.send(t));
    } catch (e: any) {
      setText(t);
      setError(e.message);
    }
  }

  async function download(m: ChatMessage) {
    try {
      const blob = await api.appChat.file(m.meta!.fileId!);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m.meta?.fileName || "arquivo";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function chooseChannel(c: (typeof CHANNELS)[number]["id"]) {
    try {
      setChannel((await api.appChat.setChannel(c)).channel);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function linkTelegram() {
    try {
      setTgLink(await api.telegram.link());
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function unlinkTelegram() {
    try {
      await api.telegram.unlink();
      setTg((s) => (s ? { ...s, linked: false } : s));
      setTgLink(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function togglePush() {
    if (!push) return;
    try {
      if (push.subscribed) await disablePush();
      else await enablePush(push.publicKey);
      setPush({ ...push, subscribed: !push.subscribed });
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-gray-200">Assistente</h1>
        <button onClick={() => setPanel((v) => !v)} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`} aria-expanded={panel}>Canais e avisos</button>
      </div>

      {panel && (
        <div className="px-4 py-3 border-b border-gray-800 space-y-3 text-sm text-gray-300 bg-gray-900/50">
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Onde o assistente fala primeiro com você (avisos, lembretes):</p>
            <div className="flex gap-2">
              {CHANNELS.map((c) => (
                <button key={c.id} onClick={() => chooseChannel(c.id)} className={`${btn} ${active === c.id ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>{c.label}</button>
              ))}
            </div>
          </div>
          {tg?.configured && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Telegram: {tg.linked ? "vinculado. O cofre de senhas não funciona por lá." : "não vinculado."}</p>
              {tg.linked ? (
                <button onClick={unlinkTelegram} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Desvincular</button>
              ) : tgLink ? (
                <p className="text-xs">
                  {tgLink.url ? <a href={tgLink.url} target="_blank" rel="noreferrer" className="text-violet-400 underline">Abrir o bot no Telegram</a> : <>Envie ao bot: </>}
                  {" "}ou mande <code className="bg-gray-800 px-1 rounded">/start {tgLink.code}</code> (vale 10 minutos).
                </p>
              ) : (
                <button onClick={linkTelegram} className={`${btn} bg-violet-500 text-white`}>Vincular Telegram</button>
              )}
            </div>
          )}
          {push?.enabled && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Notificações neste navegador: {push.subscribed ? "ativas" : "desativadas"}.</p>
              <button onClick={togglePush} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>{push.subscribed ? "Desativar" : "Ativar"}</button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" aria-live="polite">
        {messages.length === 0 && <p className="text-sm text-gray-500">Escreva o que precisa, por exemplo “agenda de hoje” ou “ler e-mails”.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "IN" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.direction === "IN" ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-200"}`}>
              {m.text}
              {m.kind === "FILE" && m.meta?.fileId && (
                <button onClick={() => download(m)} className="block mt-1.5 text-xs underline">📎 {m.meta.fileName ?? "Baixar arquivo"}</button>
              )}
              <div className="text-[10px] opacity-60 mt-1">{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>
        ))}
        {typing && <p className="text-xs text-gray-500">Digitando…</p>}
        <div ref={bottom} />
      </div>

      {error && <div className="mx-4 mb-2 text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-300">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2 p-3 border-t border-gray-800">
        {/* textarea em vez de input: o Chrome do Android não oferece senha/cartão/endereço (faixa branca acima do teclado) em área de texto */}
        <textarea
          value={text}
          rows={1}
          maxLength={4000}
          name="mensagem-assistente"
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Escreva uma mensagem"
          aria-label="Mensagem para o assistente"
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="flex-1 resize-none bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
        />
        <button type="submit" disabled={!text.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 text-white disabled:opacity-40">Enviar</button>
      </form>
    </div>
  );
}
