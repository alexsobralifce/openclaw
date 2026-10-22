"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AuthCard } from "@/components/brand/AuthCard";

export default function ConfirmEmailPage() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    api.auth.verifyEmail(token).then(() => setState("ok")).catch((e) => { setMessage(e.message); setState("error"); });
  }, []);

  return (
    <AuthCard subtitle="Confirmação de e-mail">
      {state === "loading" && <p className="text-sm text-gray-400">Confirmando...</p>}
      {state === "ok" && <p className="text-sm text-gray-300">E-mail confirmado! Sua conta agora aguarda a aprovação do administrador; você poderá entrar assim que for liberada.</p>}
      {state === "error" && <p className="text-sm text-red-400">{message || "Link inválido ou expirado."}</p>}
    </AuthCard>
  );
}
