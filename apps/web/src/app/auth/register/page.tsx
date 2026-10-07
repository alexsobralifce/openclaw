"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setUser, startSession } from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");

  function set(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.auth.register(form);
      if (res.pending || !res.accessToken) {
        setPending(res.message || "Cadastro recebido. Aguarde a aprovação do administrador.");
        return;
      }
      startSession();
      setUser(res.user);
      router.push("/dashboard/inbox");
    } catch (err: any) {
      setError(err.message || "Erro ao criar conta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="flex justify-center"><Logo size={56} className="flex-col !gap-3" textClassName="text-3xl font-bold tracking-tight text-white" /></h1>
          <p className="text-sm text-gray-500 mt-1">Crie seu workspace</p>
        </div>

        {pending ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3 text-center">
            <p className="text-3xl">⏳</p>
            <p className="text-sm font-semibold text-gray-200">Cadastro recebido</p>
            <p className="text-sm text-gray-400">{pending}</p>
            <p className="text-xs text-gray-500">Você poderá entrar assim que o administrador liberar seu acesso.</p>
          </div>
        ) : (
        <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome do workspace</label>
            <input
              required
              value={form.workspaceName}
              onChange={set("workspaceName")}
              placeholder="Minha Empresa"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Seu nome</label>
            <input
              required
              value={form.name}
              onChange={set("name")}
              placeholder="João Silva"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={set("email")}
              placeholder="seu@email.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Senha</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={set("password")}
              placeholder="mínimo 8 caracteres"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-500 hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? "Criando..." : "Criar workspace"}
          </button>
          <p className="text-[11px] text-gray-500 text-center">Novos cadastros passam pela aprovação do administrador.</p>
        </form>
        )}

        <p className="text-center text-xs text-gray-600 mt-4">
          Já tem conta?{" "}
          <Link href="/auth/login" className="text-violet-400 hover:text-violet-300 transition-colors">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
