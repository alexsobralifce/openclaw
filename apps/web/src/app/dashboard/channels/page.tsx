"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { WhatsappSetup } from "@/components/channels/WhatsappSetup";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [googleMsg, setGoogleMsg] = useState("");

  async function connectGoogle() {
    setGoogleMsg("");
    try {
      const { url } = await api.google.authUrl();
      window.location.href = url;
    } catch (e: any) {
      setGoogleMsg(e.message);
    }
  }

  async function load() {
    try {
      const data = await api.channels.list();
      setChannels(data);
    } catch {}
  }

  useEffect(() => {
    load();
    const g = new URLSearchParams(window.location.search).get("google");
    if (g === "ok") setGoogleMsg("Google conectado com sucesso.");
    if (g === "error") setGoogleMsg("Não foi possível conectar o Google. Tente novamente.");
    const ig = new URLSearchParams(window.location.search).get("instagram");
    if (ig === "ok") setGoogleMsg("Instagram conectado com sucesso.");
    if (ig === "error") setGoogleMsg("Não foi possível conectar o Instagram. Tente novamente.");
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-200">Canais</h1>
          <p className="text-sm text-gray-500 mt-0.5">Conecte seus canais de atendimento</p>
        </div>
        <div className="flex items-center gap-2">
        <button
          onClick={connectGoogle}
          className="px-4 py-2 border border-gray-700 hover:bg-gray-800 text-gray-300 text-sm font-medium rounded-lg transition-colors"
        >
          Conectar Google
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <span>+</span> Adicionar canal
        </button>
        </div>
      </div>

      {googleMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-300">{googleMsg}</div>
      )}

      {/* Canal cards */}
      {channels.length === 0 ? (
        <div className="border border-dashed border-gray-800 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">📱</span>
          </div>
          <p className="text-sm font-medium text-gray-400">Nenhum canal conectado</p>
          <p className="text-xs text-gray-600 mt-1">Adicione WhatsApp, Instagram ou Email para começar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <ChannelCard key={ch.id} channel={ch} onDelete={load} />
          ))}
        </div>
      )}

      {/* Opções de canal */}
      {showAdd && (
        <AddChannelModal onClose={() => setShowAdd(false)} onCreated={(ch) => { setChannels((p) => [...p, ch]); setShowAdd(false); }} />
      )}
    </div>
  );
}

/** Manda o cliente para o login do Instagram; ele autoriza e volta para cá já conectado. */
async function connectInstagram() {
  const { url } = await api.channels.instagramAuthUrl();
  window.location.href = url;
}

