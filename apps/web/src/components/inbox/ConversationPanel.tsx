"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useInboxSocket } from "@/hooks/useInboxSocket";

function fmt(ts: string) {
  if (!ts || !ts.includes("T")) return ts ?? "";
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = { OPEN: "Aberto", PENDING: "Pendente", RESOLVED: "Resolvido" };

interface Props { conversationId: string; }

export function ConversationPanel({ conversationId }: Props) {
  const [data, setData] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>("OPEN");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.inbox.get(conversationId)
      .then((conv) => {
        setData(conv);
        setMessages(conv.messages ?? []);
        setStatus(conv.status ?? "OPEN");
      })
      .catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleNewMessage = useCallback((payload: { conversationId: string; message: any }) => {
    if (payload.conversationId !== conversationId) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === payload.message.id)) return prev;
      return [...prev, payload.message];
    });
  }, [conversationId]);

  const handleConversationUpdated = useCallback((payload: { conversationId: string; status: string }) => {
    if (payload.conversationId !== conversationId) return;
    setStatus(payload.status);
  }, [conversationId]);

  useInboxSocket({ onNewMessage: handleNewMessage, onConversationUpdated: handleConversationUpdated, conversationId });

  async function send() {
    const body = text.trim();
    if (!body || !data) return;
    setSending(true);
    const optimisticId = `opt_${Date.now()}`;
    const optimistic = {
      id: optimisticId, body, direction: "OUTBOUND",
      createdAt: new Date().toISOString(), authorId: "me",
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");
    try {
      await api.channels.sendWhatsapp(
        data.channel.id,
        data.contact.phone,
        body,
        conversationId,
      );
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setText(body);
    } finally {
      setSending(false);
    }
  }

  async function updateStatus(newStatus: string) {
    setStatus(newStatus);
    try {
      await api.inbox.updateStatus(conversationId, newStatus);
    } catch {
      setStatus(status);
    }
  }

  if (!data) return (
    <div className="flex-1 flex items-center justify-center bg-gray-950">
      <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const contact = data.contact ?? {};
  const channel = data.channel ?? {};
  const agentName = data.assignees?.[0]?.user?.name ?? "—";
  const tags: string[] = data.tags ?? [];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Chat */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-800 bg-gray-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold text-white">
              {contact.name?.[0] ?? "?"}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-200">{contact.name}</p>
              <p className="text-[11px] text-gray-500">
                {contact.phone ?? contact.email ?? ""}
                {channel.name ? ` · ${channel.name}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {status !== "PENDING" && (
              <button
                onClick={() => updateStatus("PENDING")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
              >
                Pendente
              </button>
            )}
            {status !== "RESOLVED" && (
              <button
                onClick={() => updateStatus("RESOLVED")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors"
              >
                Resolver
              </button>
            )}
            {status !== "OPEN" && (
              <button
                onClick={() => updateStatus("OPEN")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >
                Reabrir
              </button>
            )}
            <span className="text-[10px] font-medium text-gray-500 ml-2">
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-950">
          {messages.map((msg) => {
            const out = msg.direction === "OUTBOUND";
            const optimistic = msg.id?.startsWith("opt_");
            return (
              <div key={msg.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div>
                  <div
                    className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      out
                        ? `bg-teal-600 text-white rounded-br-sm ${optimistic ? "opacity-70" : ""}`
                        : "bg-gray-800 text-gray-200 rounded-bl-sm"
                    }`}
                  >
                    {msg.body}
                  </div>
                  <div className={`flex items-center gap-1 mt-1 ${out ? "justify-end" : "justify-start"}`}>
                    <span className="text-[10px] text-gray-600">{fmt(msg.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-gray-800 bg-gray-900 p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 bg-gray-800 rounded-xl border border-gray-700 focus-within:border-teal-500/50 transition-colors">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Escreva uma mensagem... (Enter para enviar)"
                rows={2}
                disabled={status === "RESOLVED"}
                className="w-full bg-transparent px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none outline-none disabled:opacity-50"
              />
              <div className="flex items-center gap-1 px-3 pb-2">
                {["😊", "📎"].map((icon) => (
                  <button key={icon} className="text-gray-600 hover:text-gray-400 transition-colors text-base p-1">{icon}</button>
                ))}
              </div>
            </div>
            <button
              onClick={send}
              disabled={!text.trim() || sending || status === "RESOLVED"}
              className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-teal-400 transition-colors flex-shrink-0"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                  <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
          {status === "RESOLVED" && (
            <p className="text-xs text-gray-600 mt-2 text-center">
              Conversa resolvida. <button onClick={() => updateStatus("OPEN")} className="text-teal-400 hover:underline">Reabrir</button> para continuar.
            </p>
          )}
        </div>
      </div>

      {/* Contact panel */}
      <div className="w-[240px] flex-shrink-0 border-l border-gray-800 bg-gray-900 overflow-y-auto">
        <div className="p-4 border-b border-gray-800">
          <div className="flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-xl font-bold text-white mb-3">
              {contact.name?.[0] ?? "?"}
            </div>
            <p className="text-sm font-semibold text-gray-200">{contact.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{contact.phone ?? contact.email ?? ""}</p>
            {tags.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap justify-center">
                {tags.map((tag: string) => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 text-[10px] font-medium border border-indigo-500/20">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <Section title="Informações">
            <Row label="Canal" value={channel.name ?? "—"} />
            <Row label="Status" value={STATUS_LABEL[status] ?? status ?? "—"} />
            <Row label="Agente" value={agentName} />
          </Section>
          <Section title="Notas">
            <textarea
              placeholder="Adicionar nota..."
              rows={3}
              className="w-full bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 resize-none outline-none border border-gray-700 focus:border-teal-500/50 transition-colors"
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-[11px] text-gray-600 flex-shrink-0">{label}</span>
      <span className="text-[11px] text-gray-400 text-right truncate">{value}</span>
    </div>
  );
}
