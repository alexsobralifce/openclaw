"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { isAdmin, useMe } from "@/hooks/useMe";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");

const ROLE_LABEL: Record<string, string> = { ROOT: "Root", ADMIN: "Administrador", USER: "Usuário" };
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Aguardando aprovação", cls: "bg-amber-500/15 text-amber-300" },
  ACTIVE: { label: "Ativo", cls: "bg-teal-500/15 text-teal-300" },
  DISABLED: { label: "Desativado", cls: "bg-red-500/15 text-red-300" },
};
const FILTERS = [
  { key: "PENDING", label: "Pendentes" },
  { key: "ACTIVE", label: "Ativos" },
  { key: "DISABLED", label: "Desativados" },
  { key: "", label: "Todos" },
];

export default function UsersPage() {
  const me = useMe();
  const [users, setUsers] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<{ services: Record<string, string>; defaults: Record<string, string[]> } | null>(null);
  const [filter, setFilter] = useState("PENDING");
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      setUsers(await api.users.list());
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
    api.users.catalog().then(setCatalog).catch((e) => setErr(e.message));
  }, []);

  const pendingCount = users.filter((u) => u.status === "PENDING").length;
  // Abre em "Todos" quando não há pendências
  useEffect(() => {
    if (users.length && !pendingCount && filter === "PENDING") setFilter("");
  }, [users.length, pendingCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => users.filter((u) => !filter || u.status === filter), [users, filter]);

  if (me && !isAdmin(me)) return <div className="p-6 text-sm text-gray-400">Apenas administradores da plataforma acessam esta página.</div>;

  return (
    <div className="p-6 max-w-4xl space-y-6 h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-200">Usuários</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Aprove cadastros, defina o nível e os serviços de cada conta. Cada usuário tem o próprio workspace; você não vê o conteúdo dele.
          </p>
        </div>
        <button onClick={() => setCreating((v) => !v)} className={`${btn} bg-teal-500 text-white hover:bg-teal-400 shrink-0`}>
          {creating ? "Fechar" : "Novo usuário"}
        </button>
      </div>

      {err && <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">{err}</div>}
      {creating && catalog && <CreateUser catalog={catalog} canAdmin={me?.platformRole === "ROOT"} onDone={() => { setCreating(false); load(); }} />}

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`${btn} border ${filter === f.key ? "border-teal-500 text-teal-300 bg-teal-500/10" : "border-gray-700 text-gray-400 hover:bg-gray-800"}`}
          >
            {f.label}
            {f.key === "PENDING" && pendingCount > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-amber-500 text-gray-950 text-[10px] font-bold">{pendingCount}</span>}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.length === 0 && <p className="text-xs text-gray-600">Nenhum usuário nesta lista.</p>}
        {catalog && shown.map((u) => <UserRow key={u.id} user={u} me={me} catalog={catalog} onChange={load} onError={setErr} />)}
      </div>
    </div>
  );
}

function UserRow({ user, me, catalog, onChange, onError }: { user: any; me: any; catalog: any; onChange: () => void; onError: (m: string) => void }) {
  const [role, setRole] = useState(user.role);
  const [services, setServices] = useState<string[]>(user.services);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [saving, setSaving] = useState(false);

  const locked = user.role === "ROOT" || user.id === me?.id || (me?.platformRole === "ADMIN" && user.role === "ADMIN");
  const dirty = role !== user.role || phone !== (user.phone ?? "") || services.slice().sort().join() !== user.services.slice().sort().join();
  const st = STATUS[user.status];

  async function save(extra: any = {}) {
    onError("");
    setSaving(true);
    try {
      await api.users.update(user.id, { role, services, phone, ...extra });
      onChange();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  /** Aprovar libera o acesso; se nenhum serviço foi marcado ainda, usa o padrão do nível. */
  function setActive(on: boolean) {
    if (on) {
      const svc = services.length ? services : catalog.defaults[role] ?? [];
      setServices(svc);
      save({ status: "ACTIVE", services: svc });
    } else {
      if (!confirm(`Desativar ${user.name}? O acesso ao painel e ao assistente é cortado na hora.`)) return;
      save({ status: "DISABLED" });
    }
  }

  async function remove() {
    if (!confirm(`Excluir ${user.name} e TODO o workspace dele (conversas, contatos, canais)? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.users.remove(user.id);
      onChange();
    } catch (e: any) {
      onError(e.message);
    }
  }

  const toggle = (s: string) => setServices((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  return (
    <div className={`${card} space-y-3 ${user.status === "DISABLED" ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <label className={`flex items-center gap-2 pt-0.5 ${locked ? "opacity-40" : "cursor-pointer"}`} title="Aprovado / ativo">
          <input type="checkbox" disabled={locked || saving} checked={user.status === "ACTIVE"} onChange={(e) => setActive(e.target.checked)} className="accent-teal-500 w-4 h-4" />
        </label>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-200">
            {user.name}
            <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
            {user.role !== "USER" && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{ROLE_LABEL[user.role]}</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {user.email} · {user.workspace?.name ?? "sem workspace"} · cadastro em {fmt(user.createdAt)}
            {user.approvedAt ? ` · aprovado em ${fmt(user.approvedAt)}` : ""}
          </p>
        </div>
        {!locked && (
          <button onClick={remove} className={`${btn} text-red-400 hover:bg-red-500/10`}>Excluir</button>
        )}
      </div>

      {locked ? (
        <p className="text-[11px] text-gray-500">
          {user.role === "ROOT" ? "O root tem acesso a todos os serviços." : user.id === me?.id ? "Edite seus próprios dados em Config." : "Apenas o root altera administradores."}
        </p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] text-gray-500 mb-1">Nível</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
                <option value="USER">Usuário</option>
                {me?.platformRole === "ROOT" && <option value="ADMIN">Administrador (aprova e gerencia usuários)</option>}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-gray-500 mb-1">WhatsApp para o assistente</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex.: 5585912345678" className={input} />
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-gray-500">Serviços liberados</span>
              <button onClick={() => setServices(catalog.defaults[role] ?? [])} className="text-[11px] text-teal-400 hover:underline">
                usar padrão do nível
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {Object.entries(catalog.services as Record<string, string>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={services.includes(key)} onChange={() => toggle(key)} className="accent-teal-500" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={!dirty || saving} onClick={() => save()} className={`${btn} bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-40`}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
            {user.status === "PENDING" && (
              <button disabled={saving} onClick={() => setActive(true)} className={`${btn} border border-teal-500/50 text-teal-300 hover:bg-teal-500/10`}>
                Aprovar com estes serviços
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CreateUser({ catalog, canAdmin, onDone }: { catalog: any; canAdmin: boolean; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "", phone: "", role: "USER" });
  const [services, setServices] = useState<string[]>(catalog.defaults.USER ?? []);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (s: string) => setServices((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.users.create({ ...form, services, phone: form.phone || undefined, workspaceName: form.workspaceName || undefined });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3`}>
      <p className="text-sm font-semibold text-gray-200">Novo usuário (já aprovado)</p>
      {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">{err}</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <input required className={input} placeholder="Nome" value={form.name} onChange={set("name")} />
        <input required type="email" className={input} placeholder="E-mail" value={form.email} onChange={set("email")} />
        <input required minLength={8} type="password" className={input} placeholder="Senha inicial (mín. 8)" value={form.password} onChange={set("password")} />
        <input className={input} placeholder="Nome do workspace (opcional)" value={form.workspaceName} onChange={set("workspaceName")} />
        <input className={input} placeholder="WhatsApp (opcional)" value={form.phone} onChange={set("phone")} />
        <select
          className={input}
          value={form.role}
          onChange={(e) => {
            set("role")(e);
            setServices(catalog.defaults[e.target.value] ?? []);
          }}
        >
          <option value="USER">Usuário</option>
          {canAdmin && <option value="ADMIN">Administrador</option>}
        </select>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {Object.entries(catalog.services as Record<string, string>).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
            <input type="checkbox" checked={services.includes(key)} onChange={() => toggle(key)} className="accent-teal-500" />
            {label}
          </label>
        ))}
      </div>
      <button type="submit" className={`${btn} bg-teal-500 text-white hover:bg-teal-400`}>Criar usuário</button>
    </form>
  );
}