function ChannelCard({ channel, onDelete }: { channel: any; onDelete: () => void }) {
  const [status, setStatus] = useState<string>("checking");
  const [showQr, setShowQr] = useState(false);
  const [actionError, setActionError] = useState("");

  const isInstagram = channel.type === "INSTAGRAM";
  const igNeedsReconnect = isInstagram && (!channel.isActive || channel.config?.needsReconnect);

  useEffect(() => {
    if (isInstagram) { setStatus(igNeedsReconnect ? "reconnect" : "open"); return; }
    if (channel.type !== "WHATSAPP") return;
    api.channels.whatsappStatus(channel.id)
      .then((s: any) => setStatus(s.state ?? "unknown"))
      .catch(() => setStatus("error"));
  }, [channel.id, channel.type, isInstagram, igNeedsReconnect]);

  const STATE_LABEL: Record<string, string> = {
    open: "Conectado", close: "Desconectado", connecting: "Conectando...",
    checking: "Verificando...", error: "Sem resposta do serviço", unknown: "Desconhecido", reconnect: "Precisa reconectar",
  };
  const STATE_COLOR: Record<string, string> = {
    open: "text-teal-400", close: "text-red-400", connecting: "text-amber-400",
    checking: "text-gray-500", error: "text-red-400", unknown: "text-gray-500", reconnect: "text-amber-400",
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-xl flex-shrink-0">
          {channel.type === "WHATSAPP" ? "🟢" : channel.type === "INSTAGRAM" ? "🟣" : channel.type === "EMAIL" ? "📧" : "💬"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-200">{channel.name}</p>
            <span className="text-[10px] font-medium bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full border border-gray-700">
              {channel.type}
            </span>
          </div>
          <p className={`text-xs font-medium mt-0.5 ${STATE_COLOR[status] ?? "text-gray-500"}`}>
            {STATE_LABEL[status] ?? status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {channel.type === "WHATSAPP" && status !== "open" && status !== "checking" && (
            <button
              onClick={() => setShowQr(true)}
              className="px-3 py-1.5 text-xs font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 rounded-lg transition-colors"
            >
              Ver QR Code
            </button>
          )}
          {isInstagram && igNeedsReconnect && (
            <button
              onClick={() => connectInstagram().catch((e: any) => setActionError(e?.message ?? "Não foi possível abrir o login do Instagram"))}
              className="px-3 py-1.5 text-xs font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 rounded-lg transition-colors"
            >
              Reconectar
            </button>
          )}
          <button
            onClick={async () => {
              setActionError("");
              try {
                if (isInstagram) await api.channels.disconnectInstagram(channel.id);
                else await api.channels.deleteWhatsapp(channel.id);
                onDelete();
              } catch (e: any) {
                setActionError(e?.message ?? "Não foi possível remover o canal");
              }
            }}
            className="px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
          >
            Remover
          </button>
        </div>
      </div>

      {actionError && <p className="mt-3 text-xs text-red-400">{actionError}</p>}

      {showQr && (
        <QrCodePanel channelId={channel.id} onClose={() => setShowQr(false)} onConnected={() => { setStatus("open"); setShowQr(false); }} />
      )}
    </div>
  );
}

function QrCodePanel({ channelId, onClose, onConnected }: { channelId: string; onClose: () => void; onConnected: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function loadQr() {
      try {
        const data: any = await api.channels.whatsappQr(channelId);
        setQr(data.base64 ?? null);
      } catch (e: any) {
        setError(e.message);
      }
    }

    loadQr();

    // Poll status a cada 3s
    interval = setInterval(async () => {
      try {
        const s: any = await api.channels.whatsappStatus(channelId);
        if (s.state === "open") { clearInterval(interval); onConnected(); }
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
  }, [channelId, onConnected]);

  return (
    <div className="mt-4 p-4 bg-gray-950 rounded-xl border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-300">Escanear QR Code</p>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors text-lg">×</button>
      </div>
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : qr ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR Code WhatsApp" className="w-48 h-48 rounded-lg" />
          <p className="text-xs text-gray-500 text-center">Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            <span className="text-xs text-gray-500">Aguardando conexão...</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-24">
          <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

function AddChannelModal({ onClose, onCreated }: { onClose: () => void; onCreated: (ch: any) => void }) {
  const [step, setStep] = useState<"pick" | "whatsapp">("pick");
  const [error, setError] = useState("");

  if (step === "whatsapp") {
    return <WhatsappSetup onClose={onClose} onCreated={onCreated} />;
  }

  const options = [
    { type: "WHATSAPP", label: "WhatsApp", icon: "🟢", desc: "via Evolution API", action: () => setStep("whatsapp") },
    { type: "EMAIL", label: "Email", icon: "📧", desc: "IMAP + SMTP", action: () => {} },
    {
      type: "INSTAGRAM", label: "Instagram", icon: "🟣", desc: "Entrar com o Instagram",
      action: () => connectInstagram().catch((e: any) => setError(e.message)),
    },
    { type: "WEBCHAT", label: "Webchat", icon: "💬", desc: "Widget embeddável", action: () => {} },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm font-semibold text-gray-200">Escolher canal</p>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xl transition-colors">×</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {options.map((opt) => (
            <button
              key={opt.type}
              onClick={opt.action}
              disabled={opt.type !== "WHATSAPP" && opt.type !== "INSTAGRAM"}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-800 bg-gray-950 hover:border-teal-500/40 hover:bg-teal-500/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-2xl">{opt.icon}</span>
              <span className="text-xs font-semibold text-gray-300">{opt.label}</span>
              <span className="text-[10px] text-gray-600">{opt.desc}</span>
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
