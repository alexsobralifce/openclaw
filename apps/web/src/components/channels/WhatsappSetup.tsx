"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  onClose: () => void;
  onCreated: (channel: any) => void;
}

export function WhatsappSetup({ onClose, onCreated }: Props) {
  const [name, setName] = useState("WhatsApp Principal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { channel } = await api.channels.createWhatsapp(name.trim());
      onCreated(channel);
    } catch (err: any) {
      setError(err.message || "Erro ao criar canal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <span className="text-xl">🟢</span>
            <p className="text-sm font-semibold text-gray-200">Conectar WhatsApp</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xl transition-colors">×</button>
        </div>

        <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-violet-400 font-medium mb-1">Requisitos</p>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>• Evolution API rodando (docker ou self-hosted)</li>
            <li>• <code className="font-mono bg-gray-800 px-1 rounded">EVOLUTION_API_URL</code> configurado no .env</li>
            <li>• Celular com WhatsApp para escanear o QR</li>
          </ul>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome do canal</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? "Criando instância..." : "Criar e gerar QR Code"}
          </button>
        </form>
      </div>
    </div>
  );
}
