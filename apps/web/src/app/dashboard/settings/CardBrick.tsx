"use client";

import { useEffect, useRef, useState } from "react";
import { api, type PlanInfo } from "@/lib/api";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY || "";
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

export const cardPaymentConfigured = !!PUBLIC_KEY;

/** Formulário de cartão do Mercado Pago dentro do app: o número do cartão vai direto para o Mercado Pago e só o token chega ao MagoBox. */
export function CardBrick({ plan, onDone, onCancel }: { plan: PlanInfo; onDone: () => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller: { unmount?: () => void } | null = null;
    let dead = false;
    (async () => {
      try {
        await loadSdk();
        if (dead) return;
        const mp = new window.MercadoPago(PUBLIC_KEY, { locale: "pt-BR" });
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-300">Cartão para o plano {plan.name}</p>
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-300">Cancelar</button>
      </div>
      <div id="mb-card-brick" ref={box} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
