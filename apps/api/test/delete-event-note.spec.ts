import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { workspaceMember: { findFirst: async () => ({ user: { role: "ROOT", services: [], name: "Ana" } }) } } }));

import { GoogleService } from "../src/modules/integrations/google/google.service";
import { MenuService } from "../src/modules/channels/assistant/menu.service";

function build(over: Record<string, any> = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const events = [
    { id: "evt-aaaaaa1", titulo: "Reunião com João", inicio: soon(2), fim: soon(3), recorrente: false },
    { id: "evt-aaaaaa2", titulo: "Aula de cálculo", inicio: soon(30), fim: soon(31), recorrente: true },
  ];
  const google: any = {
    listAccounts: async () => ["pessoal@gmail.com"],
    calendarList: vi.fn(async () => events),
    calendarDelete: vi.fn(async () => {}),
    noteTopics: vi.fn(async () => [{ id: "topic0001", name: "Contrato" }]),
    notesIn: vi.fn(async () => [{ id: "note00001", name: "2026-10-01 Prazo do contrato", modified: "2026-10-01T10:00:00Z", link: "x" }, { id: "note00002", name: "2026-10-02 Valor", modified: "2026-10-02T10:00:00Z", link: "y" }]),
    noteRead: vi.fn(async () => ({ name: "2026-10-01 Prazo do contrato", topic: "Contrato", content: "O prazo vence dia 10", link: "x" })),
    noteTrash: vi.fn(async () => ({ name: "2026-10-01 Prazo do contrato" })),
    ...over,
  };
  const menu = new MenuService(google, {} as any, { promptBlock: async () => "", listRoutine: async () => [] } as any, state as any);
  vi.spyOn(menu as any, "ai").mockRejectedValue(new Error("IA indisponível"));
  const say = async (t: string) => String(await menu.respond("w1", t));
  const screen = () => store.get("menu:w1")?.screen;
  return { google, say, screen };
}

describe("apagar evento da agenda", () => {
  it("escolhe o evento pelo número, confirma e apaga na conta certa", async () => {
    const { google, say, screen } = build();
    expect(await say("agenda")).toContain("Apagar evento");
    const list = await say("5");
    expect(list).toContain("Reunião com João");
    expect(list).toContain("Aula de cálculo");
    expect(screen()).toBe("event_delete");

    const ask = await say("2");
    expect(ask).toContain("Apagar este evento?");
    expect(ask).toContain("Aula de cálculo");
    expect(ask).toContain("só esta ocorrência"); // evento que se repete
    expect(google.calendarDelete).not.toHaveBeenCalled();
    expect(screen()).toBe("event_delete_confirm");

    const done = await say("1");
    expect(google.calendarDelete).toHaveBeenCalledWith("w1", "evt-aaaaaa2", "pessoal@gmail.com");
    expect(done).toContain("Evento apagado");
    expect(done).toContain("Aula de cálculo");
    expect(screen()).toBe("agenda");
  });

  it("evento que não se repete não mostra o aviso de ocorrência", async () => {
    const { say } = build();
    await say("agenda");
    await say("5");
    expect(await say("1")).not.toContain("só esta ocorrência");
  });

  it("cancelar não apaga nada; dá para dizer 'apagar' em vez do número", async () => {
    const a = build();
    await a.say("agenda");
    await a.say("5");
    await a.say("1");
    await a.say("cancelar");
    expect(a.google.calendarDelete).not.toHaveBeenCalled();

    const b = build();
    await b.say("agenda");
    await b.say("5");
    await b.say("1");
    expect(await b.say("apagar")).toContain("Evento apagado");
    expect(b.google.calendarDelete).toHaveBeenCalledTimes(1);
  });

  it("'apagar evento' abre a lista direto, de qualquer tela", async () => {
    const { say, screen } = build();
    expect(await say("apagar evento")).toContain("Reunião com João");
    expect(screen()).toBe("event_delete");
  });

  it("número fora da lista é recusado e nada é apagado", async () => {
    const { google, say } = build();
    await say("agenda");
    await say("5");
    await say("9");
    expect(google.calendarDelete).not.toHaveBeenCalled();
  });

  it("sem eventos nos próximos 7 dias, avisa e volta à agenda", async () => {
    const { say, screen } = build({ calendarList: vi.fn(async () => []) });
    await say("agenda");
    expect(await say("5")).toContain("Não há eventos");
    expect(screen()).toBe("agenda");
  });

  it("erro do Google vira mensagem clara, sem derrubar", async () => {
    const { say } = build({ calendarDelete: vi.fn(async () => { throw new Error("Google API 403: sem permissão"); }) });
    await say("agenda");
    await say("5");
    await say("1");
    expect(await say("1")).toContain("Não consegui apagar o evento");
  });
});

