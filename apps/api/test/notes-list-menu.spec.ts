import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];
let seq = 0;
const match = (r: any, where: any) =>
  Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === "object" && "lte" in v) return r[k] != null && r[k] <= v.lte;
    if (v instanceof Date) return r[k]?.getTime() === v.getTime();
    return r[k] === v;
  });
vi.mock("@openclaw/database", () => ({
  prisma: {
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    listNote: {
      findMany: async ({ where, orderBy, take }: any) => {
        const hit = rows.filter((r) => match(r, where));
        const key = Object.keys(orderBy ?? {})[0];
        if (key) hit.sort((a, b) => (orderBy[key] === "desc" ? b[key] - a[key] : a[key] - b[key]));
        return hit.slice(0, take ?? 1000);
      },
      findFirst: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
      create: async ({ data }: any) => {
        const r = { id: `n${++seq}`, remindAt: null, remindedAt: null, createdAt: new Date(), updatedAt: new Date(Date.now() + seq), ...data };
        rows.push(r);
        return r;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date(Date.now() + ++seq) }));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: any) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
  },
}));

vi.mock("../src/modules/channels/assistant/commander", async (orig) => ({
  ...(await orig<any>()),
  workspaceCommander: async (ws: string) => (ws === "w1" ? { userId: "u1", name: "Ana", phone: "1", workspaceId: "w1", services: [] } : null),
  assistantInstance: async (ws: string) => (ws === "w1" ? "inst" : null),
}));

import { MenuService } from "../src/modules/channels/assistant/menu.service";
import { AssistantSchedulerService } from "../src/modules/channels/assistant/assistant-scheduler.service";

function build() {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const google: any = { listAccounts: async () => [] };
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any, undefined, undefined, undefined, { enabled: () => false, classify: async () => null } as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  const say = async (t: string) => String(await menu.respond("w1", t));
  const screen = () => store.get("menu:w1")?.screen;
  return { menu, say, screen };
}

beforeEach(() => {
  rows.length = 0;
  seq = 0;
});

describe("notas em lista: criar e listar", () => {
  it("'notas' sem nenhuma mostra como começar; 'nota X: itens' cria direto, com os itens numerados", async () => {
    const { say, screen } = build();
    const empty = await say("notas");
    expect(empty).toContain("Você ainda não tem notas");
    expect(empty).toContain("1️⃣ ➕ Nova nota");
    const out = await say("nota compras: leite, pão, ovos");
    expect(out).toContain("Nota criada");
    expect(out).toContain("☐ 1. leite");
    expect(out).toContain("☐ 3. ovos");
    expect(out).toContain("Sem lembrete");
    expect(screen()).toBe("notes_view");
    expect(rows[0]).toMatchObject({ workspaceId: "w1", title: "Compras", items: [{ text: "leite", done: false }, { text: "pão", done: false }, { text: "ovos", done: false }] });
  });

  it("passo a passo: Nova nota pede o título, depois os itens", async () => {
    const { say, screen } = build();
    await say("notas");
    expect(await say("1")).toContain("Qual o *título*");
    expect(screen()).toBe("notes_new_input");
    expect(await say("Viagem")).toContain("Agora os *itens*");
    expect(screen()).toBe("notes_newitems_input");
    const out = await say("passagem\nhotel");
    expect(out).toContain("Nota criada");
    expect(out).toContain("☐ 2. hotel");
    expect(rows).toHaveLength(1);
  });

  it("0 nos itens cria a nota sem itens; 0 no título cancela", async () => {
    const { say } = build();
    await say("notas");
    await say("1");
    expect(await say("0")).toContain("Notas");
    expect(rows).toHaveLength(0);
    await say("1");
    await say("Vazia");
    expect(await say("0")).toContain("Sem itens ainda");
    expect(rows).toHaveLength(1);
  });

  it("lista quantas notas houver, com o número abrindo cada uma e paginação a partir da nona", async () => {
    const { say } = build();
    for (let i = 1; i <= 10; i++) await say(`nota Nota ${i}: a, b`);
    const first = await say("notas");
    expect(first).toContain("10 notas");
    expect(first).toContain("Nota 10"); // a mais recente primeiro
    expect(first).not.toContain("Nota 1\n");
    expect(first).toContain("🔟 ▶️ Mais notas");
    const second = await say("10");
    expect(second).toContain("Nota 2");
    expect(second).toContain("Nota 1");
    // achar por título fora da página mostrada
    await say("notas");
    expect(await say("nota 1")).toBeTruthy();
  });

  it("título ou parte dele abre a nota", async () => {
    const { say, screen } = build();
    await say("nota Reunião de sexta: pauta, ata");
    await say("notas");
    const out = await say("reunião");
    expect(out).toContain("Reunião de sexta");
    expect(screen()).toBe("notes_view");
  });
});

