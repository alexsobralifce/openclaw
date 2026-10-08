"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, type PlanInfo } from "@/lib/api";

/** Pix dentro do app: mostra o QR code e o "copia e cola" e confere o pagamento até aprovar (ou o código vencer). */
export function PixModal({ plan, planUntilBefore, onPaid, onCancel }: { plan: PlanInfo; planUntilBefore: string | null; onPaid: () => void; onCancel: () => void }) {
  const [pix, setPix] = useState<{ qrCode: string; qrCodeBase64: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dead = false;
    api.billing.pix(plan.id).then((p) => !dead && setPix(p)).catch((e) => !dead && setError(e.message));
    return () => { dead = true; };
  }, [plan.id]);

  // Cada 5 s confere se o pagamento caiu (o plano muda de vencimento quando o Pix aprova)
  useEffect(() => {
    if (!pix) return;
    const end = new Date(pix.expiresAt).getTime();
    const t = setInterval(() => {
      if (Date.now() > end) { clearInterval(t); setError("O código Pix venceu. Feche e gere um novo."); return; }
      api.billing.sync().then((s) => { if (s.planUntil && !s.expired && s.planUntil !== planUntilBefore) { clearInterval(t); onPaid(); } }).catch(() => undefined);
    }, 5_000);
    return () => clearInterval(t);
  }, [pix, planUntilBefore, onPaid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function copy() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.qrCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Não consegui copiar. Selecione o código e copie à mão.");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={`Pagar o plano ${plan.name} no Pix`} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-200">Pix · plano {plan.name}</h2>
            <p className="text-xs text-gray-500">R$ {plan.priceBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por 1 mês. O código vale por 30 minutos.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fechar" className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        {!pix && !error && <p className="text-sm text-gray-500">Gerando o Pix…</p>}
        {pix && (
          <>
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR code do Pix" width={220} height={220} className="rounded-lg bg-white p-2" />
            </div>
            <p className="text-xs text-gray-500">Abra o app do seu banco, escolha Pix, e leia o QR code ou use o código copia e cola:</p>
            <textarea readOnly value={pix.qrCode} rows={3} aria-label="Código Pix copia e cola" onFocus={(e) => e.currentTarget.select()} className="w-full resize-none bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-300 break-all" />
            <button type="button" onClick={() => void copy()} className="w-full h-11 rounded-xl bg-violet-500 text-white text-sm font-medium">{copied ? "Código copiado!" : "Copiar código Pix"}</button>
            <p role="status" className="text-xs text-gray-500 text-center">Esta tela confirma sozinha assim que o pagamento cair.</p>
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
