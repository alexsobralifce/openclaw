"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { enablePush, pushSupported, registerServiceWorker } from "@/lib/push";

const DISMISS_KEY = "oc_pwa_dismissed";
const REASK_MS = 7 * 86_400_000;

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/**
 * Ao entrar no painel: registra o service worker e oferece instalar o atalho e ligar as notificações.
 * O navegador só concede as duas coisas depois de um toque do usuário, então o aviso traz os botões; "Agora não" só volta em 7 dias.
 */
export function PwaPrompt() {
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);
  const [push, setPush] = useState<{ enabled: boolean; publicKey: string; subscribed: boolean } | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void registerServiceWorker();
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    if ("Notification" in window) setPerm(Notification.permission);
    setHidden(Date.now() - Number(read(DISMISS_KEY) ?? 0) < REASK_MS);
    api.appChat.pushStatus().then(setPush).catch(() => undefined);

    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallEvent); };
    const onInstalled = () => { setInstallEvt(null); setStandalone(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const canInstall = !standalone && !!installEvt;
  const iosInstall = !standalone && ios && !installEvt; // iPhone não tem botão de instalar: é pelo menu Compartilhar
  const canPush = !!push?.enabled && pushSupported() && !push.subscribed && perm !== "denied";
  if (hidden || (!canInstall && !iosInstall && !canPush)) return null;

  const later = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setHidden(true);
  };

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    setInstallEvt(null);
    if (outcome === "dismissed") later();
  }

  async function notify() {
    if (!push) return;
    setBusy(true);
    setError("");
    try {
      await enablePush(push.publicKey);
      setPush({ ...push, subscribed: true });
    } catch (e: any) {
      setPerm("Notification" in window ? Notification.permission : "default");
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const btn = "px-3 py-1.5 rounded-lg text-xs font-medium";
  return (
    <div role="dialog" aria-label="Instalar o MagoBox e ativar notificações" className="fixed z-50 inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-4 md:bottom-4 md:w-96 bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-xl space-y-3">
      <p className="text-sm font-medium text-gray-200">Tenha o MagoBox à mão</p>
      <ul className="text-xs text-gray-400 space-y-1">
        {(canInstall || iosInstall) && <li>Atalho na tela inicial, abrindo como um app.</li>}
        {canPush && <li>Avisos do assistente (e-mails, lembretes e respostas) mesmo com o app fechado.</li>}
      </ul>
      {iosInstall && <p className="text-xs text-gray-300">No iPhone: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. As notificações ficam disponíveis depois disso.</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {canInstall && <button onClick={install} className={`${btn} bg-violet-500 text-white`}>Criar atalho</button>}
        {canPush && <button onClick={notify} disabled={busy} className={`${btn} bg-violet-500 text-white disabled:opacity-50`}>{busy ? "Ativando…" : "Ativar notificações"}</button>}
        <button onClick={later} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Agora não</button>
      </div>
    </div>
  );
}
