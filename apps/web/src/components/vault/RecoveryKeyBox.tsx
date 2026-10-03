"use client";

import { useState } from "react";

const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40";

/**
 * Mostra a chave de recuperação UMA vez. O dono só continua depois de confirmar que guardou: ela não é gravada em claro
 * no servidor e não pode ser mostrada de novo (só substituída por outra).
 */
export function RecoveryKeyBox({ keyText, onDone }: { keyText: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(keyText);
      setCopied(true);
      setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000);
    } catch {}
  }

  function download() {
    const blob = new Blob([`Chave de recuperação do cofre de senhas (MagoBox)\n\n${keyText}\n\nGuarde este arquivo fora do computador principal (gerenciador offline, papel em local seguro). Quem tiver esta chave e acesso ao seu e-mail pode redefinir a senha mestra do cofre.\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chave-de-recuperacao-cofre.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="bg-gray-900 border border-amber-500/40 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-amber-200">Sua chave de recuperação</h2>
      <p className="text-xs text-gray-400">
        Se você esquecer a senha mestra, é esta chave (junto com o link enviado ao seu e-mail) que permite criar outra <b>sem perder as senhas guardadas</b>.
        Ela aparece <b>só agora</b> e não fica gravada em lugar nenhum do sistema.
      </p>
      <p className="font-mono text-lg tracking-wider text-teal-300 break-all select-all bg-gray-950 border border-gray-800 rounded-lg px-3 py-3">{keyText}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>{copied ? "Copiada (limpo em 30 s)" : "Copiar"}</button>
        <button onClick={download} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Baixar .txt</button>
      </div>
      <p className="text-[11px] text-gray-500">Guarde fora deste sistema: um papel em local seguro ou um gerenciador offline. Não a envie por WhatsApp nem a salve no mesmo lugar da senha mestra.</p>
      <label className="flex items-start gap-2 text-xs text-gray-300">
        <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Guardei a chave de recuperação em um local seguro.</span>
      </label>
      <button disabled={!saved} onClick={onDone} className={`${btn} bg-teal-500 text-white hover:bg-teal-400`}>Continuar</button>
    </div>
  );
}
