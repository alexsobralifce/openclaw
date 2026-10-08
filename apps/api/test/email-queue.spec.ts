import { beforeEach, describe, expect, it, vi } from "vitest";
import { fmtWhen, mergeQueue, QUEUE_MAX, removeFromQueue } from "../src/modules/channels/assistant/email-queue";

vi.mock("@openclaw/database", () => ({
  prisma: {
    workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) },
    channel: { findFirst: async () => null },
    conversation: { findMany: async () => [] },
  },
}));

import { toSpeech } from "../src/modules/channels/assistant/speech";
import { MenuService } from "../src/modules/channels/assistant/menu.service";

const q = (id: string, at: number, account = "a@x.com") => ({ account, id, de: `Fulano ${id} <f${id}@x.com>`, assunto: `Assunto ${id}`, at });

describe("fila de e-mails (lógica)", () => {
  it("ordena do mais recente ao mais antigo, sem repetir, e respeita o teto", () => {
    const m = mergeQueue([q("3", 300), q("1", 100)], [q("2", 200), q("3", 300), q("1", 100, "outra@x.com")]);
    expect(m.map((x) => `${x.account}:${x.id}`)).toEqual(["a@x.com:3", "a@x.com:2", "a@x.com:1", "outra@x.com:1"]);
    const big = mergeQueue([], Array.from({ length: QUEUE_MAX + 5 }, (_, i) => q(String(i), i)));
    expect(big).toHaveLength(QUEUE_MAX);
    expect(big[0].id).toBe(String(QUEUE_MAX + 4)); // o mais recente vem primeiro
    expect(big.at(-1)!.id).toBe("5"); // os mais antigos saem primeiro
  });

  it("remove por id e conta", () => {
    const m = [q("1", 1), q("1", 2, "b@x.com")];
    expect(removeFromQueue(m, "1", "a@x.com").map((x) => x.account)).toEqual(["b@x.com"]);
  });

  it("hora de chegada: hoje só a hora, outros dias com a data", () => {
    const now = new Date("2026-09-24T18:00:00Z").getTime();
    expect(fmtWhen(new Date("2026-09-24T17:32:00Z").getTime(), "America/Fortaleza", now)).toBe("14:32");
    expect(fmtWhen(new Date("2026-09-23T17:32:00Z").getTime(), "America/Fortaleza", now)).toBe("23/09 14:32");
    expect(fmtWhen(undefined, "America/Fortaleza")).toBe("");
  });
});

function setup() {
  const store = new Map<string, any>();
  const state: any = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: any) => void store.set(k, JSON.parse(JSON.stringify(v))),
    del: async (k: string) => void store.delete(k),
  };
  const mails: Record<string, any> = {};
  const log: string[] = [];
  const google: any = {
    listAccounts: async () => ["a@x.com"],
    gmailSearch: async () => [],
    gmailRead: async (_ws: string, id: string) => {
      if (!mails[id]) throw new Error("Google API 404");
      return mails[id];
    },
    gmailTrash: async (_ws: string, id: string) => void log.push(`trash ${id}`),
    gmailSpam: async (_ws: string, id: string) => void log.push(`spam ${id}`),
    gmailMarkRead: async (_ws: string, id: string) => void log.push(`read ${id}`),
    gmailSend: async (_ws: string, to: string, subject: string) => void log.push(`send ${to} ${subject}`),
  };
  for (const id of ["1", "2", "3", "4", "5", "6"]) {
    mails[id] = { id, de: `Fulano ${id} <f${id}@x.com>`, assunto: `Assunto ${id}`, corpo: `Corpo ${id}`, data: "2026-09-24T17:00:00Z" };
  }
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", list: async () => [] } as any, state);
  const say = (t: string) => menu.respond("ws", t);
  return { menu, say, log, mails, store };
}