describe("concluir e apagar nota", () => {
  async function toNote(ctx: ReturnType<typeof build>) {
    await ctx.say("notas");
    await ctx.say("1"); // assunto Contrato
    return ctx.say("1"); // abre a nota 1
  }

  it("a nota aberta oferece 'Concluir e apagar'; confirmar manda para a lixeira na conta de notas", async () => {
    const ctx = build();
    const open = await toNote(ctx);
    expect(open).toContain("O prazo vence dia 10");
    expect(open).toContain("Concluir e apagar");
    expect(ctx.screen()).toBe("notes_note");

    const ask = await ctx.say("1");
    expect(ask).toContain("Concluir e apagar esta nota?");
    expect(ask).toContain("lixeira do Google Drive");
    expect(ctx.google.noteTrash).not.toHaveBeenCalled();
    expect(ctx.screen()).toBe("notes_delete_confirm");

    const done = await ctx.say("1");
    expect(ctx.google.noteTrash).toHaveBeenCalledWith("w1", "note00001", "pessoal@gmail.com");
    expect(done).toContain("Nota concluída e apagada");
    expect(done).toContain("30 dias");
    expect(ctx.screen()).toBe("notes_topic"); // volta à lista do assunto
  });

  it("'concluir' falado funciona na nota aberta e a confirmação aceita 'apagar'", async () => {
    const ctx = build();
    await toNote(ctx);
    expect(await ctx.say("concluir")).toContain("Concluir e apagar esta nota?");
    expect(await ctx.say("apagar")).toContain("Nota concluída e apagada");
  });

  it("na lista do assunto, 'concluir 2' pede confirmação da nota 2 sem abrir", async () => {
    const ctx = build();
    await ctx.say("notas");
    await ctx.say("1");
    const ask = await ctx.say("concluir 2");
    expect(ask).toContain("2026-10-02 Valor");
    expect(ctx.google.noteRead).not.toHaveBeenCalled();
    await ctx.say("1");
    expect(ctx.google.noteTrash).toHaveBeenCalledWith("w1", "note00002", "pessoal@gmail.com");
  });

  it("cancelar não apaga e volta à nota", async () => {
    const ctx = build();
    await toNote(ctx);
    await ctx.say("1");
    const back = await ctx.say("cancelar");
    expect(ctx.google.noteTrash).not.toHaveBeenCalled();
    expect(back).toContain("O prazo vence dia 10");
  });

  it("sem permissão (nota que não foi criada pelo assistente): mensagem clara e a nota fica", async () => {
    const ctx = build({ noteTrash: vi.fn(async () => { throw new Error("Não tenho permissão para apagar essa nota (só apago as que eu mesmo criei). Apague pelo Google Drive."); }) });
    await toNote(ctx);
    await ctx.say("1");
    expect(await ctx.say("1")).toContain("Apague pelo Google Drive");
  });

  it("a lista do assunto ensina o atalho", async () => {
    const ctx = build();
    await ctx.say("notas");
    expect(await ctx.say("1")).toContain("concluir 2");
  });
});

describe("GoogleService: apagar com segurança", () => {
  const svc = () => {
    const s: any = new GoogleService();
    s.g = vi.fn();
    s.topicsRoot = async () => "root00001";
    return s;
  };

  it("calendarDelete: DELETE no evento certo, id codificado, sem avisar convidados", async () => {
    const s = svc();
    await s.calendarDelete("w1", "evt_20261005T180000Z", "a@gmail.com");
    const [, account, url, init] = s.g.mock.calls[0];
    expect(account).toBe("a@gmail.com");
    expect(url).toContain("/calendars/primary/events/evt_20261005T180000Z");
    expect(url).toContain("sendUpdates=none");
    expect(init.method).toBe("DELETE");
  });

  it("calendarDelete: id estranho é recusado; evento que já sumiu conta como apagado; outro erro sobe", async () => {
    const s = svc();
    await expect(s.calendarDelete("w1", "../../x", "a")).rejects.toThrow("inválido");
    expect(s.g).not.toHaveBeenCalled();
    s.g.mockRejectedValueOnce(new Error("Google API 410: gone"));
    await expect(s.calendarDelete("w1", "evt-aaaaaa1", "a")).resolves.toBeUndefined();
    s.g.mockRejectedValueOnce(new Error("Google API 500: erro"));
    await expect(s.calendarDelete("w1", "evt-aaaaaa1", "a")).rejects.toThrow("500");
  });

  it("noteTrash: só dentro da pasta de notas, e manda para a lixeira (não apaga de vez)", async () => {
    const s = svc();
    s.g.mockResolvedValueOnce({ name: "2026-10-01 Prazo.md", parents: ["topic0001"], mimeType: "text/markdown" }).mockResolvedValueOnce({ name: "Contrato", parents: ["root00001"] }).mockResolvedValueOnce({});
    expect(await s.noteTrash("w1", "note00001", "a@gmail.com")).toEqual({ name: "2026-10-01 Prazo" });
    const [, , url, init] = s.g.mock.calls[2];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ trashed: true });
    expect(url).toContain("/files/note00001");
  });

  it("noteTrash: arquivo fora das notas, pasta ou já na lixeira nunca é tocado", async () => {
    for (const file of [{ name: "x", parents: ["topic0001"], mimeType: "text/markdown" }, { name: "x", parents: ["topic0001"], trashed: true }, { name: "x", parents: ["topic0001"], mimeType: "application/vnd.google-apps.folder" }]) {
      const s = svc();
      s.g.mockResolvedValueOnce(file).mockResolvedValueOnce({ name: "Outra pasta", parents: ["outraRaiz"] });
      await expect(s.noteTrash("w1", "note00001", "a")).rejects.toThrow("não está nas suas notas");
      expect(s.g).toHaveBeenCalledTimes(2); // só leu; nenhum PATCH
    }
    await expect(svc().noteTrash("w1", "../x", "a")).rejects.toThrow("inválida");
  });

  it("noteTrash: 403 do Drive vira o aviso de que só apaga o que criou", async () => {
    const s = svc();
    s.g.mockResolvedValueOnce({ name: "x.md", parents: ["topic0001"] }).mockResolvedValueOnce({ name: "Contrato", parents: ["root00001"] }).mockRejectedValueOnce(new Error("Google API 403: insufficientFilePermissions"));
    await expect(s.noteTrash("w1", "note00001", "a")).rejects.toThrow("só apago as que eu mesmo criei");
  });
});
