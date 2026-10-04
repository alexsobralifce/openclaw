"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, type ChatListedFile, type ChatMessage } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { disablePush, enablePush } from "@/lib/push";
import { parseWaMarkup, type WaSeg } from "@/lib/wa-markup";
import { fileEmoji, fileExpired, fileSizeLabel, isAutoFileNote } from "@/lib/chat-file";
import { MobileMenu } from "@/components/layout/MobileMenu";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const iconBtn = "flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors";
const MAX_FILE = 15 * 1024 * 1024;
const MAX_REC_SECONDS = 300;
const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "app", label: "App" },
  { id: "telegram", label: "Telegram" },
] as const;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(blob);
  });

/** Mostra a marcação do WhatsApp (*negrito*, _itálico_) formatada, sem os símbolos. */
function Rich({ segs }: { segs: WaSeg[] }) {
  return (
    <>
      {segs.map((g, i) =>
        g.t === "text" ? <span key={i}>{g.v}</span> : g.t === "b" ? <strong key={i} className="font-semibold"><Rich segs={g.v} /></strong> : g.t === "i" ? <em key={i}><Rich segs={g.v} /></em> : <s key={i}><Rich segs={g.v} /></s>,
      )}
    </>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function ChatPage() {
  const me = useMe();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Abertura: enquanto as mensagens chegam e a tela vai até a última, mostra uma animação em vez da rolagem passando
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const firstScroll = useRef(true);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [recSeconds, setRecSeconds] = useState<number | null>(null); // null = não está gravando
  const [tg, setTg] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [tgLink, setTgLink] = useState<{ code: string; url: string | null; bot: string } | null>(null);
  const [push, setPush] = useState<{ enabled: boolean; publicKey: string; subscribed: boolean } | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const active = channel ?? me?.assistantChannel ?? "whatsapp";
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<{ recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream; timer: ReturnType<typeof setInterval>; started: number; cancelled: boolean } | null>(null);

  const add = useCallback((m: ChatMessage) => setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m])), []);

  useEffect(() => {
    api.appChat.messages().then(setMessages).catch((e) => setError(e.message)).finally(() => setLoaded(true));
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

  useEffect(() => {
    if (!loaded) return;
    // Primeira vez: pula direto para o fim, sem rolagem animada; depois some a animação. Mensagens novas rolam suave.
    bottom.current?.scrollIntoView({ behavior: firstScroll.current ? "auto" : "smooth" });
    if (firstScroll.current) {
      firstScroll.current = false;
      requestAnimationFrame(() => setReady(true));
    }
  }, [messages, typing, loaded]);

  // Sair da tela com o microfone aberto não pode deixá-lo ligado
  useEffect(() => () => cleanupRec(), []);

  function cleanupRec() {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setError("");
    field.current?.style.removeProperty("height");
    try {
      add(await api.appChat.send(t));
    } catch (e: any) {
      setText(t);
      setError(e.message);
    }
  }

  async function sendFile(file: File) {
    setError("");
    if (!/^(image\/|application\/pdf$)/.test(file.type)) return setError("Envie uma imagem ou um PDF.");
    if (file.size > MAX_FILE) return setError("Arquivo grande demais (limite de 15 MB).");
    setBusy(true);
    try {
      const caption = text.trim();
      add(await api.appChat.sendFile({ base64: await toBase64(file), mime: file.type, name: file.name, caption: caption || undefined }));
      if (caption) {
        setText("");
        field.current?.style.removeProperty("height");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startRec() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setError("Este navegador não grava áudio.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const started = Date.now();
      const timer = setInterval(() => {
        const secs = Math.round((Date.now() - started) / 1000);
        setRecSeconds(secs);
        if (secs >= MAX_REC_SECONDS) stopRec(true);
      }, 250);
      recorder.onstop = () => {
        const r = rec.current;
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
        const type = recorder.mimeType || mime || "audio/webm";
        const cancelled = r?.cancelled ?? true;
        cleanupRec();
        setRecSeconds(null);
        if (!cancelled && chunks.length) void sendAudio(new Blob(chunks, { type }), seconds, type);
      };
      rec.current = { recorder, chunks, stream, timer, started, cancelled: false };
      recorder.start();
      setRecSeconds(0);
    } catch {
      setError("Não consegui usar o microfone. Libere a permissão nas configurações do navegador.");
    }
  }

  function stopRec(sendIt: boolean) {
    const r = rec.current;
    if (!r || r.recorder.state === "inactive") return;
    r.cancelled = !sendIt;
    r.recorder.stop();
  }

  async function sendAudio(blob: Blob, seconds: number, type: string) {
    setBusy(true);
    try {
      add(await api.appChat.sendAudio({ base64: await toBase64(blob), mime: type, seconds }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function saveBlob(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function download(m: ChatMessage) {
    try {
      saveBlob(await api.appChat.file(m.meta!.fileId!), m.meta?.fileName || "arquivo");
    } catch (e: any) {
      setError(e.message);
    }
  }

  /** Item da lista do Drive: baixa na hora. Arquivo grande demais abre o Drive em outra aba. */
  async function downloadListed(f: ChatListedFile) {
    setError("");
    setDownloading(f.id);
    try {
      saveBlob(await api.appChat.driveFile(f.id, f.account), f.nome);
    } catch (e: any) {
      if (e.link) window.open(e.link, "_blank", "noopener");
      setError(e.message);
    } finally {
      setDownloading(null);
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

  const recording = recSeconds !== null;

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      {/* Cabeçalho enxuto: no celular substitui a barra do topo (ver TopBar), para sobrar espaço às mensagens */}
      <div className="relative flex items-center gap-2 px-3 min-h-11 pt-[env(safe-area-inset-top)] md:pt-0 border-b border-gray-800 flex-shrink-0 bg-gray-900 md:bg-transparent">
        <MobileMenu />
        <h1 className="text-sm font-semibold text-gray-200 mr-auto">Assistente</h1>
        <button onClick={() => setPanel((v) => !v)} className={iconBtn} aria-expanded={panel} aria-label="Canais e avisos" title="Canais e avisos">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        {panel && (
          <div className="absolute z-20 top-full inset-x-0 px-4 py-3 border-b border-gray-800 space-y-3 text-sm text-gray-300 bg-gray-900 shadow-lg">
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
      </div>

      <div className="relative flex-1 min-h-0">
      {!ready && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end gap-2 px-2.5 py-3 bg-gray-950" role="status" aria-label="Carregando suas mensagens">
          {[["w-2/3", "start"], ["w-1/2", "end"], ["w-3/4", "start"], ["w-2/5", "end"], ["w-3/5", "start"]].map(([w, side], i) => (
            <div key={i} className={`flex ${side === "end" ? "justify-end" : "justify-start"}`}>
              <div className={`${w} h-10 rounded-2xl bg-gray-800 animate-pulse`} style={{ animationDelay: `${i * 120}ms` }} />
            </div>
          ))}
          <p className="text-center text-xs text-gray-500 pt-1">Carregando suas mensagens…</p>
        </div>
      )}
      <div className={`h-full overflow-y-auto px-2.5 py-2 space-y-1.5 ${ready ? "" : "invisible"}`} aria-live="polite">
        {messages.length === 0 && <p className="text-sm text-gray-500 px-1">Escreva ou grave o que precisa, por exemplo “agenda de hoje” ou “ler e-mails”. Também aceito foto e PDF.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "IN" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[92%] rounded-2xl px-3 py-1.5 text-[15px] leading-snug whitespace-pre-wrap break-words ${m.direction === "IN" ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-200"}`}>
              {!(m.kind === "FILE" && isAutoFileNote(m.text, m.meta?.fileName)) && <Rich segs={parseWaMarkup(m.text)} />}
              {m.kind === "FILE" && m.meta?.fileId && (
                fileExpired(m.createdAt) ? (
                  <p className="mt-1 text-xs opacity-70">{fileEmoji(m.meta.mime)} {m.meta.fileName ?? "Arquivo"} · expirou (fica disponível por 1 hora). Peça de novo.</p>
                ) : (
                  <button onClick={() => download(m)} aria-label={`Baixar ${m.meta.fileName ?? "arquivo"}`} className="mt-1 flex w-full items-center gap-3 rounded-xl bg-black/20 px-3 py-2 text-left active:bg-black/30">
                    <span className="text-xl" aria-hidden>{fileEmoji(m.meta.mime)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.meta.fileName ?? "Arquivo"}</span>
                      <span className="block text-xs opacity-70">{[fileSizeLabel(m.meta.size), "Toque para baixar"].filter(Boolean).join(" · ")}</span>
                    </span>
                    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" aria-hidden className="flex-shrink-0"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )
              )}
              {!!m.meta?.files?.length && (
                <div className="mt-1.5 space-y-1">
                  {m.meta.files.map((f, i) => (
                    <button key={f.id} onClick={() => void downloadListed(f)} disabled={downloading === f.id} aria-label={`Baixar ${f.nome}`}
                      className="flex w-full items-center gap-2 rounded-xl bg-black/20 px-2.5 py-1.5 text-left active:bg-black/30 disabled:opacity-60">
                      <span className="w-5 flex-shrink-0 text-center text-xs font-semibold opacity-70" aria-hidden>{i + 1}</span>
                      <span aria-hidden>{fileEmoji(f.tipo)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{f.nome}</span>
                        {fileSizeLabel(f.tamanho) && <span className="block text-[11px] opacity-70">{downloading === f.id ? "Baixando…" : fileSizeLabel(f.tamanho)}</span>}
                      </span>
                      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" aria-hidden className="flex-shrink-0"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  ))}
                </div>
              )}
              <span className="block text-right text-[10px] opacity-60 mt-0.5">{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        ))}
        {(typing || busy) && <p className="text-xs text-gray-500 px-1">{busy && !typing ? "Enviando…" : "Digitando…"}</p>}
        <div ref={bottom} />
      </div>
      </div>

      {error && <div className="mx-3 mb-1 text-xs rounded-lg px-3 py-2 bg-red-500/10 text-red-300" role="alert">{error}</div>}

      <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void sendFile(f); }} />

      {recording ? (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-800">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden />
          <span className="text-sm text-gray-200 tabular-nums mr-auto" role="status">Gravando {clock(recSeconds)}</span>
          <button onClick={() => stopRec(false)} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Cancelar</button>
          <button onClick={() => stopRec(true)} className={`${btn} bg-violet-500 text-white`}>Enviar</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-1 px-2 py-2 border-t border-gray-800">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={iconBtn} aria-label="Enviar foto ou PDF" title="Enviar foto ou PDF">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" aria-hidden><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {/* textarea em vez de input: o Chrome do Android não oferece senha/cartão/endereço (faixa branca acima do teclado) em área de texto */}
          <textarea
            ref={field}
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
            className="flex-1 min-w-0 resize-none bg-gray-900 border border-gray-800 rounded-2xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
          />
          {text.trim() ? (
            <button type="submit" className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-violet-500 text-white" aria-label="Enviar mensagem">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : (
            <button type="button" onClick={() => void startRec()} disabled={busy} className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-violet-500 text-white disabled:opacity-50" aria-label="Gravar áudio" title="Gravar áudio">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden><rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          )}
        </form>
      )}
    </div>
  );
}
