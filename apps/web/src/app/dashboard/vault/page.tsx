"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { RecoveryKeyBox } from "@/components/vault/RecoveryKeyBox";
import { parsePasswordList, rowProblem, type ImportRow } from "@/lib/vault-import";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40";
const primary = `${btn} bg-violet-500 text-white hover:bg-violet-400`;
const ghost = `${btn} bg-gray-800 text-gray-300 hover:bg-gray-700`;
const danger = `${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25`;

type Status = { exists: boolean; unlocked: boolean; hasRecovery?: boolean; hasPin?: boolean; waLocked?: boolean; expiresAt?: number };
type Entry = { id: string; title: string; url: string; username: string; hasPassword: boolean; hasNotes: boolean; whatsapp?: boolean; updatedAt: string; corrupted?: boolean };
type Form = { title: string; url: string; username: string; password: string; notes: string; whatsapp: boolean };
const empty: Form = { title: "", url: "", username: "", password: "", notes: "", whatsapp: true };

/** Senha aleatória forte, do gerador seguro do navegador (sem caracteres que se confundem). */
function generatePassword(length = 20): string {
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%&*?-_+="];
  const all = sets.join("");
  const rnd = (n: number) => {
    const max = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= max);
    return buf[0] % n;
  };
  const chars = sets.map((s) => s[rnd(s.length)]);
  while (chars.length < length) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const isLockedError = (m: string) => /cofre está bloqueado/i.test(m);

export default function VaultPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A chave de recuperação aparece uma vez: fica aqui, acima de tudo, até o dono confirmar que guardou
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.vault.status());
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Erro de "bloqueado" volta para a tela de senha em vez de ficar só como aviso. */
  const fail = useCallback(
    (e: any) => {
      setMsg({ ok: false, text: e.message });
      if (isLockedError(e.message)) void refresh();
    },
    [refresh],
  );

  if (!status) return <div className="p-6 text-sm text-gray-500">{msg ? msg.text : "Carregando..."}</div>;

  if (recoveryKey) {
    return (
      <div className="p-4 md:p-6 max-w-3xl space-y-5 h-full overflow-y-auto">
        <h1 className="text-xl font-semibold text-gray-200">Cofre de senhas</h1>
        <RecoveryKeyBox keyText={recoveryKey} onDone={() => { setRecoveryKey(null); setMsg({ ok: true, text: "Pronto. Agora desbloqueie o cofre com a senha mestra." }); void refresh(); }} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Cofre de senhas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Senhas de e-mails e sites, cifradas com uma senha mestra que só você sabe.</p>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${msg.ok ? "bg-violet-500/10 border-violet-500/30 text-violet-300" : "bg-red-500/10 border-red-500/30 text-red-300"}`}>{msg.text}</div>
      )}

      {!status.exists ? (
        <Setup busy={busy} setBusy={setBusy} setMsg={setMsg} onDone={setRecoveryKey} />
      ) : !status.unlocked ? (
        <><Unlock status={status} busy={busy} setBusy={setBusy} setMsg={setMsg} onDone={refresh} /><PinForm status={status} setMsg={setMsg} onDone={refresh} /></>
      ) : (
        <Unlocked status={status} setMsg={setMsg} fail={fail} refresh={refresh} showKey={setRecoveryKey} />
      )}
    </div>
  );
}

function Setup({ busy, setBusy, setMsg, onDone }: { busy: boolean; setBusy: (b: boolean) => void; setMsg: (m: any) => void; onDone: (recoveryKey: string) => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw !== pw2) return setMsg({ ok: false, text: "As duas senhas não são iguais." });
    setBusy(true);
    try {
      const r = await api.vault.setup(pw);
      setPw("");
      setPw2("");
      onDone(r.recoveryKey);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3`}>
      <h2 className="text-sm font-semibold text-gray-300">Criar o cofre</h2>
      <div className="px-3 py-2 rounded-lg text-xs border bg-amber-500/10 border-amber-500/30 text-amber-200 space-y-1">
        <p><b>Guarde bem a senha mestra: ela não pode ser recuperada.</b> Quem administra o servidor também não consegue abrir o cofre sem ela. Se você esquecê-la, as senhas guardadas se perdem.</p>
        <p>Ela é enviada ao servidor por HTTPS apenas para gerar a chave e nunca é gravada.</p>
        <p>Depois de criar, você recebe uma <b>chave de recuperação</b>: com ela e o link do seu e-mail dá para trocar a senha mestra sem perder nada.</p>
      </div>
      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-1">Senha mestra (mínimo 12 caracteres; misture tipos ou use uma frase longa)</span>
        <input type="password" required autoComplete="new-password" className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-1">Repita a senha mestra</span>
        <input type="password" required autoComplete="new-password" className={input} value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      <button disabled={busy} className={primary}>{busy ? "Criando..." : "Criar cofre"}</button>
    </form>
  );
}