describe("notas em lista: itens", () => {
  const open = async (say: (t: string) => Promise<string>) => {
    await say("nota compras: leite, pão, ovos");
  };

  it("'feito 2' marca e desmarca, com o item riscado e a contagem", async () => {
    const { say } = build();
    await open(say);
    const done = await say("feito 2");
    expect(done).toContain("☑ 2. ~pão~");
    expect(done).toContain("1/3 feitos");
    expect(rows[0].items[1].done).toBe(true);
    expect(await say("marcar 2 e 3")).toContain("☑ 3. ~ovos~");
    expect(rows[0].items.map((i: any) => i.done)).toEqual([false, false, true]);
    expect(await say("feito 9")).toContain("Não achei esse item");
  });

  it("Editar: adicionar, mudar, tirar, marcar e mudar o título", async () => {
    const { say, screen } = build();
    await open(say);
    expect(await say("1")).toContain("Adicionar itens"); // Editar
    expect(screen()).toBe("notes_edit");
    await say("1");
    expect(await say("café, açúcar")).toContain("2 itens adicionados");
    expect(rows[0].items.map((i: any) => i.text)).toEqual(["leite", "pão", "ovos", "café", "açúcar"]);

    await say("1");
    await say("2"); // mudar um item
    expect(await say("2")).toContain("Item 2");
    expect(await say("pão integral")).toContain("Item atualizado");
    expect(rows[0].items[1].text).toBe("pão integral");

    await say("1");
    await say("3"); // tirar itens
    expect(await say("1, 5")).toContain("2 itens tirados");
    expect(rows[0].items.map((i: any) => i.text)).toEqual(["pão integral", "ovos", "café"]);

    await say("1");
    await say("4"); // marcar
    await say("1");
    expect(rows[0].items[0].done).toBe(true);

    await say("1");
    await say("5"); // título
    expect(await say("Mercado")).toContain("Título mudado");
    expect(rows[0].title).toBe("Mercado");
  });

  it("0 volta uma etapa sem mudar nada; número inválido pede de novo", async () => {
    const { say, screen } = build();
    await open(say);
    await say("1");
    await say("3");
    expect(await say("9")).toContain("Diga o número do item");
    expect(await say("0")).toContain("Editar nota");
    expect(screen()).toBe("notes_edit");
    expect(await say("0")).toContain("Compras");
    expect(screen()).toBe("notes_view");
    expect(rows[0].items).toHaveLength(3);
  });

  it("nota sem itens avisa em vez de abrir mudar, tirar ou marcar", async () => {
    const { say } = build();
    await say("notas");
    await say("1");
    await say("Vazia");
    await say("0");
    await say("1");
    expect(await say("2")).toContain("ainda não tem itens");
  });
});

