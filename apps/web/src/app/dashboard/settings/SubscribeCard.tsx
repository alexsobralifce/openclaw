"use client";

import { useEffect, useState } from "react";
import { api, type PlanInfo } from "@/lib/api";

type Info = { plans: PlanInfo[]; plan: string | null; planUntil: string | null; billingStatus: string | null; expired: boolean; configured: boolean };
const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Assinatura do MagoBox: escolhe o plano e a forma de pagamento e segue para a página do Mercado Pago. */
export function SubscribeCard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.billing.me().then(setInfo).catch(() => undefined);
  }, []);

  async function pay(plan: string, method: "card" | "pix") {
    setBusy(`${plan}:${method}`);
    setError("");
    try {
      window.location.href = (await api.billing.checkout(plan, method)).url;
    } catch (e: any) {
      setError(e.message);
      setBusy("");
    }
  }

  if (!info?.configured) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-gray-200">Assinatura</h2>
        {info.expired ? (
          <p role="alert" className="text-xs text-red-400 mt-1">Sua assinatura venceu{info.planUntil ? ` em ${day(info.planUntil)}` : ""}. O assistente está pausado até você renovar; seus dados estão guardados.</p>
        ) : info.planUntil ? (
          <p className="text-xs text-gray-500 mt-1">Plano pago até {day(info.planUntil)}.</p>
        ) : (
          <p className="text-xs text-gray-500 mt-1">Escolha um plano e pague pelo Mercado Pago. Cartão renova sozinho todo mês; no Pix você paga a cada mês.</p>
        )}
      </div>
      {info.plans.map((p) => (
        <div key={p.id} className="border border-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-gray-200">{p.name}{info.plan === p.id && !info.expired ? " · atual" : ""}</p>
            <p className="text-xs text-gray-400">R$ {brl(p.priceBrl)}/mês</p>
          </div>
          <p className="text-xs text-gray-500">{p.summary}</p>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void pay(p.id, "card")} className="flex-1 h-10 rounded-lg bg-violet-500 text-white text-sm font-medium disabled:opacity-50">{busy === `${p.id}:card` ? "Abrindo…" : "Assinar no cartão"}</button>
            <button type="button" disabled={!!busy} onClick={() => void pay(p.id, "pix")} className="flex-1 h-10 rounded-lg bg-gray-800 text-gray-200 text-sm font-medium hover:bg-gray-700 disabled:opacity-50">{busy === `${p.id}:pix` ? "Abrindo…" : "Pagar 1 mês no Pix"}</button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
