"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const card = "bg-gray-900 border border-gray-800 rounded-xl p-4";
const input = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500";
const btn = "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";
const fmt = (d?: string) => (d ? new Date(d).toLocaleString("pt-BR") : "nunca");

const EVENTS: Record<string, string> = { "message.received": "Mensagem recebida", "conversation.created": "Nova conversa (primeira mensagem)" };
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TEXT_OPS: Record<string, string> = { contains: "contém", not_contains: "não contém", equals: "é igual a", starts_with: "começa com" };
const TYPES: Record<string, string> = { TEXT: "Texto", IMAGE: "Imagem", AUDIO: "Áudio", VIDEO: "Vídeo", FILE: "Documento" };
const STATUS: Record<string, string> = { OPEN: "Aberta", PENDING: "Pendente", RESOLVED: "Resolvida" };
const COOLDOWNS: [number, string][] = [
  [0, "toda vez"],
  [60, "no máximo 1 vez por hora na conversa"],
  [720, "no máximo 1 vez a cada 12 h na conversa"],
  [1440, "no máximo 1 vez por dia na conversa"],
  [43200, "só uma vez por conversa (30 dias)"],
];

type Cond = { field: string; op: string; value: any };
type Act = { type: string; [k: string]: any };
const blankHours = { days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };

const PRESETS: { label: string; name: string; event: string; conditions: Cond[]; actions: Act[]; cooldown: number }[] = [
  {
    label: "Fora do horário",
    name: "Aviso fora do horário",
    event: "message.received",
    conditions: [{ field: "time", op: "outside", value: blankHours }],
    actions: [{ type: "send_message", text: "Olá {{contato.nome}}! Nosso atendimento é de segunda a sexta, das 8h às 18h. Respondemos assim que voltarmos 🙂" }],
    cooldown: 720,
  },
  {
    label: "Boas-vindas",
    name: "Boas-vindas",
    event: "conversation.created",
    conditions: [],
    actions: [{ type: "send_message", text: "Olá {{contato.nome}}, obrigado pelo contato! Já vamos te atender." }],
    cooldown: 0,
  },
  {
    label: "Palavra-chave",
    name: "Pedido de orçamento",
    event: "message.received",
    conditions: [{ field: "message.body", op: "contains", value: "orçamento" }],
    actions: [{ type: "add_tag", tag: "orçamento" }, { type: "notify_owner", text: "Pedido de orçamento chegou" }],
    cooldown: 1440,
  },
];

function describe(a: any) {
  const t = a.trigger ?? {};
  const conds = (t.conditions ?? []).map((c: Cond) => {
    if (c.field === "message.body") return `mensagem ${TEXT_OPS[c.op]} "${c.value}"`;
    if (c.field === "message.type") return `tipo ${c.value.map((x: string) => TYPES[x] ?? x).join("/")}`;
    if (c.field === "time") return `${c.op === "outside" ? "fora" : "dentro"} de ${c.value.days.map((d: number) => DAYS[d]).join(",")} ${c.value.start}–${c.value.end}`;
    return c.field;
  });
  const acts = (a.actions ?? []).map((x: Act) =>
    x.type === "send_message" ? "responde ao cliente" : x.type === "notify_owner" ? "me avisa no WhatsApp" : x.type === "add_tag" ? `etiqueta "${x.tag}"` : x.type === "set_status" ? `status ${STATUS[x.status] ?? x.status}` : x.type,
  );
  return `${EVENTS[t.event] ?? t.event}${conds.length ? ` · se ${conds.join(" e ")}` : ""} → ${acts.join(", ")}`;
}

