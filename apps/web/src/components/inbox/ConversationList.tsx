"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useInboxSocket } from "@/hooks/useInboxSocket";

const CHANNEL_ICON: Record<string, string> = { WHATSAPP: "🟢", INSTAGRAM: "🟣", FACEBOOK: "🔵", EMAIL: "📧", WEBCHAT: "💬" };
const STATUS_COLOR: Record<string, string> = { OPEN: "bg-teal-500", PENDING: "bg-amber-500", RESOLVED: "bg-gray-600" };
const STATUS_LABEL: Record<string, string> = { OPEN: "Aberto", PENDING: "Pendente", RESOLVED: "Resolvido" };

type Filter = "TODOS" | "OPEN" | "PENDING";

interface Props { activeId?: string; }

export function ConversationList({ activeId }: Props) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [filter, setFilter] = useState<Filter>("TODOS");

  function load(f?: Filter) {
    const currentFilter = f ?? filter;
    api.inbox.list(currentFilter === "TODOS" ? undefined : currentFilter)
      .then(setConversations)
      .catch(() => {});
  }

  useEffect(() => { load(); }, [filter]);

  const handleNewMessage = useCallback((payload: { conversationId: string; message: any }) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === payload.conversationId);
      if (idx === -1) {
        // Conversa nova — recarrega a lista
        api.inbox.list(filter === "TODOS" ? undefined : filter).then(setConversations).catch(() => {});
        return prev;
      }
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        messages: [payload.message],
        updatedAt: payload.message.createdAt,
        unread: (updated[idx].unread ?? 0) + (payload.conversationId !== activeId ? 1 : 0),
      };
      // Move conversa para o topo
      const conv = updated.splice(idx, 1)[0];
      return [conv, ...updated];
    });
  }, [filter, activeId]);

  const handleConversationUpdated = useCallback((payload: { conversationId: string; status: string }) => {
    setConversations((prev) =>
      prev.map((c) => c.id === payload.conversationId ? { ...c, status: payload.status } : c)
    );
  }, []);

  const handleConversationDeleted = useCallback((payload: { conversationId: string }) => {
    setConversations((prev) => prev.filter((c) => c.id !== payload.conversationId));
  }, []);

  useInboxSocket({ onNewMessage: handleNewMessage, onConversationUpdated: handleConversationUpdated, onConversationDeleted: handleConversationDeleted });

  const filtered = filter === "TODOS"
    ? conversations
    : conversations.filter((c) => c.status === filter);

  return (
    <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-gray-800 bg-gray-900">
      <div className="h-14 flex items-center justify-between px-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-200">Conversas</h2>
        <button className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex gap-1 px-3 py-2 border-b border-gray-800">
        {([["TODOS", "Todos"], ["OPEN", "Abertos"], ["PENDING", "Pendentes"]] as [Filter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === val ? "bg-teal-500/15 text-teal-400" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-xs text-gray-600">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Nenhuma conversa
          </div>
        ) : filtered.map((conv) => {
          const active = conv.id === activeId;
          const lastMsg = conv.messages?.[0]?.body ?? "";
          const time = conv.messages?.[0]?.createdAt
            ? new Date(conv.messages[0].createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : conv.updatedAt?.slice(11, 16) ?? "";
          const unread = conv.unread ?? 0;
          return (
            <Link
              key={conv.id}
              href={`/dashboard/inbox/${conv.id}`}
              className={`flex items-start gap-3 px-4 py-3 border-b border-gray-800/50 transition-colors ${active ? "bg-teal-500/10" : "hover:bg-gray-800/60"}`}
            >
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold text-white">
                  {conv.contact?.name?.[0] ?? "?"}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 text-[10px]">
                  {CHANNEL_ICON[conv.channel?.type] ?? "💬"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-gray-200 truncate">{conv.contact?.name}</span>
                  <span className="text-[10px] text-gray-500 flex-shrink-0">{time}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-xs text-gray-500 truncate">{lastMsg}</p>
                  {unread > 0 && (
                    <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-full bg-teal-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                      {unread}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_COLOR[conv.status] ?? "bg-gray-600"}`} />
                  <span className="text-[10px] text-gray-600">{STATUS_LABEL[conv.status] ?? conv.status}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
