"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setToken, setUser } from "@/lib/auth";

/** Destino da volta do "Entrar com Google": troca o ticket da URL pela sessão. */
export default function GoogleLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("ticket");
    // O ticket sai da barra de endereço logo de cara
    window.history.replaceState(null, "", "/auth/google");
    if (!ticket) {
      router.replace("/auth/login");
      return;
    }
    api.auth
      .googleExchange(ticket)
      .then(({ accessToken, user }) => {
        setToken(accessToken);
        setUser(user);
        router.replace("/dashboard/inbox");
      })
      .catch((e) => setError(e.message || "Não foi possível entrar com o Google."));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4 text-sm text-gray-400">
      {error ? (
        <div className="text-center space-y-3">
          <p className="text-red-400">{error}</p>
          <a href="/auth/login" className="text-violet-400 underline">Voltar ao login</a>
        </div>
      ) : (
        "Entrando com o Google…"
      )}
    </div>
  );
}
