import { api } from "@/lib/api";

const urlBase64ToUint8Array = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Este navegador sabe receber notificações push? (No iPhone, só com o app instalado na tela inicial.) */
export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Registra o service worker (notificações e instalação). Falha em silêncio: o painel funciona sem ele. */
export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** Pede a permissão (precisa vir de um clique) e assina o push neste navegador. */
export async function enablePush(publicKey: string) {
  const reg = (await registerServiceWorker()) ?? (() => { throw new Error("Este navegador não permite notificações."); })();
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Permissão de notificação negada no navegador.");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api.appChat.pushSubscribe(sub.toJSON());
}

export async function disablePush() {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.appChat.pushUnsubscribe(sub.endpoint);
  await sub.unsubscribe();
}
