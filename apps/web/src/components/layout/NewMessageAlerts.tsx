"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { getUser } from "@/lib/auth";
import { playAlert, unlockAudio } from "@/lib/alert-sound";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Toca o aviso quando chega mensagem de cliente, em qualquer tela do painel (enquanto o app estiver aberto). */
export function NewMessageAlerts() {
  useEffect(() => {
    const user = getUser();
    if (!user?.workspaceId) return;

    const socket = io(`${API}/inbox`, { withCredentials: true, transports: ["websocket"] });
    socket.on("message:new", (payload: any) => {
      if (payload?.message?.direction === "INBOUND") playAlert();
    });
    window.addEventListener("pointerdown", unlockAudio, { passive: true });

    return () => {
      socket.disconnect();
      window.removeEventListener("pointerdown", unlockAudio);
    };
  }, []);

  return null;
}
