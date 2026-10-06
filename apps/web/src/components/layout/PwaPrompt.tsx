"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PWA_DISMISS_KEY, WA_DISMISS_KEY } from "@/lib/auth";
import { hasService, useMe } from "@/hooks/useMe";
import { enablePush, pushSupported, registerServiceWorker } from "@/lib/push";


interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

type Platform = "ios" | "android" | "other";

const detectPlatform = (): Platform => {
  const ua = navigator.userAgent;
  // iPadOS 13+ se apresenta como Mac, mas tem tela de toque
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /android/i.test(ua) ? "android" : "other";
};

/**
 * A cada login, se o app ainda não está instalado: no Android pede para instalar o app e no iPhone para criar o atalho; também oferece ligar as notificações.
 * O navegador só concede instalação e notificação depois de um toque do usuário, então o aviso traz os botões.
 * "Agora não" vale só até o próximo login (o login apaga a marca, ver `setToken`).
 * Resolvido o aviso de instalação, pergunta se quer conectar o WhatsApp (só a quem ainda não tem um) e leva para Canais.
 */
export function PwaPrompt() {
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [platform, setPlatform] = useState<Platform>("other");
  const [push, setPush] = useState<{ enabled: boolean; publicKey: string; subscribed: boolean } | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [hidden, setHidden] = useState(true);
  const [waited, setWaited] = useState(false); // dá tempo ao Chrome de oferecer o botão de instalar antes de mostrar o passo a passo manual
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = useMe();
  const pathname = usePathname();
  const [hasWhatsapp, setHasWhatsapp] = useState<boolean | null>(null); // null: ainda não sabemos
  const [waHidden, setWaHidden] = useState(true);

  useEffect(() => {
    setWaHidden(!!read(WA_DISMISS_KEY));
    api.channels.list().then((l) => setHasWhatsapp(l.some((c) => c.type === "WHATSAPP"))).catch(() => undefined);
  }, []);

  useEffect(() => {
    void registerServiceWorker();
    const timer = setTimeout(() => setWaited(true), 1500);
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);
    setPlatform(detectPlatform());
    if ("Notification" in window) setPerm(Notification.permission);
    setHidden(!!read(PWA_DISMISS_KEY));
    api.appChat.pushStatus().then(setPush).catch(() => undefined);

    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallEvent); };
    const onInstalled = () => { setInstallEvt(null); setStandalone(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const canInstall = !standalone && !!installEvt; // Chrome/Edge: botão que abre o instalador
  const iosInstall = !standalone && platform === "ios"; // iPhone não tem botão: é pelo menu Compartilhar
  const androidManual = !standalone && platform === "android" && !installEvt && waited; // navegador que não ofereceu o botão: pelo menu
  const canPush = !!push?.enabled && pushSupported() && !push.subscribed && perm !== "denied";
  const pwaOffer = !hidden && (canInstall || iosInstall || androidManual || canPush);
  const waOffer = !waHidden && hasWhatsapp === false && hasService(me, "channels") && pathname !== "/dashboard/channels" && waited;
  if (!pwaOffer) return waOffer ? <WhatsappAsk onDismiss={() => { try { localStorage.setItem(WA_DISMISS_KEY, "1"); } catch {} setWaHidden(true); }} /> : null;

  const later = () => {
    try { localStorage.setItem(PWA_DISMISS_KEY, "1"); } catch {}
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
    <div role="dialog" aria-label="Instalar o MagoBox e ativar notificações" className="fixed z-40 inset-x-3 top-[calc(3rem+env(safe-area-inset-top))] md:inset-x-auto md:top-auto md:right-4 md:bottom-4 md:w-96 bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-xl space-y-3">
      <p className="text-sm font-medium text-gray-200">
        {iosInstall ? "Crie o atalho do MagoBox" : canInstall || androidManual ? "Instale o app MagoBox" : "Ative as notificações"}
      </p>
      <ul className="text-xs text-gray-400 space-y-1">
        {(canInstall || androidManual || iosInstall) && <li>Abre em tela cheia, como um app, direto da tela inicial.</li>}
        {canPush && <li>Avisos do assistente (e-mails, lembretes e respostas) mesmo com o app fechado.</li>}
      </ul>
      {iosInstall && (
        <ol className="text-xs text-gray-300 list-decimal pl-4 space-y-0.5">
          <li>Toque em <b>Compartilhar</b> (o quadrado com a seta para cima).</li>
          <li>Role e escolha <b>Adicionar à Tela de Início</b>.</li>
          <li>Toque em <b>Adicionar</b> e abra o MagoBox pelo ícone novo.</li>
          <li className="text-gray-400 list-none -ml-4">As notificações ficam disponíveis depois disso.</li>
        </ol>
      )}
      {androidManual && <p className="text-xs text-gray-300">Toque no menu <b>⋮</b> do navegador e escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>). Se a opção não aparecer, abra o endereço direto no Chrome.</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {canInstall && <button onClick={install} className={`${btn} bg-violet-500 text-white`}>{platform === "android" ? "Instalar app" : "Criar atalho"}</button>}
        {canPush && <button onClick={notify} disabled={busy} className={`${btn} bg-violet-500 text-white disabled:opacity-50`}>{busy ? "Ativando…" : "Ativar notificações"}</button>}
        <button onClick={later} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Agora não</button>
      </div>
    </div>
  );
}

function WhatsappAsk({ onDismiss }: { onDismiss: () => void }) {
  const btn = "px-3 py-1.5 rounded-lg text-xs font-medium";
  return (
    <div role="dialog" aria-label="Conectar o WhatsApp" className="fixed z-40 inset-x-3 top-[calc(3rem+env(safe-area-inset-top))] md:inset-x-auto md:top-auto md:right-4 md:bottom-4 md:w-96 bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-xl space-y-3">
      <p className="text-sm font-medium text-gray-200">Quer conectar o seu WhatsApp?</p>
      <p className="text-xs text-gray-400">Conectando, você conversa com o assistente e atende seus clientes pelo próprio WhatsApp. Leva um minuto: é só ler um QR Code.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/channels" onClick={onDismiss} className={`${btn} bg-violet-500 text-white`}>Conectar agora</Link>
        <button onClick={onDismiss} className={`${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`}>Agora não</button>
      </div>
    </div>
  );
}
