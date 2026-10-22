import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { MenuService } from "../src/modules/channels/assistant/menu.service";

const T = (h: number) => Date.now() - h * 3600_000;
const inbox = [
  { id: "1", de: "Maria Souza <maria@empresa.com>", assunto: "Reunião de quinta", resumo: "", internalDate: T(3), labels: [], sinais: {} },
  { id: "2", de: "Newsletter Dev <news@dev.com>", assunto: "Resumo da semana", resumo: "", internalDate: T(2), labels: [], sinais: {} },
  { id: "3", de: "João <joao@cliente.com>", assunto: "Proposta", resumo: "", internalDate: T(1), labels: [], sinais: {} },
];

function build(opts: { accounts?: string[]; gemini?: any; existing?: any[] } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const calendarCreate = vi.fn(async () => ({ id: "e" }));
  const gmailTrash = vi.fn(async () => ({ ok: true }));
  const google = {
    listAccounts: async () => opts.accounts ?? ["pessoal@gmail.com"],
    gmailSearch: async () => inbox,
    gmailTrash,
    calendarCreate,
    calendarList: async () => opts.existing ?? [],
  };
  const menu = new MenuService(google as any, {} as any, { promptBlock: async () => "" } as any, state as any, opts.gemini);
  return { menu, store, calendarCreate, gmailTrash };
}

const reply = (eventos: any[]) => JSON.stringify({ eventos, erro: null });
const future = (d: number, h = 10) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10) + `T${String(h).padStart(2, "0")}:00:00-03:00`;

describe("sem interesse", () => {
  it("botão 6 no aviso: some da lista, não vira 'oculto' e sai da fila", async () => {
    const { menu, store } = build();
    store.set("menu:w1", { screen: "notif", data: { account: "pessoal@gmail.com", id: "2", de: "Newsletter Dev <news@dev.com>", assunto: "Resumo", kind: "auto", q: true }, at: Date.now() });
    store.set("emailq:w1", [
      { account: "pessoal@gmail.com", id: "2", de: "Newsletter Dev <news@dev.com>", assunto: "Resumo", at: 1, kind: "auto" },
      { account: "pessoal@gmail.com", id: "9", de: "news@dev.com", assunto: "Outro", at: 2, kind: "auto" },
    ]);

    const out = (await menu.respond("w1", "6")) as string;
    expect(out).toContain("sem interesse");
    expect(store.get("emailmute:w1").muted).toEqual(["news@dev.com"]);
    expect(store.get("emailq:w1")).toBeUndefined(); // os dois e-mails do remetente saíram da fila

    const list = (await (menu as any).emailList("w1", "pessoal@gmail.com")) as string;
    expect(list).toContain("Maria Souza");
    expect(list).toContain("João");
    expect(list).not.toContain("Newsletter");
    expect(list).not.toContain("ocultos");
  });

  it("diz 'sem interesse' por voz/texto no cartão do e-mail", async () => {
    const { menu, store } = build();
    store.set("menu:w1", { screen: "email", data: { account: "pessoal@gmail.com", id: "2", de: "Newsletter Dev <news@dev.com>", assunto: "Resumo" }, at: Date.now() });
    await menu.respond("w1", "sem interesse");
    expect(store.get("emailmute:w1").muted).toContain("news@dev.com");
  });

  it("aprende: apagar o 2º aviso automático do mesmo remetente silencia e avisa", async () => {
    const { menu, store } = build();
    const card = () => store.set("menu:w1", { screen: "notif", data: { account: "pessoal@gmail.com", id: "2", de: "GitHub <noreply@github.com>", assunto: "Commit", kind: "auto", q: false }, at: Date.now() });
    card();
    const first = (await menu.respond("w1", "2")) as string;
    expect(first).not.toContain("sem interesse");
    card();
    const second = (await menu.respond("w1", "2")) as string;
    expect(second).toContain("sem interesse");
    expect(store.get("emailmute:w1").muted).toEqual(["noreply@github.com"]);
  });

  it("apagar e-mail de pessoa nunca silencia", async () => {
    const { menu, store } = build();
    for (let i = 0; i < 3; i++) {
      store.set("menu:w1", { screen: "notif", data: { account: "pessoal@gmail.com", id: "1", de: "Maria <maria@empresa.com>", assunto: "Oi", kind: "person", q: false }, at: Date.now() });
      await menu.respond("w1", "2");
    }
    expect(store.get("emailmute:w1")).toBeUndefined();
  });

  it("'remetentes sem interesse' lista e o número desfaz", async () => {
    const { menu, store } = build();
    store.set("emailmute:w1", { muted: ["news@dev.com", "x@y.com"], strikes: {} });
    const list = (await menu.respond("w1", "remetentes sem interesse")) as string;
    expect(list).toContain("news@dev.com");
    const after = (await menu.respond("w1", "1")) as string;
    expect(after).toContain("Voltei a listar");
    expect(store.get("emailmute:w1").muted).toEqual(["x@y.com"]);
  });
});

