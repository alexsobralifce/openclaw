"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AuthCard, buttonClass, inputClass } from "@/components/brand/AuthCard";

export default function ResetPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") ?? ""), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("As senhas não são iguais.");
    setLoading(true);
    try {
      await api.auth.reset(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Não foi possível redefinir a senha");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard subtitle="Criar nova senha">
      {done ? (
        <p className="text-sm text-gray-300">Senha alterada! <Link href="/auth/login" className="text-violet-400 hover:text-violet-300">Entrar agora</Link>.</p>
      ) : !token ? (
        <p className="text-sm text-gray-300">Link incompleto. <Link href="/auth/esqueci" className="text-violet-400 hover:text-violet-300">Peça um novo</Link>.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Nova senha (mínimo 8 caracteres)</label>
            <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Repita a nova senha</label>
            <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </div>
          <button type="submit" disabled={loading} className={buttonClass}>{loading ? "Salvando..." : "Salvar nova senha"}</button>
        </form>
      )}
    </AuthCard>
  );
}
