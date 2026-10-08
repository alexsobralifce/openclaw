"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type PlanInfo } from "@/lib/api";

const SDK = "https://sdk.mercadopago.com/js/v2";

declare global {
  interface Window { MercadoPago?: any }
}

function loadSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Não foi possível carregar o formulário do Mercado Pago."));
    document.head.appendChild(s);
  });
}

/** Formulário de cartão do Mercado Pago dentro do app: o número do cartão vai direto para o Mercado Pago e só o token chega ao MagoBox. */
export function CardBrick({ plan, publicKey, onDone, onCancel }: { plan: PlanInfo; publicKey: string; onDone: () => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller: { unmount?: () => void } | null = null;
    let dead = false;
    (async () => {
      try {
        await loadSdk();
        if (dead) return;
        const mp = new window.MercadoPago(publicKey, { locale: "pt-BR" });
        controller = await mp.bricks().create("cardPayment", "mb-card-brick", {
          initialization: { amount: plan.priceBrl },
          customization: { paymentMethods: { maxInstallments: 1 }, visual: { style: { theme: "dark" } } },
          callbacks: {
            onReady: () => undefined,
            onError: () => setError("Confira os dados do cartão e tente de novo."),
            onSubmit: async (form: { token: string }) => {
              setError("");
              try {
                await api.billing.subscribeCard(plan.id, form.token);
                onDone();
              } catch (e: any) {
                setError(e.message);
                throw e;
              }
            },
          },
        });
      } catch (e: any) {
        setError(e.message);
      }
    })();
    return () => { dead = true; controller?.unmount?.(); };
  }, [plan.id, plan.priceBrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={`Assinar o plano ${plan.name}`} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-200">Plano {plan.name}</h2>
            <p className="text-xs text-gray-500">R$ {plan.priceBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por mês, no cartão. Renova sozinho todo mês.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fechar" className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        <div id="mb-card-brick" ref={box} />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
