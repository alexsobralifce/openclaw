"use client";

// Preferência de som fica neste aparelho (localStorage). Sem ela, o som vem ligado.
const KEY = "openclaw.alerts.sound";

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Navegador sem armazenamento: a preferência vale só nesta aba
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** iPhone e navegadores bloqueiam som antes de um toque: libera o áudio no primeiro clique do painel. */
export function unlockAudio() {
  const c = audio();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

/** Dois bipes curtos. Não faz nada se o som estiver desligado ou o navegador não tocar áudio. */
export function playAlert() {
  if (!soundOn()) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  for (const offset of [0, 0.22]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.2);
  }
}
