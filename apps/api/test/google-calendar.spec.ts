import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleService } from "../src/modules/integrations/google/google.service";

type Cal = { id: string; summary: string; selected?: boolean; primary?: boolean };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ev = (id: string, summary: string, date: string, extra: Record<string, unknown> = {}) => ({ id, summary, start: { dateTime: `${date}T10:00:00-03:00` }, end: { dateTime: `${date}T11:00:00-03:00` }, ...extra });

/** Google Agenda em memória: lista de agendas + eventos de cada uma. */
function fakeCalendar(opts: { calendars?: Cal[] | { status: number }; events: Record<string, any[]>; failEvents?: string[] }) {
  const calls: string[] = [];
  const handler = async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${decodeURIComponent(url.pathname)}`);
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
      const c = opts.calendars;
      if (c && !Array.isArray(c)) return new Response("insufficient", { status: c.status });
      return json({ items: c ?? [] });
    }
    const m = decodeURIComponent(url.pathname).match(/^\/calendar\/v3\/calendars\/(.+)\/events(?:\/(.+))?$/);
    if (m) {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (opts.failEvents?.includes(m[1])) return new Response("boom", { status: 500 });
      return json({ items: opts.events[m[1]] ?? [] });
    }
    return new Response("?", { status: 404 });
  };
  return { handler, calls };
}

describe("agenda: várias agendas da conta", () => {
  let svc: GoogleService;
  beforeEach(() => {
    svc = new GoogleService();
    (svc as any).accessToken = vi.fn().mockResolvedValue("tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  const list = () => svc.calendarList("ws1", "2026-10-05T00:00:00-03:00", "2026-10-12T23:59:59-03:00", "a@x.com");

  it("junta os eventos da principal e das agendas secundárias visíveis, em ordem, e ignora as ocultas", async () => {
    const f = fakeCalendar({
      calendars: [
        { id: "a@x.com", summary: "Pessoal", primary: true, selected: true },
        { id: "turma@group.calendar.google.com", summary: "Turma 2026", selected: true },
        { id: "oculta@group.calendar.google.com", summary: "Oculta", selected: false },
      ],
      events: {
        primary: [ev("e1", "Dentista", "2026-10-09")],
        "turma@group.calendar.google.com": [ev("e2", "Aula de BD", "2026-10-06")],
        "oculta@group.calendar.google.com": [ev("e3", "Não deve aparecer", "2026-10-07")],
      },
    });
    vi.stubGlobal("fetch", vi.fn(f.handler));
    const r = await list();
    expect(r.map((e: any) => e.titulo)).toEqual(["Aula de BD", "Dentista"]);
    expect(r[0]).toMatchObject({ calId: "turma@group.calendar.google.com", agenda: "Turma 2026" });
    expect(r[1]).toMatchObject({ calId: "primary", agenda: "" });
    expect(f.calls.some((c) => c.includes("oculta@"))).toBe(false);
  });

  it("sem permissão para listar as agendas (escopo menor), cai para só a principal", async () => {
    const f = fakeCalendar({ calendars: { status: 403 }, events: { primary: [ev("e1", "Dentista", "2026-10-09")] } });
    vi.stubGlobal("fetch", vi.fn(f.handler));
    const r = await list();
    expect(r.map((e: any) => e.titulo)).toEqual(["Dentista"]);
  });

  it("o mesmo convite em duas agendas aparece uma vez; secundária fora do ar some sem derrubar a lista", async () => {
    const f = fakeCalendar({
      calendars: [
        { id: "a@x.com", summary: "Pessoal", primary: true, selected: true },
        { id: "b@group.calendar.google.com", summary: "B", selected: true },
        { id: "c@group.calendar.google.com", summary: "C", selected: true },
      ],
      events: {
        primary: [ev("e1", "Reunião", "2026-10-08", { iCalUID: "uid-1" })],
        "b@group.calendar.google.com": [ev("e1b", "Reunião", "2026-10-08", { iCalUID: "uid-1" })],
      },
      failEvents: ["c@group.calendar.google.com"],
    });
    vi.stubGlobal("fetch", vi.fn(f.handler));
    const r = await list();
    expect(r).toHaveLength(1);
    expect(r[0].titulo).toBe("Reunião");
  });

  it("a principal falhando continua sendo erro", async () => {
    const f = fakeCalendar({ calendars: [], events: {}, failEvents: ["primary"] });
    vi.stubGlobal("fetch", vi.fn(f.handler));
    await expect(list()).rejects.toThrow(/500/);
  });

  it("apagar usa a agenda do evento, não a principal", async () => {
    const f = fakeCalendar({ events: {} });
    vi.stubGlobal("fetch", vi.fn(f.handler));
    await svc.calendarDelete("ws1", "evento12345", "a@x.com", "turma@group.calendar.google.com");
    await svc.calendarDelete("ws1", "evento67890", "a@x.com");
    expect(f.calls).toContain("DELETE /calendar/v3/calendars/turma@group.calendar.google.com/events/evento12345");
    expect(f.calls).toContain("DELETE /calendar/v3/calendars/primary/events/evento67890");
  });
});