function Unlock({ status, busy, setBusy, setMsg, onDone }: { status: Status; busy: boolean; setBusy: (b: boolean) => void; setMsg: (m: any) => void; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [minutes, setMinutes] = useState(15);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.vault.unlock(pw, minutes);
      setPw("");
      onDone();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setMsg(null);
    setBusy(true);
    try {
      const r = await api.vault.requestReset();
      setMsg({ ok: true, text: `Enviei um link para ${r.sentTo} (vale por ${r.expiresMinutes} minutos). Abra-o logado neste painel e tenha em mãos a chave de recuperação.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3`}>
      <h2 className="text-sm font-semibold text-gray-300">🔒 Cofre bloqueado</h2>
      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-1">Senha mestra</span>
        <input type="password" required autoFocus autoComplete="current-password" className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-1">Manter desbloqueado por</span>
        <select className={input} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
        </select>
      </label>
      {status.waLocked && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-amber-500/10 border-amber-500/30 text-amber-200">
          O WhatsApp foi bloqueado por códigos errados. Ao desbloquear aqui com a senha mestra, ele volta a funcionar.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} className={primary}>{busy ? "Abrindo..." : "Desbloquear"}</button>
        <button type="button" disabled={busy} onClick={forgot} className="text-xs text-gray-400 underline hover:text-gray-200 disabled:opacity-40">Esqueci a senha mestra</button>
      </div>
    </form>
  );
}

function useCountdown(expiresAt?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor(((expiresAt ?? 0) - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` };
}

function Unlocked({ status, setMsg, fail, refresh, showKey }: { status: Status; setMsg: (m: any) => void; fail: (e: any) => void; refresh: () => void; showKey: (k: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ id?: string; form: Form } | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<{ ok: boolean; text: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newKeyPw, setNewKeyPw] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const { left, label } = useCountdown(status.expiresAt);

  const load = useCallback(async () => {
    try {
      setEntries(await api.vault.list());
    } catch (e: any) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ao expirar, volta para a tela de senha e apaga da memória da página o que estava visível
  useEffect(() => {
    if (left === 0) {
      setShown({});
      setEditing(null);
      void refresh();
    }
  }, [left, refresh]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.title} ${e.url} ${e.username}`.toLowerCase().includes(q)) : entries;
  }, [entries, search]);

  async function reveal(id: string) {
    try {
      const d = await api.vault.reveal(id);
      setShown((s) => ({ ...s, [id]: d.password }));
      clearTimeout(timers.current[id]);
      // A senha some da tela sozinha
      timers.current[id] = setTimeout(() => setShown((s) => { const { [id]: _x, ...rest } = s; return rest; }), 20_000);
    } catch (e: any) {
      fail(e);
    }
  }

  async function copy(id: string) {
    try {
      const pw = shown[id] ?? (await api.vault.reveal(id)).password;
      await navigator.clipboard.writeText(pw);
      setMsg({ ok: true, text: "Senha copiada. Vou limpar a área de transferência em 20 segundos." });
      setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 20_000);
    } catch (e: any) {
      fail(e);
    }
  }

  async function edit(id: string) {
    try {
      const d = await api.vault.reveal(id);
      setEditing({ id, form: { title: d.title, url: d.url, username: d.username, password: d.password, notes: d.notes, whatsapp: d.whatsapp !== false } });
    } catch (e: any) {
      fail(e);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setMsg(null);
    try {
      if (editing.id) await api.vault.update(editing.id, editing.form);
      else await api.vault.create(editing.form);
      setEditing(null);
      setShown({});
      setMsg({ ok: true, text: "Salvo." });
      void load();
    } catch (e: any) {
      fail(e);
    }
  }

  async function remove(id: string) {
    try {
      await api.vault.remove(id);
      setConfirmDel(null);
      setMsg({ ok: true, text: "Entrada excluída." });
      void load();
    } catch (e: any) {
      fail(e);
    }
  }

  async function lock() {
    await api.vault.lock().catch(() => {});
    setShown({});
    void refresh();
  }

  async function verify() {
    setIntegrity(null);
    try {
      const r = await api.vault.verify();
      setIntegrity(
        r.ok
          ? { ok: true, text: `Íntegro: ${r.blocks} registros conferidos, nenhum alterado.` }
          : { ok: false, text: `${r.problem ?? ""}${r.unreadable ? ` ${r.unreadable} entrada(s) não abrem mais.` : ""}`.trim() || "Foi encontrada uma inconsistência." },
      );
    } catch (e: any) {
      fail(e);
    }
  }

  const set = (k: keyof Form, v: string) => setEditing((s) => (s ? { ...s, form: { ...s.form, [k]: v } } : s));

  return (
    <>
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-violet-300">🔓 Desbloqueado · fecha em {label}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-md ${status.hasPin && !status.waLocked ? "bg-violet-500/10 text-violet-300" : "bg-gray-800 text-gray-400"}`}>
            WhatsApp: {!status.hasPin ? "sem código" : status.waLocked ? "bloqueado" : "ativo"}
          </span>
        </div>
        {/* No celular: 2 colunas de botões do mesmo tamanho; no computador, em linha */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <button onClick={verify} className={`${ghost} py-2.5 sm:py-1.5`}>Verificar integridade</button>
          <button onClick={() => setChanging((c) => !c)} className={`${ghost} py-2.5 sm:py-1.5`}>Trocar senha mestra</button>
          <button onClick={() => setNewKeyPw(newKeyPw === null ? "" : null)} className={`${ghost} py-2.5 sm:py-1.5`}>{status.hasRecovery ? "Chave de recuperação" : "Criar chave de recuperação"}</button>
          <button onClick={lock} className={`${danger} py-2.5 sm:py-1.5 sm:ml-auto`}>Bloquear agora</button>
        </div>
      </div>

      <PinForm status={status} setMsg={setMsg} onDone={refresh} />

      {!status.hasRecovery && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-amber-500/10 border-amber-500/30 text-amber-200">
          Este cofre ainda não tem chave de recuperação: se você esquecer a senha mestra, as senhas se perdem. Crie uma agora.
        </div>
      )}

      {newKeyPw !== null && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.vault.newRecoveryKey(newKeyPw);
              setNewKeyPw(null);
              showKey(r.recoveryKey);
            } catch (err: any) {
              fail(err);
            }
          }}
          className={`${card} space-y-3`}
        >
          <p className="text-xs text-gray-400">Gerar uma nova chave <b>invalida a anterior</b>. Confirme com a senha mestra.</p>
          <input type="password" required autoFocus autoComplete="current-password" placeholder="Senha mestra" className={input} value={newKeyPw} onChange={(e) => setNewKeyPw(e.target.value)} />
          <button className={primary}>Gerar chave</button>
        </form>
      )}

      {integrity && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${integrity.ok ? "bg-violet-500/10 border-violet-500/30 text-violet-300" : "bg-red-500/10 border-red-500/30 text-red-300"}`}>
          {integrity.ok ? "✅ " : "⚠️ "}{integrity.text}
        </div>
      )}

      {changing && <ChangeMaster onDone={() => { setChanging(false); void refresh(); }} setMsg={setMsg} />}

      <div className="flex gap-2">
        <input className={input} placeholder="Buscar" aria-label="Buscar por site, usuário ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={() => setEditing({ form: { ...empty, password: generatePassword() } })} className={`${primary} whitespace-nowrap`} aria-label="Nova entrada">+ Nova</button>
        <button onClick={() => setImporting((v) => !v)} className={`${ghost} whitespace-nowrap`}>Importar lista</button>
      </div>

      {importing && <ImportList setMsg={setMsg} onDone={() => { setImporting(false); void load(); }} onCancel={() => setImporting(false)} />}

      {editing && (
        <form onSubmit={save} className={`${card} space-y-3`}>
          <h2 className="text-sm font-semibold text-gray-300">{editing.id ? "Editar entrada" : "Nova entrada"}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] text-gray-500 mb-1">Site ou serviço *</span>
              <input required autoFocus className={input} value={editing.form.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: GitHub" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-gray-500 mb-1">Endereço</span>
              <input className={input} value={editing.form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://..." />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[11px] text-gray-500 mb-1">Usuário ou e-mail de entrada</span>
              <input className={input} autoComplete="off" value={editing.form.username} onChange={(e) => set("username", e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[11px] text-gray-500 mb-1">Senha</span>
              <div className="flex gap-2">
                <input className={`${input} font-mono`} autoComplete="off" value={editing.form.password} onChange={(e) => set("password", e.target.value)} />
                <button type="button" onClick={() => set("password", generatePassword())} className={`${ghost} whitespace-nowrap`}>Gerar</button>
              </div>
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[11px] text-gray-500 mb-1">Notas (só aparecem aqui no painel)</span>
              <textarea rows={2} className={input} value={editing.form.notes} onChange={(e) => set("notes", e.target.value)} />
            </label>
            <label className="flex items-start gap-2 text-xs text-gray-400 sm:col-span-2">
              <input type="checkbox" className="mt-0.5" checked={editing.form.whatsapp} onChange={(e) => setEditing((s) => (s ? { ...s, form: { ...s.form, whatsapp: e.target.checked } } : s))} />
              <span>Consultável pelo WhatsApp (com o código de 4 dígitos). Desmarque para senhas críticas, como banco: essas só abrem aqui, com a senha mestra.</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button className={primary}>Salvar</button>
            <button type="button" onClick={() => setEditing(null)} className={ghost}>Cancelar</button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-xs text-gray-500">{entries.length ? "Nada encontrado." : "Nenhuma entrada ainda. Use “+ Nova entrada”."}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div key={e.id} className={`${card} ${e.corrupted ? "border-red-500/40" : ""}`}>
              <div className="flex items-start gap-2">
                {/* O nome usa todo o espaço que sobra e quebra em mais de uma linha, em vez de virar "E…" */}
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-sm font-medium text-gray-200 [overflow-wrap:anywhere]">
                    {e.title}
                    {e.whatsapp && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 align-middle whitespace-nowrap">WhatsApp</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5 [overflow-wrap:anywhere]">{[e.username, e.url].filter(Boolean).join(" · ")}</p>
                </div>
                {e.corrupted ? (
                  <span className="text-[11px] text-red-300 pt-1">registro alterado ou corrompido</span>
                ) : (
                  <div className="flex items-center flex-shrink-0">
                    <IconButton label={shown[e.id] ? "Ocultar senha" : "Ver senha"} onClick={() => (shown[e.id] ? setShown((s) => { const { [e.id]: _x, ...r } = s; return r; }) : reveal(e.id))}>
                      {shown[e.id] ? <path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22" /> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></>}
                    </IconButton>
                    <IconButton label="Copiar senha" onClick={() => copy(e.id)}>
                      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </IconButton>
                    <IconButton label="Editar entrada" onClick={() => edit(e.id)}>
                      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </IconButton>
                    <IconButton label="Excluir entrada" tone="danger" onClick={() => setConfirmDel(e.id)}>
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                    </IconButton>
                  </div>
                )}
              </div>
              {confirmDel === e.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
                  <span className="text-xs text-gray-400 mr-auto">Excluir de vez? Não dá para desfazer.</span>
                  <button onClick={() => remove(e.id)} className={danger}>Excluir</button>
                  <button onClick={() => setConfirmDel(null)} className={ghost}>Cancelar</button>
                </div>
              )}
              {shown[e.id] !== undefined && <p className="mt-2 font-mono text-sm text-violet-300 break-all select-all">{shown[e.id] || "(sem senha)"}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Cola uma lista, confere e edita cada item e só então grava; cada senha vira uma entrada separada. */
function ImportList({ setMsg, onDone, onCancel }: { setMsg: (m: any) => void; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const upd = (i: number, k: keyof ImportRow, v: string) => setRows((r) => r && r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const drop = (i: number) => setRows((r) => r && r.filter((_, j) => j !== i));
  const bad = rows?.filter((r) => rowProblem(r)).length ?? 0;

  async function saveAll() {
    if (!rows) return;
    setBusy(true);
    setMsg(null);
    const failed: ImportRow[] = [];
    const errs: Record<number, string> = {};
    for (const r of rows) {
      try {
        await api.vault.create(r);
      } catch (e: any) {
        errs[failed.length] = e?.message ?? "não salvou";
        failed.push(r);
      }
    }
    setBusy(false);
    const ok = rows.length - failed.length;
    if (!failed.length) {
      setMsg({ ok: true, text: `${ok} ${ok === 1 ? "senha salva" : "senhas salvas"}.` });
      return onDone();
    }
    setRows(failed);
    setErrors(errs);
    setMsg({ ok: false, text: `${ok} salvas; ${failed.length} não salvaram. Corrija abaixo e tente de novo.` });
  }

  if (!rows)
    return (
      <div className={`${card} space-y-3`}>
        <h2 className="text-sm font-semibold text-gray-300">Importar lista de senhas</h2>
        <p className="text-xs text-gray-400">
          Cole uma senha por linha (<code>site | usuário | senha</code>) ou blocos com rótulos (<code>Site:</code>, <code>Usuário:</code>, <code>Senha:</code>) separados por linha em branco.
          O texto é lido aqui no navegador; nada é enviado antes de você confirmar.
        </p>
        <textarea className={`${input} h-40 font-mono`} aria-label="Lista de senhas" autoComplete="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <button className={primary} disabled={!text.trim()} onClick={() => { setRows(parsePasswordList(text)); setText(""); }}>Reconhecer</button>
          <button className={ghost} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    );

  return (
    <div className={`${card} space-y-3`}>
      <h2 className="text-sm font-semibold text-gray-300">Confira antes de salvar ({rows.length})</h2>
      {!rows.length && <p className="text-xs text-gray-500">Nada para salvar.</p>}
      {rows.map((r, i) => {
        const problem = rowProblem(r);
        return (
          <div key={i} className={`rounded-lg border p-3 space-y-2 ${problem || errors[i] ? "border-amber-500/40" : "border-gray-800"}`}>
            <div className="grid sm:grid-cols-2 gap-2">
              <input className={input} placeholder="Nome do site ou serviço" aria-label="Nome" value={r.title} onChange={(e) => upd(i, "title", e.target.value)} />
              <input className={input} placeholder="Endereço (opcional)" aria-label="Endereço" value={r.url} onChange={(e) => upd(i, "url", e.target.value)} />
              <input className={input} placeholder="Usuário ou e-mail" aria-label="Usuário" autoComplete="off" value={r.username} onChange={(e) => upd(i, "username", e.target.value)} />
              <input className={`${input} font-mono`} placeholder="Senha" aria-label="Senha" autoComplete="off" value={r.password} onChange={(e) => upd(i, "password", e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-300 flex-1">{errors[i] ?? (problem ? `Revise: ${problem}` : "")}</span>
              <button className={danger} onClick={() => drop(i)}>Remover</button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy || !rows.length || bad > 0} onClick={saveAll}>{busy ? "Salvando…" : `Salvar ${rows.length} ${rows.length === 1 ? "senha" : "senhas"}`}</button>
        <button className={ghost} disabled={busy} onClick={() => { setRows(null); setErrors({}); }}>Voltar</button>
        <button className={ghost} disabled={busy} onClick={onCancel}>Cancelar</button>
        {bad > 0 && <span className="text-[11px] text-amber-300 self-center">{bad} para revisar</span>}
      </div>
    </div>
  );
}

function ChangeMaster({ onDone, setMsg }: { onDone: () => void; setMsg: (m: any) => void }) {
  const [oldPw, setOld] = useState("");
  const [newPw, setNew] = useState("");
  const [newPw2, setNew2] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPw !== newPw2) return setMsg({ ok: false, text: "As duas senhas novas não são iguais." });
    try {
      await api.vault.changeMaster(oldPw, newPw);
      setMsg({ ok: true, text: "Senha mestra trocada. O cofre foi bloqueado: desbloqueie com a nova senha." });
      onDone();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3`}>
      <h2 className="text-sm font-semibold text-gray-300">Trocar senha mestra</h2>
      <input type="password" required autoComplete="current-password" placeholder="Senha mestra atual" className={input} value={oldPw} onChange={(e) => setOld(e.target.value)} />
      <input type="password" required autoComplete="new-password" placeholder="Nova senha mestra" className={input} value={newPw} onChange={(e) => setNew(e.target.value)} />
      <input type="password" required autoComplete="new-password" placeholder="Repita a nova senha mestra" className={input} value={newPw2} onChange={(e) => setNew2(e.target.value)} />
      <button className={primary}>Trocar</button>
    </form>
  );
}