describe("notas em lista: lembrete e apagar", () => {
  it("marca data e hora, mostra na lista e na nota, e deixa tirar", async () => {
    const { say, screen } = build();
    await say("nota remédio: tomar às 8");
    expect(await say("2")).toContain("Quando devo te mandar esta nota?");
    expect(screen()).toBe("notes_remind_input");
    expect(await say("blá")).toContain("Não entendi");
    expect(await say("amanhã")).toContain("Faltou a hora");
    const ok = await say("amanhã 9h");
    expect(ok).toContain("Lembrete marcado");
    expect(ok).toContain("⏰ *Lembrete:*");
    expect(rows[0].remindAt).toBeInstanceOf(Date);
    expect(rows[0].remindedAt).toBeNull();
    expect((await say("0")).includes("⏰ ")).toBe(true); // a lista mostra o horário
    await say("remédio");
    expect(await say("2")).toContain("remover");
    expect(await say("remover")).toContain("Lembrete removido");
    expect(rows[0].remindAt).toBeNull();
  });

  it("apagar pede confirmação; cancelar mantém; confirmar apaga e volta à lista", async () => {
    const { say, screen } = build();
    await say("nota compras: leite");
    expect(await say("3")).toContain("Apagar esta nota?");
    expect(screen()).toBe("notes_delete_confirm");
    expect(await say("0")).toContain("Compras");
    expect(rows).toHaveLength(1);
    await say("3");
    const out = await say("1");
    expect(out).toContain("Nota apagada");
    expect(out).toContain("Você ainda não tem notas");
    expect(rows).toHaveLength(0);
  });

  it("não mexe nas notas de outro workspace", async () => {
    const { say } = build();
    rows.push({ id: "x1", workspaceId: "w2", title: "Alheia", items: [], remindAt: null, remindedAt: null, createdAt: new Date(), updatedAt: new Date() });
    expect(await say("notas")).not.toContain("Alheia");
  });
});

describe("agendador: manda o lembrete na hora marcada", () => {
  const note = (over: any) => ({ id: `r${++seq}`, workspaceId: "w1", title: "Remédio", items: [{ text: "tomar", done: false }], remindAt: new Date(Date.now() - 1000), remindedAt: null, createdAt: new Date(), updatedAt: new Date(), ...over });
  function scheduler(fail = false) {
    const assistant: any = { sendToUser: vi.fn(async () => { if (fail) throw new Error("WhatsApp fora do ar"); }) };
    const { menu } = build();
    const sched = new AssistantSchedulerService(assistant, menu, { get: async () => null, set: async () => {}, del: async () => {} } as any);
    return { sched, assistant };
  }

  it("manda só o que já passou da hora, com os itens, e nunca repete", async () => {
    rows.push(note({ id: "a" }), note({ id: "b", title: "Futuro", remindAt: new Date(Date.now() + 3_600_000) }));
    const { sched, assistant } = scheduler();
    await (sched as any).remindersDue(Date.now());
    expect(assistant.sendToUser).toHaveBeenCalledTimes(1);
    const text = (assistant.sendToUser.mock.calls[0] as any[])[2] as string;
    expect(text).toContain("Lembrete");
    expect(text).toContain("Remédio");
    expect(text).toContain("☐ 1. tomar");
    expect(rows.find((r) => r.id === "a")!.remindedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === "b")!.remindedAt).toBeNull();
    await (sched as any).remindersDue(Date.now());
    expect(assistant.sendToUser).toHaveBeenCalledTimes(1);
  });

  it("falha no envio recente fica para a próxima volta; antiga demais desiste", async () => {
    rows.push(note({ id: "novo" }), note({ id: "velho", remindAt: new Date(Date.now() - 7 * 3_600_000) }));
    const { sched } = scheduler(true);
    await (sched as any).remindersDue(Date.now());
    expect(rows.find((r) => r.id === "novo")!.remindedAt).toBeNull(); // tenta de novo
    expect(rows.find((r) => r.id === "velho")!.remindedAt).toBeInstanceOf(Date); // desistiu
  });

  it("sem canal para avisar, não perde o lembrete recente", async () => {
    rows.push(note({ id: "x", workspaceId: "w9" }));
    const { sched, assistant } = scheduler();
    await (sched as any).remindersDue(Date.now());
    expect(assistant.sendToUser).not.toHaveBeenCalled();
    expect(rows[0].remindedAt).toBeNull();
  });

  it("trocar o horário do lembrete rearma um já enviado", async () => {
    rows.push(note({ id: "y", remindedAt: new Date() }));
    const { updateNote } = await import("../src/modules/channels/assistant/list-notes-store");
    await updateNote("w1", "y", { remindAt: new Date(Date.now() + 60_000) });
    expect(rows[0].remindedAt).toBeNull();
  });
});
