"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { playAlert, setSoundOn, soundOn, unlockAudio } from "@/lib/alert-sound";
import { disablePush, enablePush, pushSupported } from "@/lib/push";

type PushStatus = { enabled: boolean; publicKey: string; subscribed: boolean };

function Toggle({ label, description, on, disabled, onChange }: { label: string; description: string; on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-gray-200">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onChange}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-violet-600" : "bg-gray-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

/** Liga e desliga o som e o push dos avisos no celular. */
export function AlertPrefs() {
  const [sound, setSound] = useState(true);
  const [supported, setSupported] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSound(soundOn());
    const ok = pushSupported();
    setSupported(ok);
    if (ok) api.appChat.pushStatus().then(setPush).catch(() => setPush(null));
  }, []);

  function toggleSound() {
    const on = !sound;
    setSound(on);
    setSoundOn(on);
    if (on) {
      unlockAudio();
      playAlert();
    }
  }

  async function togglePush() {
    if (!push) return;
    setBusy(true);
    setError("");
    try {
      if (push.subscribed) await disablePush();
      else await enablePush(push.publicKey);
      setPush({ ...push, subscribed: !push.subscribed });
    } catch (e: any) {
      setError(e?.message || "Não foi possível alterar as notificações");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300">Alertas no celular</h2>

      <Toggle
        label="Som ao chegar mensagem de cliente"
        description="Toca enquanto o painel estiver aberto. A escolha fica salva neste aparelho."
        on={sound}
        onChange={toggleSound}
      />

      {push?.enabled && (
        <Toggle
          label="Notificações push"
          description="Avisos de compromissos, mesmo com o app fechado. Vale neste navegador."
          on={push.subscribed}
          disabled={busy}
          onChange={togglePush}
        />
      )}
      {!push?.enabled && supported && <p className="text-xs text-gray-500">Notificações push não estão disponíveis no servidor.</p>}
      {!supported && <p className="text-xs text-gray-500">Este navegador não recebe notificações. No iPhone, adicione o app à tela inicial.</p>}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
