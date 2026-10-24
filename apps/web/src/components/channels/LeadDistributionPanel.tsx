"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Seller = { name: string; phone: string };

export function LeadDistributionPanel({ channelId }: { channelId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.channels.getDistribution(channelId)
      .then((d) => {
        setEnabled(d.enabled);
        setSellers(d.sellers ?? []);
      })
      .catch((e: any) => setError(e?.message || "Não foi possível carregar a distribuição"))
      .finally(() => setLoading(false));
  }, [channelId]);

  function addSeller() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Informe o telefone com DDD");
      return;
    }
    if (sellers.some((s) => s.phone === digits)) {
      setError("Esse vendedor já está na lista");
      return;
    }
    setSellers([...sellers, { name: name.trim() || digits, phone: digits }]);
    setName("");
    setPhone("");
    setError("");
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api.channels.setDistribution(channelId, { enabled, sellers });
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="mt-3 text-xs text-gray-500">Carregando distribuição...</p>;

  return (
    <div className="mt-3 border-t border-gray-800 pt-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-200">Distribuir clientes entre vendedores</p>
        <p className="text-xs text-gray-500 mt-1">
          Cada cliente novo vai para o próximo vendedor da lista, em rodízio. Quem já foi atendido continua com o mesmo vendedor.
          O vendedor recebe o nome, o telefone e o link para abrir a conversa com o cliente.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />
        Ativar distribuição
      </label>

      <div className="space-y-2">
        {sellers.length === 0 && <p className="text-xs text-gray-500">Nenhum vendedor cadastrado.</p>}
        {sellers.map((s) => (
          <div key={s.phone} className="flex items-center justify-between gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-200 truncate">{s.name}</p>
              <p className="text-[11px] text-gray-500">{s.phone}</p>
            </div>
            <button
              onClick={() => { setSellers(sellers.filter((x) => x.phone !== s.phone)); setSaved(false); }}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remover
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do vendedor"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefone com DDD"
          inputMode="tel"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600"
        />
        <button
          onClick={addSeller}
          className="px-3 py-2 text-xs font-medium bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
        >
          Adicionar
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
        {saved && <span className="text-xs text-violet-400">Salvo</span>}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
