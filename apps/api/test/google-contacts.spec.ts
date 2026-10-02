import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  config: { provider: "google", email: "a@x.com" } as Record<string, unknown>,
  update: vi.fn(async (_: any) => {}),
}));
vi.mock("@openclaw/database", () => ({
  prisma: { channel: { findFirst: async () => ({ id: "c1", config: db.config }), update: db.update, create: vi.fn() } },
}));

import { GoogleService } from "../src/modules/integrations/google/google.service";

interface F { id: string; name: string; mimeType: string; parents: string[]; content: string }
const FOLDER = "application/vnd.google-apps.folder";

/** People API + Drive em memória, só o que a importação e a consulta usam. */
function fake(opts: { people?: any[][]; peopleError?: { status: number; body: string } } = {}) {
  const files: F[] = [];
  const calls: string[] = [];
  let seq = 0;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const handler = async (input: any, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.host}${url.pathname}`);

    if (url.host === "people.googleapis.com") {
      if (opts.peopleError) return new Response(opts.peopleError.body, { status: opts.peopleError.status });
      const pages = opts.people ?? [[]];
      const i = Number(url.searchParams.get("pageToken") ?? 0);
      return json({ connections: pages[i] ?? [], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) });
    }

    if (url.pathname.startsWith("/upload/drive/v3/files")) {
      const body = String(init?.body ?? "");
      if (method === "POST") {
        const parts = body.split(/--oc[^\r\n]*/).filter((p) => p.includes("Content-Type"));
        const meta = JSON.parse(parts[0].split("\r\n\r\n")[1].trim());
        const f = { id: `f${++seq}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, content: parts[1].split("\r\n\r\n")[1].replace(/\r\n$/, "") };
        files.push(f);
        return json({ id: f.id });
      }
      const f = files.find((x) => x.id === url.pathname.split("/").pop())!;
      f.content = body;
      return json({ id: f.id });
    }

    const media = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (media && url.searchParams.get("alt") === "media") {
      const f = files.find((x) => x.id === media[1]);
      return f ? new Response(f.content) : new Response("nao achei", { status: 404 });
    }

    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init?.body));
      const f = { id: `f${++seq}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], content: "" };
      files.push(f);
      return json({ id: f.id });
    }

    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const name = q.match(/name='([^']+)'/)?.[1];
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const onlyFolders = q.includes(`mimeType='${FOLDER}'`);
      const notFolders = q.includes(`mimeType!='${FOLDER}'`);
      const out = files.filter((f) => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!onlyFolders || f.mimeType === FOLDER) && (!notFolders || f.mimeType !== FOLDER));
      return json({ files: out.map((f) => ({ id: f.id, name: f.name })) });
    }
    return new Response("rota inesperada", { status: 500 });
  };
  return { files, calls, handler };
}

const person = (nome: string, phone?: string, email?: string) => ({
  names: [{ displayName: nome }],
  ...(phone ? { phoneNumbers: [{ value: phone }] } : {}),
  ...(email ? { emailAddresses: [{ value: email }] } : {}),
});
const at = new Date("2026-10-02T00:30:00Z");

describe("contatos do Google no Drive", () => {
  let svc: GoogleService;
  beforeEach(() => {
    svc = new GoogleService();
    (svc as any).accessToken = vi.fn().mockResolvedValue("tok");
    db.config = { provider: "google", email: "a@x.com" };
    db.update.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("importa em várias páginas e grava um arquivo por letra dentro de Assist.IA/Contatos", async () => {
    const d = fake({ people: [[person("Marcos Silva", "(85) 99999-0000", "marcos@x.com"), person("Maria", "85988887777")], [person("Ana Lima", undefined, "ana@x.com"), person("Sem Dados")]] });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    const r = await svc.contactsImport("w1", "a@x.com", at);
    expect(r).toEqual({ total: 3, arquivos: 2 });
    const root = d.files.find((f) => f.name === "Assist.IA")!;
    const folder = d.files.find((f) => f.name === "Contatos")!;
    expect(folder.parents).toEqual([root.id]);
    const m = d.files.find((f) => f.name === "M.md")!;
    expect(m.parents).toEqual([folder.id]);
    expect(m.content).toContain("## Marcos Silva\n- 📞 (85) 99999-0000\n- ✉️ marcos@x.com");
    expect(m.content.indexOf("## Marcos Silva")).toBeLessThan(m.content.indexOf("## Maria"));
    expect(d.files.find((f) => f.name === "A.md")!.content).toContain("## Ana Lima");
    expect(d.files.some((f) => f.content.includes("Sem Dados"))).toBe(false);
  });

  it("marca a conta como importada", async () => {
    const d = fake({ people: [[person("Ana", "85900001111")]] });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.contactsImport("w1", "a@x.com", at);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0][0].data.config).toMatchObject({ provider: "google", contactsSyncedAt: at.toISOString() });
  });

  it("importar de novo não duplica arquivos e esvazia a letra que ficou sem contatos", async () => {
    const d = fake({ people: [[person("Ana", "85900001111"), person("Zeca", "85922223333")]] });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.contactsImport("w1", "a@x.com", at);
    const ids = d.files.map((f) => f.id);
    // O Zeca foi apagado no Google
    const d2 = fake({ people: [[person("Ana", "85900001111")]] });
    d2.files.push(...d.files);
    vi.stubGlobal("fetch", vi.fn(d2.handler));
    await svc.contactsImport("w1", "a@x.com", at);
    expect(d2.files.map((f) => f.id)).toEqual(ids);
    expect(d2.files.find((f) => f.name === "Z.md")!.content).not.toContain("Zeca");
    expect(d2.files.find((f) => f.name === "Z.md")!.content).toContain("Nenhum contato");
  });

  it("na primeira conexão importa uma vez; com o marcador, não faz nada", async () => {
    const d = fake({ people: [[person("Ana", "85900001111")]] });
    const f = vi.fn(d.handler);
    vi.stubGlobal("fetch", f);
    await svc.importContactsOnce("w1", "a@x.com");
    expect(d.files.some((x) => x.name === "A.md")).toBe(true);
    f.mockClear();
    db.config = { provider: "google", email: "a@x.com", contactsSyncedAt: at.toISOString() };
    await svc.importContactsOnce("w1", "a@x.com");
    expect(f).not.toHaveBeenCalled();
  });

  it("falha na importação da conexão é engolida e não marca como feita", async () => {
    const d = fake({ peopleError: { status: 500, body: "erro" } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await expect(svc.importContactsOnce("w1", "a@x.com")).resolves.toBeUndefined();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("People API desativada: a mensagem traz o endereço para ativar", async () => {
    const body = JSON.stringify({ error: { code: 403, message: "People API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/people.googleapis.com/overview?project=123456 then retry.", status: "PERMISSION_DENIED" } });
    vi.stubGlobal("fetch", vi.fn(fake({ peopleError: { status: 403, body } }).handler));
    await expect(svc.contactsImport("w1", "a@x.com", at)).rejects.toThrow(/https:\/\/console\.developers\.google\.com\/apis\/api\/people\.googleapis\.com\/overview\?project=123456/);
  });

  it("conta sem o escopo dos contatos pede reconexão", async () => {
    vi.stubGlobal("fetch", vi.fn(fake({ peopleError: { status: 403, body: '{"error":{"message":"Request had insufficient authentication scopes."}}' } }).handler));
    await expect(svc.contactsImport("w1", "a@x.com", at)).rejects.toThrow(/Reconecte o Google/);
  });

  it("consulta: null antes de importar, depois acha por nome e usa o cache", async () => {
    const d = fake({ people: [[person("Marcos Silva", "(85) 99999-0000", "marcos@x.com"), person("Maria Souza", "85988887777")]] });
    const f = vi.fn(d.handler);
    vi.stubGlobal("fetch", f);
    expect(await svc.contactsLookup("w1", "marcos", "a@x.com")).toBeNull();
    await svc.contactsImport("w1", "a@x.com", at);
    const r = await svc.contactsLookup("w1", "marcos", "a@x.com");
    expect(r).toEqual([{ nome: "Marcos Silva", telefones: ["(85) 99999-0000"], emails: ["marcos@x.com"] }]);
    f.mockClear();
    expect((await svc.contactsLookup("w1", "silva", "a@x.com"))![0].nome).toBe("Marcos Silva");
    expect(f).not.toHaveBeenCalled(); // segunda consulta veio do cache
  });

  it("importar de novo invalida o cache da consulta", async () => {
    const d = fake({ people: [[person("Marcos", "85911112222")]] });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.contactsImport("w1", "a@x.com", at);
    expect(await svc.contactsLookup("w1", "marcos", "a@x.com")).toHaveLength(1);
    const d2 = fake({ people: [[person("Outro", "85933334444")]] });
    d2.files.push(...d.files);
    vi.stubGlobal("fetch", vi.fn(d2.handler));
    await svc.contactsImport("w1", "a@x.com", at);
    expect(await svc.contactsLookup("w1", "marcos", "a@x.com")).toEqual([]);
  });

  /** OAuth de mentira por cima do Drive/People falsos. */
  const withOAuth = (d: ReturnType<typeof fake>) =>
    vi.fn(async (input: any, init?: RequestInit) => {
      const u = String(input);
      if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ refresh_token: "rt", access_token: "at", expires_in: 3600 }));
      if (u.startsWith("https://openidconnect.googleapis.com")) return new Response(JSON.stringify({ email: "a@x.com" }));
      return d.handler(input, init);
    });

  it("conectar a conta pela primeira vez importa os contatos em segundo plano", async () => {
    const d = fake({ people: [[person("Ana", "85900001111")]] });
    vi.stubGlobal("fetch", withOAuth(d));
    const email = await svc.connect("w1", "codigo");
    expect(email).toBe("a@x.com");
    await vi.waitFor(() => expect(d.files.some((f) => f.name === "A.md")).toBe(true));
    await vi.waitFor(() => expect(db.update.mock.calls.some((c) => (c[0].data.config as any).contactsSyncedAt)).toBe(true));
  });

  it("reconectar preserva o marcador e não importa de novo", async () => {
    db.config = { provider: "google", email: "a@x.com", contactsSyncedAt: "2026-09-01T00:00:00.000Z" };
    const d = fake({ people: [[person("Ana", "85900001111")]] });
    vi.stubGlobal("fetch", withOAuth(d));
    await svc.connect("w1", "codigo");
    await new Promise((r) => setTimeout(r, 30));
    // A atualização do canal mantém o marcador; nenhuma chamada aos contatos
    expect(db.update.mock.calls[0][0].data.config).toMatchObject({ contactsSyncedAt: "2026-09-01T00:00:00.000Z" });
    expect(d.calls.some((c) => c.includes("people.googleapis.com"))).toBe(false);
  });
});
