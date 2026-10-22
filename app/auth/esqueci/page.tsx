"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { AuthCard, buttonClass, inputClass } from "@/components/brand/AuthCard";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.auth.forgot(email);
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Não foi possível enviar agora");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard subtitle="Recuperar senha">
      {sent ? (
        <p className="text-sm text-gray-300">Se este e-mail tem uma conta com senha, enviamos um link para criar uma nova. Ele vale por 1 hora. Confira também o spam.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" className={inputClass} />
          </div>
          <button type="submit" disabled={loading} className={buttonClass}>{loading ? "Enviando..." : "Enviar link"}</button>
        </form>
      )}
    </AuthCard>
  );
}
