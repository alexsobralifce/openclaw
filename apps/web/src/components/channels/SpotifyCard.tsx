"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { hasService, useMe } from "@/hooks/useMe";

/** Conexão do Spotify: só aparece para quem tem o serviço liberado e se o servidor estiver configurado. */
export function SpotifyCard({ onMessage }: { onMessage: (m: string) => void }) {
  const me = useMe();
  const [st, setSt] = useState<{ configured: boolean; connected: boolean; name?: string; premium?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = hasService(me, "spotify");

  useEffect(() => {
    if (allowed) api.spotify.status().then(setSt).catch(() => undefined);
  }, [allowed]);

  if (!allowed || !st?.configured) return null;

  async function connect() {
    setBusy(true);
    try {
      window.location.href = (await api.spotify.authUrl()).url;
    } catch (e: any) {
      onMessage(e.message);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.spotify.disconnect();
      setSt({ ...st!, connected: false, name: undefined, premium: undefined });
      onMessage("Spotify desconectado. As playlists criadas continuam na sua conta.");
    } catch (e: any) {
      onMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <span aria-hidden className="text-2xl">🎧</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-200">Spotify</p>
        <p className="text-xs text-gray-500">
          {st.connected ? `Conectado como ${st.name}${st.premium ? " (Premium)" : " — sem Premium: só dá para buscar e criar playlists"}` : "Conecte a sua conta para buscar, tocar e criar playlists pelo assistente: “buscar música catingueira”, “tocar catingueira”."}
        </p>
        {!st.connected && <p className="mt-1 text-[11px] text-gray-500">Neste momento o Spotify libera até 5 contas neste app, cadastradas pelo administrador. Sem conectar, o assistente ainda busca músicas e playlists e manda o link.</p>}
      </div>
      {st.connected ? (
        <button onClick={() => void disconnect()} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50">Desconectar</button>
      ) : (
        <button onClick={() => void connect()} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50">Conectar Spotify</button>
      )}
    </div>
  );
}