describe("agenda: vários eventos, links e imagens", () => {
  it("na tela de novo evento, uma lista vira 3 eventos; confirmar cria todos", async () => {
    const { menu, store, calendarCreate } = build();
    vi.spyOn(menu as any, "ai").mockResolvedValue(
      reply([
        { titulo: "Reunião de pais", inicio: future(2, 19) },
        { titulo: "Dentista", inicio: future(4, 9), fim: future(4, 10) },
        { titulo: "Entrega do relatório", inicio: future(6).slice(0, 10) },
      ]),
    );
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });

    const card = (await menu.respond("w1", "terça reunião de pais 19h\nquinta dentista 9h\nsábado entrega do relatório")) as string;
    expect(card).toContain("Confirmar 3 eventos");
    expect(card).toContain("Dentista");
    expect(card).toContain("dia todo");
    expect(calendarCreate).not.toHaveBeenCalled();

    const done = (await menu.respond("w1", "1")) as string;
    expect(calendarCreate).toHaveBeenCalledTimes(3);
    expect(done).toContain("3 eventos criados");
  });

  it("com duas contas pergunta em qual agenda antes de criar", async () => {
    const { menu, store, calendarCreate } = build({ accounts: ["a@gmail.com", "b@ifce.edu.br"] });
    vi.spyOn(menu as any, "ai").mockResolvedValue(reply([{ titulo: "A", inicio: future(2) }, { titulo: "B", inicio: future(3) }]));
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });
    await menu.respond("w1", "a\nb");
    const ask = (await menu.respond("w1", "1")) as string;
    expect(ask).toContain("Em qual agenda?");
    await menu.respond("w1", "2");
    expect(calendarCreate).toHaveBeenCalledTimes(2);
    expect(calendarCreate.mock.calls[0][2]).toBe("b@ifce.edu.br");
  });

  it("reenviar a mesma lista não duplica o que já está na agenda", async () => {
    const start = future(2, 19);
    const { menu, store, calendarCreate } = build({ existing: [{ titulo: "reunião de pais" }] });
    vi.spyOn(menu as any, "ai").mockResolvedValue(reply([{ titulo: "Reunião de pais", inicio: start }, { titulo: "Dentista", inicio: future(4, 9) }]));
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });
    await menu.respond("w1", "x\ny");
    // a agenda já tem "Reunião de pais": esse é pulado e avisado; o Dentista é criado
    const done = (await menu.respond("w1", "1")) as string;
    expect(done).toContain("Já estavam na agenda");
    expect(calendarCreate).toHaveBeenCalledTimes(1);
    expect(calendarCreate).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Reunião de pais" }), expect.anything());
  });

  it("fora da tela de evento, 'adicione na agenda' + lista também é lido", async () => {
    const { menu, store } = build();
    vi.spyOn(menu as any, "ai").mockResolvedValue(reply([{ titulo: "Prova", inicio: future(3, 8) }]));
    const out = (await menu.respond("w1", "adicione na agenda:\nprova de cálculo dia 12 às 8h")) as string;
    expect(out).toContain("Confirmar evento");
    expect(store.get("menu:w1").screen).toBe("event_confirm");
  });

  it("áudio transcrito (uma linha longa) com vários compromissos também é lido em lote", async () => {
    const { menu, store } = build();
    vi.spyOn(menu as any, "ai").mockResolvedValue(reply([{ titulo: "Reunião", inicio: future(2, 10) }, { titulo: "Dentista", inicio: future(4, 9) }]));
    const out = (await menu.respond("w1", "Adicione na agenda reunião com a equipe na terça às 10h e consulta no dentista na quinta às 9h da manhã")) as string;
    expect(out).toContain("Confirmar 2 eventos");
    expect(store.get("menu:w1").screen).toBe("event_confirm");
  });

  it("pedido curto ou com convidado continua no caminho da IA", async () => {
    const { menu } = build();
    const ai = vi.spyOn(menu as any, "ai");
    expect(await menu.respond("w1", "marque na agenda dentista amanhã 9h")).toBeNull();
    expect(await menu.respond("w1", "marque na agenda reunião com joao@empresa.com amanhã às 15h para falar do projeto novo de vendas")).toBeNull();
    expect(ai).not.toHaveBeenCalled();
  });

  it("pergunta sobre a agenda NÃO é sequestrada", async () => {
    const { menu } = build();
    const ai = vi.spyOn(menu as any, "ai");
    const out = await menu.respond("w1", "o que tenho na agenda\namanhã?");
    expect(out).toBeNull();
    expect(ai).not.toHaveBeenCalled();
  });

  it("link é lido pelo Gemini (não por este servidor)", async () => {
    const gemini = { enabled: () => true, extract: vi.fn(async () => reply([{ titulo: "Palestra", inicio: future(5, 18) }])) };
    const { menu, store } = build({ gemini });
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });
    const out = (await menu.respond("w1", "olha isso https://evento.com/palestra")) as string;
    expect(gemini.extract).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ urls: ["https://evento.com/palestra"] }));
    expect(out).toContain("Palestra");
  });

  it("sem Gemini, link/imagem pedem a configuração em vez de falhar", async () => {
    const { menu, store } = build({ gemini: { enabled: () => false } });
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });
    const out = (await menu.respond("w1", "https://evento.com/x")) as string;
    expect(out).toContain("GEMINI_API_KEY");
  });

  it("imagem: lida na tela de evento, com 'agenda' na legenda; senão só orienta", async () => {
    const gemini = { enabled: () => true, extract: vi.fn(async () => reply([{ titulo: "Formatura", inicio: future(9, 20) }])) };
    const { menu, store } = build({ gemini });
    expect(await menu.agendaMediaIntent("w1", "")).toBe("hint");
    expect(await menu.agendaMediaIntent("w1", "adicione na agenda")).toBe("yes");
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });
    expect(await menu.agendaMediaIntent("w1", "")).toBe("yes");

    const out = await menu.agendaIngest("w1", { media: [{ mime: "image/jpeg", base64: "AAAA" }] });
    expect(gemini.extract).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ media: [{ mime: "image/jpeg", base64: "AAAA" }] }));
    expect(out).toContain("Formatura");
  });

  it("nada encontrado volta para a tela de digitação com o motivo", async () => {
    const { menu, store } = build();
    vi.spyOn(menu as any, "ai").mockResolvedValue(JSON.stringify({ eventos: [], erro: "só tem propaganda" }));
    store.set("menu:w1", { screen: "event_input", data: {}, at: Date.now() });
    const out = (await menu.respond("w1", "bla bla")) as string;
    expect(out).toContain("só tem propaganda");
    expect(store.get("menu:w1").screen).toBe("event_input");
  });
});
