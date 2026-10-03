"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { RecoveryKeyBox } from "@/components/vault/RecoveryKeyBox";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40";

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Carregando...</div>}>
      <Reset />
    </Suspense>
  );
}

function Reset() {
  const params = useSearchParams();
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"key" | "empty">("key");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // O token sai da barra de endereço assim que é lido (não fica no histórico nem em capturas de tela)
  useEffect(() => {
    const t = params.get("token");
    if (t) {
      setToken(t);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw !== pw2) return setError("As duas senhas novas não são iguais.");
    setBusy(true);
    try {
      const r = mode === "key" ? await api.vault.recover(token, recoveryKey, pw) : await api.vault.resetEmpty(token, confirm, pw);
      setToken("");
      setPw("");
      setPw2("");
      setRecoveryKey("");
      setNewKey(r.recoveryKey);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="p-6 max-w-xl space-y-4">
        <div className="px-3 py-2 rounded-lg text-xs border bg-violet-500/10 border-violet-500/30 text-violet-300">Senha mestra redefinida. Desbloqueie o cofre com a nova senha.</div>
        <Link href="/dashboard/vault" className={`${btn} inline-block bg-violet-500 text-white hover:bg-violet-400`}>Ir para o cofre</Link>
      </div>
    );
  }
  if (newKey) {
    return (
      <div className="p-6 max-w-xl space-y-4">
        <div className="px-3 py-2 rounded-lg text-xs border bg-violet-500/10 border-violet-500/30 text-violet-300">
          {mode === "key" ? "Nova senha mestra definida e suas senhas foram mantidas." : "Cofre novo e vazio criado com a nova senha mestra."} A chave de recuperação anterior deixou de valer: guarde esta nova.
        </div>
        <RecoveryKeyBox keyText={newKey} onDone={() => setDone(true)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl space-y-4 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Redefinir a senha mestra do cofre</h1>
        <p className="text-sm text-gray-500 mt-0.5">Você chegou aqui pelo link enviado ao seu e-mail.</p>
      </div>

      {!token ? (
        <div className={`${card} space-y-3`}>
          <p className="text-sm text-gray-300">Este link não tem o código de redefinição, ou ele já foi usado.</p>
          <Link href="/dashboard/vault" className={`${btn} inline-block bg-gray-800 text-gray-300 hover:bg-gray-700`}>Voltar ao cofre e pedir um novo link</Link>
        </div>
      ) : (
        <form onSubmit={submit} className={`${card} space-y-3`}>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("key")} className={`${btn} ${mode === "key" ? "bg-violet-500 text-white" : "bg-gray-800 text-gray-300"}`}>Tenho a chave de recuperação</button>
            <button type="button" onClick={() => setMode("empty")} className={`${btn} ${mode === "empty" ? "bg-red-500/80 text-white" : "bg-gray-800 text-gray-300"}`}>Não tenho a chave</button>
          </div>

          {error && <div className="px-3 py-2 rounded-lg text-xs border bg-red-500/10 border-red-500/30 text-red-300">{error}</div>}

          {mode === "key" ? (
            <label className="block">
              <span className="block text-[11px] text-gray-500 mb-1">Chave de recuperação (a que apareceu ao criar o cofre)</span>
              <input required autoFocus autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className={`${input} font-mono`} value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} />
            </label>
          ) : (
            <div className="space-y-2">
              <div className="px-3 py-2 rounded-lg text-xs border bg-red-500/10 border-red-500/30 text-red-200">
                <b>Atenção: sem a chave, não há como recuperar as senhas.</b> Continuar cria um cofre novo e vazio e <b>apaga definitivamente</b> o antigo.
              </div>
              <label className="block">
                <span className="block text-[11px] text-gray-500 mb-1">Para confirmar, digite APAGAR</span>
                <input required autoComplete="off" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
            </div>
          )}

          <label className="block">
            <span className="block text-[11px] text-gray-500 mb-1">Nova senha mestra (mínimo 12 caracteres; misture tipos ou use uma frase longa)</span>
            <input type="password" required autoComplete="new-password" className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-[11px] text-gray-500 mb-1">Repita a nova senha mestra</span>
            <input type="password" required autoComplete="new-password" className={input} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
          <button disabled={busy} className={`${btn} ${mode === "key" ? "bg-violet-500 hover:bg-violet-400" : "bg-red-500 hover:bg-red-400"} text-white`}>
            {busy ? "Aguarde..." : mode === "key" ? "Redefinir mantendo minhas senhas" : "Apagar o cofre antigo e recomeçar"}
          </button>
        </form>
      )}
    </div>
  );
}
