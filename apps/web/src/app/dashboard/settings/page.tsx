"use client";

import { useEffect, useState } from "react";
import { api, MenuItem } from "@/lib/api";
import { setUser } from "@/lib/auth";
import { useMe } from "@/hooks/useMe";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";

export default function SettingsPage() {
  const me = useMe();
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", phone: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [menuMsg, setMenuMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);

  useEffect(() => {
    if (me) setForm({ name: me.name, phone: me.phone ?? "" });
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.auth.services().then(setCatalog).catch(() => {});
  }, []);

  const hasAssistant = !!me?.services?.includes("assistant");
  useEffect(() => {
    if (hasAssistant) api.assistant.menu().then((r) => setMenu(r.items)).catch((e) => setMenuMsg({ ok: false, text: e.message }));
  }, [hasAssistant]);

  async function saveMenu() {
    if (!menu) return;
    setMenuMsg(null);
    setMenuSaving(true);
    try {
      const r = await api.assistant.setMenu(menu.filter((i) => i.hidden).map((i) => i.id));
      setMenu(r.items);
      setMenuMsg({ ok: true, text: "Menu salvo. Vale na próxima vez que o menu aparecer no WhatsApp." });
    } catch (e: any) {
      setMenuMsg({ ok: false, text: e.message });
    } finally {
      setMenuSaving(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const u = await api.auth.updateMe({ name: form.name, phone: form.phone });
      setUser(u);
      setMsg({ ok: true, text: "Dados salvos." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }

  const services = me?.services ?? [];

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Configurações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Seu perfil e o número de WhatsApp usado para falar com o assistente.</p>
      </div>

      <form onSubmit={save} className={`${card} space-y-3`}>
        {msg && (
          <div className={`px-3 py-2 rounded-lg text-xs border ${msg.ok ? "bg-violet-500/10 border-violet-500/30 text-violet-300" : "bg-red-500/10 border-red-500/30 text-red-300"}`}>
            {msg.text}
          </div>
        )}
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-1">Nome</span>
          <input required minLength={2} className={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-1">Seu WhatsApp (DDI + DDD + número)</span>
          <input className={input} placeholder="Ex.: 5585912345678" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <span className="block text-[11px] text-gray-500 mt-1">
            Mensagens deste número para o WhatsApp conectado em Canais viram comandos do assistente (e-mails, agenda, conversas).
          </span>
        </label>
        <button disabled={saving} className={`${btn} bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40`}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </form>

      <section className={card}>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">Serviços liberados para sua conta</h2>
        {services.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum serviço liberado ainda. Fale com o administrador.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <span key={s} className="text-[11px] px-2 py-1 rounded-md bg-violet-500/10 text-violet-300">{catalog[s] ?? s}</span>
            ))}
          </div>
        )}
      </section>

      {services.includes("assistant") && (
        <section className={`${card} space-y-3`}>
          <h2 className="text-sm font-semibold text-gray-300">Menu do WhatsApp</h2>
          <p className="text-xs text-gray-400">
            Marque o que deve aparecer na lista do menu. O que ficar desmarcado some da lista, mas continua funcionando se você escrever ou falar
            (por exemplo, <b>agenda</b> ou <b>drive</b>).
          </p>
          {menu === null ? (
            <p className="text-xs text-gray-500">{menuMsg ? "" : "Carregando..."}</p>
          ) : (
            <ul className="space-y-1">
              {menu.map((it) => (
                <li key={it.id}>
                  <label className={`flex items-center gap-2 text-sm ${it.locked ? "text-gray-500" : "text-gray-200 cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      className="accent-violet-500"
                      checked={!it.hidden}
                      disabled={it.locked}
                      onChange={(e) => setMenu(menu.map((m) => (m.id === it.id ? { ...m, hidden: !e.target.checked } : m)))}
                    />
                    <span aria-hidden>{it.icon}</span>
                    <span>{it.label}</span>
                    {it.locked && <span className="text-[11px] text-gray-600">(sempre aparece)</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {menuMsg && <p className={`text-xs ${menuMsg.ok ? "text-violet-400" : "text-red-400"}`}>{menuMsg.text}</p>}
          {menu !== null && (
            <button type="button" onClick={saveMenu} disabled={menuSaving} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50`}>
              {menuSaving ? "Salvando..." : "Salvar menu"}
            </button>
          )}
        </section>
      )}

      {services.includes("assistant") && (
        <section className={`${card} space-y-2`}>
          <h2 className="text-sm font-semibold text-gray-300">Assistente no carro</h2>
          <p className="text-xs text-gray-400">
            Salve o número conectado nos seus contatos como <b>Assistente</b> e diga <b>modo carro</b>. As respostas passam a vir em texto curto,
            que o Android Auto (Gemini) e o CarPlay (Siri) leem em voz alta. Escolha as opções falando o número (&quot;dois&quot;, &quot;a segunda&quot;) ou o nome (&quot;a da Maria&quot;).
            Diga <b>cheguei</b> para sair; o modo também desliga sozinho após algumas horas sem uso.
          </p>
          <ul className="text-xs text-gray-400 list-disc pl-5 space-y-0.5">
            <li>Android Auto: &quot;Ok Google, mande uma mensagem no WhatsApp para Assistente: ler e-mails&quot;</li>
            <li>CarPlay: &quot;E aí Siri, manda um WhatsApp para Assistente: ler e-mails&quot;</li>
          </ul>
        </section>
      )}
    </div>
  );
}