export default function AutomationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<any | null>(null);

  async function load() {
    try {
      setItems(await api.automations.list());
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(a: any) {
    try {
      await api.automations.toggle(a.id, !a.isActive);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(a: any) {
    if (!confirm(`Excluir a automação "${a.name}"?`)) return;
    try {
      await api.automations.remove(a.id);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Automações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Regras que agem sozinhas quando um cliente escreve no WhatsApp.</p>
      </div>

      {err && <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">{err}</div>}

      {editing ? (
        <Editor initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      ) : (
        <div className={`${card} space-y-2`}>
          <p className="text-xs text-gray-400">Começar de um modelo:</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => setEditing({ ...p })} className={`${btn} border border-gray-700 text-gray-300 hover:bg-gray-800`}>{p.label}</button>
            ))}
            <button onClick={() => setEditing({ name: "", event: "message.received", conditions: [], actions: [{ type: "send_message", text: "" }], cooldown: 0 })} className={`${btn} bg-violet-500 text-white hover:bg-violet-400`}>
              Em branco
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && <p className="text-xs text-gray-600">Nenhuma automação criada.</p>}
        {items.map((a) => (
          <div key={a.id} className={`${card} flex items-start gap-3 ${a.isActive ? "" : "opacity-60"}`}>
            <button
              onClick={() => toggle(a)}
              aria-label={a.isActive ? "Desativar" : "Ativar"}
              className={`mt-0.5 w-9 h-5 rounded-full relative shrink-0 transition-colors ${a.isActive ? "bg-violet-500" : "bg-gray-700"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${a.isActive ? "left-[18px]" : "left-0.5"}`} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-200">{a.name}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{describe(a)}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">
                {a.runCount} execuções · última: {fmt(a.lastRunAt)}
              </p>
              {a.lastError && <p className="text-[11px] text-red-400 mt-0.5">Última falha: {a.lastError}</p>}
            </div>
            <button
              onClick={() => setEditing({ id: a.id, name: a.name, event: a.trigger.event, conditions: a.trigger.conditions ?? [], actions: a.actions, cooldown: a.trigger.cooldownMinutes ?? 0 })}
              className={`${btn} text-gray-300 hover:bg-gray-800`}
            >
              Editar
            </button>
            <button onClick={() => remove(a)} className={`${btn} text-red-400 hover:bg-red-500/10`}>Excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Editor({ initial, onCancel, onSaved }: { initial: any; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState<string>(initial.name);
  const [event, setEvent] = useState<string>(initial.event);
  const [conds, setConds] = useState<Cond[]>(initial.conditions);
  const [acts, setActs] = useState<Act[]>(initial.actions);
  const [cooldown, setCooldown] = useState<number>(initial.cooldown);
  const [err, setErr] = useState("");

  const setCond = (i: number, patch: Partial<Cond>) => setConds((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setAct = (i: number, patch: Partial<Act>) => setActs((l) => l.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  async function save() {
    setErr("");
    const body = { name, trigger: { event, conditions: conds, cooldownMinutes: cooldown }, actions: acts };
    try {
      if (initial.id) await api.automations.update(initial.id, body);
      else await api.automations.create(body);
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className={`${card} space-y-4`}>
      {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">{err}</div>}
      <input className={input} placeholder="Nome da automação" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />

      <div>
        <p className="text-[11px] text-gray-500 mb-1">Quando</p>
        <select className={input} value={event} onChange={(e) => setEvent(e.target.value)}>
          {Object.entries(EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-gray-500">E se (todas as condições)</p>
        {conds.map((c, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <select
                className={input}
                value={c.field === "message.body" ? `body:${c.op}` : c.field === "time" ? `time:${c.op}` : c.field}
                onChange={(e) => {
                  const [f, op] = e.target.value.split(":");
                  if (f === "body") setCond(i, { field: "message.body", op, value: typeof c.value === "string" ? c.value : "" });
                  else if (f === "time") setCond(i, { field: "time", op, value: c.field === "time" ? c.value : blankHours });
                  else setCond(i, { field: "message.type", op: "in", value: ["AUDIO"] });
                }}
              >
                {Object.entries(TEXT_OPS).map(([op, l]) => <option key={op} value={`body:${op}`}>Mensagem {l}</option>)}
                <option value="message.type">Tipo de mensagem</option>
                <option value="time:outside">Fora do horário</option>
                <option value="time:within">Dentro do horário</option>
              </select>
              {c.field === "message.body" && <input className={input} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="texto (sem diferenciar maiúsculas e acentos)" />}
              {c.field === "message.type" && (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(TYPES).map(([t, l]) => (
                    <label key={t} className="flex items-center gap-1.5 text-xs text-gray-300">
                      <input type="checkbox" className="accent-violet-500" checked={c.value.includes(t)} onChange={() => setCond(i, { value: c.value.includes(t) ? c.value.filter((x: string) => x !== t) : [...c.value, t] })} />
                      {l}
                    </label>
                  ))}
                </div>
              )}
              {c.field === "time" && (
                <div className="flex flex-wrap items-center gap-2">
                  {DAYS.map((d, n) => (
                    <label key={d} className="flex items-center gap-1 text-xs text-gray-300">
                      <input type="checkbox" className="accent-violet-500" checked={c.value.days.includes(n)} onChange={() => setCond(i, { value: { ...c.value, days: c.value.days.includes(n) ? c.value.days.filter((x: number) => x !== n) : [...c.value.days, n].sort() } })} />
                      {d}
                    </label>
                  ))}
                  <input type="time" className={`${input} !w-28`} value={c.value.start} onChange={(e) => setCond(i, { value: { ...c.value, start: e.target.value } })} />
                  <span className="text-xs text-gray-500">até</span>
                  <input type="time" className={`${input} !w-28`} value={c.value.end} onChange={(e) => setCond(i, { value: { ...c.value, end: e.target.value } })} />
                </div>
              )}
            </div>
            <button onClick={() => setConds((l) => l.filter((_, j) => j !== i))} className={`${btn} text-gray-500 hover:text-red-400`}>✕</button>
          </div>
        ))}
        <button onClick={() => setConds((l) => [...l, { field: "message.body", op: "contains", value: "" }])} className="text-xs text-violet-400 hover:underline">+ condição</button>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-gray-500">Então</p>
        {acts.map((a, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <select
                className={input}
                value={a.type}
                onChange={(e) => {
                  const t = e.target.value;
                  setAct(i, t === "set_status" ? { type: t, status: "PENDING" } : t === "add_tag" ? { type: t, tag: "" } : { type: t, text: a.text ?? "" });
                }}
              >
                <option value="send_message">Responder ao cliente</option>
                <option value="notify_owner">Me avisar no WhatsApp</option>
                <option value="add_tag">Adicionar etiqueta ao contato</option>
                <option value="set_status">Mudar status da conversa</option>
              </select>
              {(a.type === "send_message" || a.type === "notify_owner") && (
                <textarea className={`${input} min-h-[70px]`} value={a.text} onChange={(e) => setAct(i, { text: e.target.value })} placeholder="Use {{contato.nome}} para o nome do cliente" />
              )}
              {a.type === "add_tag" && <input className={input} value={a.tag} onChange={(e) => setAct(i, { tag: e.target.value })} placeholder="etiqueta" maxLength={40} />}
              {a.type === "set_status" && (
                <select className={input} value={a.status} onChange={(e) => setAct(i, { status: e.target.value })}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
            </div>
            {acts.length > 1 && <button onClick={() => setActs((l) => l.filter((_, j) => j !== i))} className={`${btn} text-gray-500 hover:text-red-400`}>✕</button>}
          </div>
        ))}
        <button onClick={() => setActs((l) => [...l, { type: "send_message", text: "" }])} className="text-xs text-violet-400 hover:underline">+ ação</button>
      </div>

      <div>
        <p className="text-[11px] text-gray-500 mb-1">Frequência</p>
        <select className={input} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))}>
          {COOLDOWNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!COOLDOWNS.some(([v]) => v === cooldown) && <option value={cooldown}>a cada {cooldown} min</option>}
        </select>
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={!name.trim()} className={`${btn} bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40`}>Salvar</button>
        <button onClick={onCancel} className={`${btn} border border-gray-700 text-gray-300 hover:bg-gray-800`}>Cancelar</button>
      </div>
    </div>
  );
}
