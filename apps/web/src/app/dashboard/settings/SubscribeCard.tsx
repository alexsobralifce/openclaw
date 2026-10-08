"use client";

import { useEffect, useState } from "react";
import { api, type PlanInfo } from "@/lib/api";
import { CardBrick } from "./CardBrick";

type Info = { plans: PlanInfo[]; plan: string | null; planUntil: string | null; billingStatus: string | null; expired: boolean; configured: boolean; publicKey: string | null };
const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Assinatura do MagoBox: escolhe o plano e a forma de pagamento e segue para a página do Mercado Pago. */
export function SubscribeCard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [card, setCard] = useState<PlanInfo | null>(null); // plano com o formulário de cartão aberto
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Se ainda não há plano pago ativo, confere no Mercado Pago (cobre o aviso que atrasou) antes de mostrar a situação
    api.billing.me().then((i) => {
      setInfo(i);
      if (i.configured && (!i.planUntil || i.expired)) api.billing.sync().then((s) => setInfo((cur) => (cur ? { ...cur, ...s } : cur))).catch(() => undefined);
    }).catch(() => undefined);
  }, []);

  /** Cartão pago aqui dentro: o primeiro débito pode levar um tempo, então confere de tempos em tempos. */
  function afterCard() {
    setCard(null);
    setDone(true);
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      api.billing.sync().then((s) => { setInfo((cur) => (cur ? { ...cur, ...s } : cur)); if (s.planUntil && !s.expired) { setDone(false); clearInterval(t); } }).catch(() => undefined);
      if (tries >= 30) clearInterval(t);
    }, 10_000);
  }

  async function pay(plan: string, method: "card" | "pix") {
    if (method === "card" && info?.publicKey) {
      setCard(info?.plans.find((p) => p.id === plan) ?? null);
      return;
    }
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
      {done && <p role="status" className="text-sm text-violet-300">Cartão recebido! O Mercado Pago confirma o primeiro pagamento em instantes; esta tela atualiza sozinha.</p>}
      {card && info.publicKey && <CardBrick plan={card} publicKey={info.publicKey} onDone={afterCard} onCancel={() => setCard(null)} />}
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
