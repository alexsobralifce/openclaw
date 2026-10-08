"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

/** Botão "Relatar problema": abre um quadro para descrever o bug; a tela atual vai junto, sem o usuário precisar dizer. */
export function BugReportButton({ className }: { className: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setText("");
    setError("");
    setSent(false);
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      await api.bugReports.create(text, pathname);
      setSent(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 2l1.5 2M16 2l-1.5 2M9 7h6a4 4 0 0 1 4 4v3a7 7 0 0 1-14 0v-3a4 4 0 0 1 4-4zM12 11v10M3 13h3M18 13h3M4 20l2.5-2M20 20l-2.5-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Relatar problema
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={close}>
          <div role="dialog" aria-modal="true" aria-label="Relatar problema" onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            {sent ? (
              <>
                <h2 className="text-base font-semibold text-gray-200">Recebemos seu relato</h2>
                <p className="text-sm text-gray-400">Obrigado! Vamos olhar o quanto antes.</p>
                <button type="button" onClick={close} className="w-full h-11 rounded-xl bg-violet-500 text-white text-sm font-medium">Fechar</button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-gray-200">Relatar um problema</h2>
                <p className="text-xs text-gray-500">Conte o que aconteceu e o que você esperava. A tela em que você está vai junto automaticamente.</p>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  autoFocus
                  aria-label="Descrição do problema"
                  placeholder="Ex.: ao tocar em Agenda, nada acontece."
                  className="w-full resize-none bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
                />
                {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={close} className="flex-1 h-11 rounded-xl bg-gray-800 text-gray-300 text-sm font-medium">Cancelar</button>
                  <button type="button" onClick={() => void send()} disabled={busy || text.trim().length < 5} className="flex-1 h-11 rounded-xl bg-violet-500 text-white text-sm font-medium disabled:opacity-50">{busy ? "Enviando…" : "Enviar"}</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