describe("fluxo: chegam 5 e-mails e o usuário trata um a um", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", ""));

  it("lista os mais recentes primeiro, mesmo que tenham chegado embaralhados", async () => {
    const { menu, say } = setup();
    await menu.notifyNew("ws", [q("3", 300), q("1", 100), q("5", 500), q("2", 200), q("4", 400)]);
    // o aviso é curto; a lista inteira só vem quando o dono pede
    const out = (await say("fila"))!;
    expect(out).toContain("5 e-mails na fila");
    const pos = ["Assunto 5", "Assunto 4", "Assunto 3", "Assunto 2", "Assunto 1"].map((s) => out.indexOf(s));
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(pos.every((p) => p > 0)).toBe(true);
  });

  it("'próximo' abre o mais recente e, ao apagar, já abre o seguinte", async () => {
    const { menu, say, log } = setup();
    await menu.notifyNew("ws", [q("2", 200), q("1", 100), q("3", 300)]);
    const first = (await say("próximo"))!;
    expect(first).toContain("Assunto 3");
    expect(first).toContain("2 restantes na fila");
    expect(first).toContain("Próximo");
    const after = (await say("2"))!; // apagar
    expect(log).toEqual(["trash 3"]);
    expect(after).toContain("Pronto");
    expect(after).toContain("Assunto 2"); // avançou sozinho
    expect(after).toContain("1 restante na fila");
    const last = (await say("apagar"))!;
    expect(log).toEqual(["trash 3", "trash 2"]);
    expect(last).toContain("Assunto 1");
    const done = (await say("spam"))!;
    expect(log.at(-1)).toBe("spam 1");
    expect(done).toContain("Fila vazia");
  });

  it("responder e enviar leva ao próximo da fila", async () => {
    const { menu, say, log } = setup();
    await menu.notifyNew("ws", [q("1", 100), q("2", 200)]);
    await say("próximo");
    await say("1"); // responder
    const draft = (await say("confirmo presença"))!;
    expect(draft).toContain("Rascunho");
    const sent = (await say("1"))!; // enviar
    expect(log[0]).toMatch(/^send f2@x.com Re: Assunto 2/);
    expect(sent).toContain("E-mail enviado");
    expect(sent).toContain("Assunto 1");
  });

  it("e-mail que chega no meio NÃO troca a tela: os números continuam valendo", async () => {
    const { menu, say, store } = setup();
    await menu.notifyNew("ws", [q("1", 100), q("2", 200), q("3", 300)]);
    await say("fila");
    // usuário está vendo a lista numerada; chega o 6º e-mail
    const notice = await menu.notifyNew("ws", [q("6", 600)]);
    expect(notice).toContain("Na fila: 4");
    expect(notice).toContain("próximo");
    expect(store.get("menu:ws").screen).toBe("emails"); // tela intacta
    const opened = (await say("2"))!;
    expect(opened).toContain("Assunto 2"); // "2" ainda é o e-mail 2 da lista, não o novo
  });

  it("não interrompe rascunho nem confirmação pendente, e 'próximo' ali não descarta nada", async () => {
    const { menu, say, store } = setup();
    await menu.notifyNew("ws", [q("1", 100), q("2", 200)]);
    await say("próximo");
    await say("1"); // responder → tela de digitação
    await menu.notifyNew("ws", [q("6", 600)]);
    expect(store.get("menu:ws").screen).toBe("email_reply_input");
    // dentro da digitação, "próximo" é conteúdo do e-mail, não comando
    const draft = (await say("próximo"))!;
    expect(draft).toContain("Rascunho");
    // confirmação de ação pendente da IA
    await menu.requestConfirm("ws", [{ name: "gmail_send", args: { to: "a@b.com", subject: "x", text: "y" } }]);
    await menu.notifyNew("ws", [q("4", 400)]);
    expect(store.get("menu:ws").screen).toBe("confirm_ai");
    expect((await say("próximo"))!).toContain("Não tenho essa opção");
  });

  it("pular ('próximo') mantém o e-mail não lido no Gmail, só sai da fila", async () => {
    const { menu, say, log } = setup();
    await menu.notifyNew("ws", [q("1", 100), q("2", 200)]);
    await say("próximo"); // abre o 2 (o mais recente)
    const second = (await say("5"))!; // pular para o próximo
    expect(second).toContain("Assunto 1");
    expect(log).toEqual([]); // nada foi apagado nem marcado
  });

  it("e-mail apagado por fora é descartado e a fila segue", async () => {
    const { menu, say, mails } = setup();
    await menu.notifyNew("ws", [q("1", 100), q("2", 200)]);
    delete mails["1"];
    expect((await say("próximo"))!).toContain("Assunto 2");
  });

  it("fila vazia responde com clareza, e 'fila' mostra o que espera", async () => {
    const { menu, say } = setup();
    expect((await say("próximo"))).toContain("Fila vazia");
    await menu.notifyNew("ws", [q("1", 100), q("2", 200)]);
    await say("menu");
    expect((await say("fila"))!).toContain("2 e-mails na fila");
  });

  it("no modo carro a fila é lida em voz alta, com número, remetente, assunto e o comando 'próximo'", async () => {
    const { menu } = setup();
    const { say } = { say: (t: string) => menu.respond("ws", t) };
    await menu.notifyNew("ws", [q("2", 200), q("1", 100)]);
    const spoken = toSpeech((await say("fila"))!);
    expect(spoken).toContain("um, Fulano 2");
    expect(spoken).toContain("dois, Fulano 1");
    expect(spoken).toMatch(/pr[óo]ximo/i);
    expect(spoken.length).toBeLessThanOrEqual(700);
    expect(spoken).not.toMatch(/[*_⏭️📩]/u);
  });

  it("um único e-mail novo, com o assistente parado, vira cartão com ações", async () => {
    const { menu, store } = setup();
    const out = await menu.notifyNew("ws", [q("1", 100)]);
    expect(out).toContain("Novo e-mail");
    expect(out).toContain("Ler");
    expect(store.get("menu:ws").screen).toBe("notif");
    expect(store.get("menu:ws").data.q).toBe(true);
  });

  describe("aviso automático de e-mail novo: sem despejar a fila", () => {
    const names = (n: number, from = 0) => Array.from({ length: n }, (_, i) => q(String(from + i + 1), 1000 + from + i));

    it("com 50 e-mails acumulados, um novo vira aviso curto (e não a lista inteira)", async () => {
      const { menu, store } = setup();
      await menu.notifyNew("ws", names(49));
      const notice = await menu.notifyNew("ws", [q("900", 5000)]);
      expect(notice).toContain("Novo e-mail");
      expect(notice).toContain("Na fila: 50");
      expect(notice).not.toContain("e-mails na fila");
      expect(notice).not.toContain("Automáticos");
      expect(notice.split("\n").length).toBeLessThanOrEqual(4);
      expect(store.get("menu:ws")).toBeUndefined(); // nem troca a tela
    });

    it("vários de uma vez: conta e quem mandou, no máximo 3 nomes, sem a lista", async () => {
      const { menu } = setup();
      const notice = await menu.notifyNew("ws", [q("1", 100), q("2", 200), q("3", 300), q("4", 400), q("5", 500)]);
      expect(notice).toContain("5 e-mails novos");
      expect(notice).toContain("e +2");
      expect(notice).toContain("fila");
      expect(notice).not.toContain("Assunto 1");
    });

    it("no modo carro continua lendo a fila em voz alta", async () => {
      const { menu, store } = setup();
      store.set("mode:ws", "car"); // modo carro ligado, assistente parado
      const out = await menu.notifyNew("ws", [q("2", 200), q("1", 100)]);
      expect(out).toContain("2 e-mails na fila");
      expect(out).toContain("Assunto 2");
    });

    it("a fila continua disponível: 'fila' mostra e 'próximo' abre o mais recente", async () => {
      const { menu, say } = setup();
      await menu.notifyNew("ws", [q("2", 200), q("1", 100)]);
      expect((await say("fila"))!).toContain("2 e-mails na fila");
      expect((await say("próximo"))!).toContain("Assunto 2");
    });
  });
});
