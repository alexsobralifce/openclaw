"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getUser } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Options {
  onNewMessage?: (payload: { conversationId: string; message: any }) => void;
  onConversationUpdated?: (payload: { conversationId: string; status: string }) => void;
  onConversationDeleted?: (payload: { conversationId: string }) => void;
  conversationId?: string;
}

export function useInboxSocket({ onNewMessage, onConversationUpdated, onConversationDeleted, conversationId }: Options): void {
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef({ onNewMessage, onConversationUpdated, onConversationDeleted });
  callbacksRef.current = { onNewMessage, onConversationUpdated, onConversationDeleted };

  useEffect(() => {
    const user = getUser();
    if (!user?.workspaceId) return;

    const socket = io(`${API}/inbox`, {
      withCredentials: true,
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("message:new", (payload) => callbacksRef.current.onNewMessage?.(payload));
    socket.on("conversation:updated", (payload) => callbacksRef.current.onConversationUpdated?.(payload));
    socket.on("conversation:deleted", (payload) => callbacksRef.current.onConversationDeleted?.(payload));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => {
    if (conversationId && socketRef.current) {
      socketRef.current.emit("join:conversation", conversationId);
    }
  }, [conversationId]);
}