function PinForm({ status, setMsg, onDone }: { status: Status; setMsg: (m: any) => void; onDone: () => void }) {
  const [open, setOpen] = useState(!status.hasPin);
  const [pw, setPw] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pin !== pin2) return setMsg({ ok: false, text: "Os dois códigos não são iguais." });
    setBusy(true);
    try {
      await api.vault.setPin(pw, pin);
      setMsg({ ok: true, text: "Código do WhatsApp definido. Agora é só pedir, por exemplo, “senha do github” no WhatsApp e digitar o código." });
      setPw("");
      setPin("");
      setPin2("");
      setOpen(false);
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>🔢 Código do WhatsApp definido.</span>
        <button onClick={() => setOpen(true)} className="underline hover:text-gray-200">Trocar código</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3`}>
      <h2 className="text-sm font-semibold text-gray-300">🔢 Código de 4 dígitos para consultar pelo WhatsApp</h2>
      <p className="text-xs text-gray-400">
        No WhatsApp você pede a senha e digita este código; a resposta some do chat em cerca de 1 minuto. Só as entradas marcadas como consultáveis pelo WhatsApp podem ser abertas assim.
        Três códigos errados bloqueiam o WhatsApp até você digitar a senha mestra aqui. Como são só 4 dígitos, deixe as senhas mais críticas (banco) desmarcadas.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        <input type="password" required autoComplete="current-password" placeholder="Senha mestra" className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
        <input inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" placeholder="Código (4 números)" className={`${input} font-mono tracking-widest`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <input inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" placeholder="Repita o código" className={`${input} font-mono tracking-widest`} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex gap-2">
        <button disabled={busy} className={primary}>{busy ? "Salvando..." : "Definir código"}</button>
        {status.hasPin && <button type="button" onClick={() => setOpen(false)} className={ghost}>Cancelar</button>}
      </div>
    </form>
  );
}

/** Botão só com ícone (40 px de toque), com nome para leitores de tela e dica ao passar o mouse. */
function IconButton({ label, onClick, tone = "normal", children }: { label: string; onClick: () => void; tone?: "normal" | "danger"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${tone === "danger" ? "text-red-300 hover:bg-red-500/15" : "text-gray-300 hover:bg-gray-800"}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
