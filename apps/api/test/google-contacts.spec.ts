import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PESSOAL = "pessoal@gmail.com";
const IFCE = "ana@ifce.edu.br";

const db = vi.hoisted(() => ({
  /** Canais Google por e-mail, na ordem de conexão. */
  channels: [] as { id: string; config: Record<string, unknown> }[],
  update: vi.fn(async (_: any) => {}),
}));
vi.mock("@openclaw/database", () => ({
  prisma: {
    channel: {
      findMany: async () => db.channels,
      findFirst: async (q: any) => {
        const email = q?.where?.AND?.find((c: any) => c.config?.path?.[0] === "email")?.config?.equals;
        return db.channels.find((c) => !email || c.config.email === email) ?? null;
      },
      update: db.update,
      create: vi.fn(),
    },
  },
}));

import { GoogleService } from "../src/modules/integrations/google/google.service";

interface F { id: string; owner: string; name: string; mimeType: string; parents: string[]; content: string }
const FOLDER = "application/vnd.google-apps.folder";

/** People API + Drive em memória; cada conta tem os próprios contatos e o próprio Drive (o dono vem do token). */
function fake(opts: { people?: Record<string, any[][]>; peopleError?: Record<string, { status: number; body: string }> } = {}) {
  const files: F[] = [];
  const calls: string[] = [];
  let seq = 0;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const handler = async (input: any, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const owner = String((init?.headers as any)?.Authorization ?? "").replace("Bearer tok-", "");
    calls.push(`${method} ${owner} ${url.host}${url.pathname}`);

    if (url.host === "people.googleapis.com") {
      const err = opts.peopleError?.[owner];
      if (err) return new Response(err.body, { status: err.status });
      const pages = opts.people?.[owner] ?? [[]];
      const i = Number(url.searchParams.get("pageToken") ?? 0);
      return json({ connections: pages[i] ?? [], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) });
    }

    if (url.pathname.startsWith("/upload/drive/v3/files")) {
      const body = String(init?.body ?? "");
      if (method === "POST") {
        const parts = body.split(/--oc[^\r\n]*/).filter((p) => p.includes("Content-Type"));
        const meta = JSON.parse(parts[0].split("\r\n\r\n")[1].trim());
        const f = { id: `f${++seq}`, owner, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, content: parts[1].split("\r\n\r\n")[1].replace(/\r\n$/, "") };
        files.push(f);
        return json({ id: f.id });
      }
      const f = files.find((x) => x.owner === owner && x.id === url.pathname.split("/").pop())!;
      f.content = body;
      return json({ id: f.id });
    }

    const media = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (media && url.searchParams.get("alt") === "media") {
      const f = files.find((x) => x.owner === owner && x.id === media[1]);
      return f ? new Response(f.content) : new Response("nao achei", { status: 404 });
    }

    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init?.body));
      const f = { id: `f${++seq}`, owner, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], content: "" };
      files.push(f);
      return json({ id: f.id });
    }

    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const name = q.match(/name='([^']+)'/)?.[1];
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const onlyFolders = q.includes(`mimeType='${FOLDER}'`);
      const notFolders = q.includes(`mimeType!='${FOLDER}'`);
      const out = files.filter((f) => f.owner === owner && (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!onlyFolders || f.mimeType === FOLDER) && (!notFolders || f.mimeType !== FOLDER));
      return json({ files: out.map((f) => ({ id: f.id, name: f.name })) });
    }
    return new Response("rota inesperada", { status: 500 });
  };
  return { files, calls, handler, of: (owner: string) => files.filter((f) => f.owner === owner) };
}

const person = (nome: string, phone?: string, email?: string) => ({
  names: [{ displayName: nome }],
  ...(phone ? { phoneNumbers: [{ value: phone }] } : {}),
  ...(email ? { emailAddresses: [{ value: email }] } : {}),
});
const at = new Date("2026-10-02T00:30:00Z");
const connect = (...emails: string[]) => {
  db.channels = emails.map((email, i) => ({ id: `c${i + 1}`, config: { provider: "google", email } }));
};

describe("contatos do Google no Drive pessoal", () => {
  let svc: GoogleService;
  beforeEach(() => {
    svc = new GoogleService();
    (svc as any).accessToken = vi.fn(async (_ws: string, account?: string) => `tok-${account}`);
    connect(IFCE, PESSOAL); // o IFCE foi conectado primeiro de propósito
    db.update.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lê os contatos das duas contas e grava só no Drive pessoal, um arquivo por letra", async () => {
    const d = fake({
      people: {
        [PESSOAL]: [[person("Marcos Silva", "(85) 99999-0000", "marcos@x.com")], [person("Ana Lima", undefined, "ana@x.com")]],
        [IFCE]: [[person("Maria Souza", "85988887777"), person("Sem Dados")]],
      },
    });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    const r = await svc.contactsImport("w1", at);
    expect(r).toEqual({ total: 3, arquivos: 2, contas: 2, destino: PESSOAL }); // A.md e M.md
    expect(d.of(IFCE)).toEqual([]); // nada gravado no Drive do IFCE
    const mine = d.of(PESSOAL);
    const root = mine.find((f) => f.name === "Assist.IA")!;
    const folder = mine.find((f) => f.name === "Contatos")!;
    expect(folder.parents).toEqual([root.id]);
    expect(mine.find((f) => f.name === "M.md")!.content).toContain("## Marcos Silva\n- 📞 (85) 99999-0000\n- ✉️ marcos@x.com");
    expect(mine.find((f) => f.name === "M.md")!.content).toContain("## Maria Souza"); // contato do IFCE, no Drive pessoal
    expect(mine.find((f) => f.name === "A.md")!.content).toContain("## Ana Lima");
    expect(mine.some((f) => f.content.includes("Sem Dados"))).toBe(false);
  });

  it("mesma pessoa nas duas contas aparece uma vez só", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Marcos", "85911112222")]], [IFCE]: [[person("Marcos", "85911112222")]] } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    const r = await svc.contactsImport("w1", at);
    expect(r.total).toBe(1);
  });

  it("se uma conta falhar na leitura, não grava nada (não apaga os contatos dela)", async () => {
    const d = fake({
      people: { [PESSOAL]: [[person("Marcos", "85911112222")]] },
      peopleError: { [IFCE]: { status: 403, body: '{"error":{"message":"Request had insufficient authentication scopes."}}' } },
    });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await expect(svc.contactsImport("w1", at)).rejects.toThrow(/ana@ifce\.edu\.br.*Reconecte o Google/);
    expect(d.files).toEqual([]);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("marca todas as contas como importadas", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111")]] } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.contactsImport("w1", at);
    expect(db.update).toHaveBeenCalledTimes(2);
    for (const c of db.update.mock.calls) expect(c[0].data.config).toMatchObject({ provider: "google", contactsSyncedAt: at.toISOString() });
  });

  it("importar de novo não duplica arquivos e esvazia a letra que ficou sem contatos", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111"), person("Zeca", "85922223333")]] } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.contactsImport("w1", at);
    const ids = d.files.map((f) => f.id);
    const d2 = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111")]] } }); // o Zeca foi apagado no Google
    d2.files.push(...d.files);
    vi.stubGlobal("fetch", vi.fn(d2.handler));
    await svc.contactsImport("w1", at);
    expect(d2.files.map((f) => f.id)).toEqual(ids);
    expect(d2.files.find((f) => f.name === "Z.md")!.content).toContain("Nenhum contato");
    expect(d2.files.find((f) => f.name === "Z.md")!.content).not.toContain("Zeca");
  });

  it("só pessoal conectada: funciona igual; só IFCE conectada: usa o IFCE", async () => {
    connect(PESSOAL);
    const a = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111")]] } });
    vi.stubGlobal("fetch", vi.fn(a.handler));
    expect((await svc.contactsImport("w1", at)).destino).toBe(PESSOAL);
    connect(IFCE);
    const b = fake({ people: { [IFCE]: [[person("Ana", "85900001111")]] } });
    vi.stubGlobal("fetch", vi.fn(b.handler));
    expect((await svc.contactsImport("w1", at)).destino).toBe(IFCE);
    expect(b.of(IFCE).some((f) => f.name === "A.md")).toBe(true);
  });

  it("na primeira conexão importa uma vez; com o marcador, não faz nada", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111")]] } });
    const f = vi.fn(d.handler);
    vi.stubGlobal("fetch", f);
    await svc.importContactsOnce("w1", PESSOAL);
    expect(d.of(PESSOAL).some((x) => x.name === "A.md")).toBe(true);
    f.mockClear();
    db.channels.forEach((c) => (c.config.contactsSyncedAt = at.toISOString()));
    await svc.importContactsOnce("w1", PESSOAL);
    expect(f).not.toHaveBeenCalled();
  });

  it("falha na importação da conexão é engolida e não marca como feita", async () => {
    const d = fake({ peopleError: { [PESSOAL]: { status: 500, body: "erro" }, [IFCE]: { status: 500, body: "erro" } } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await expect(svc.importContactsOnce("w1", PESSOAL)).resolves.toBeUndefined();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("People API desativada: a mensagem traz o endereço para ativar", async () => {
    const body = JSON.stringify({ error: { code: 403, message: "People API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/people.googleapis.com/overview?project=123456 then retry.", status: "PERMISSION_DENIED" } });
    vi.stubGlobal("fetch", vi.fn(fake({ peopleError: { [PESSOAL]: { status: 403, body }, [IFCE]: { status: 403, body } } }).handler));
    await expect(svc.contactsImport("w1", at)).rejects.toThrow(/https:\/\/console\.developers\.google\.com\/apis\/api\/people\.googleapis\.com\/overview\?project=123456/);
  });

  it("consulta: null antes de importar; depois acha por nome (lendo só o Drive pessoal) e usa o cache", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Marcos Silva", "(85) 99999-0000", "marcos@x.com")]], [IFCE]: [[person("Maria Souza", "85988887777")]] } });
    const f = vi.fn(d.handler);
    vi.stubGlobal("fetch", f);
    expect(await svc.contactsLookup("w1", "marcos")).toBeNull();
    await svc.contactsImport("w1", at);
    expect(await svc.contactsLookup("w1", "marcos")).toEqual([{ nome: "Marcos Silva", telefones: ["(85) 99999-0000"], emails: ["marcos@x.com"] }]);
    expect((await svc.contactsLookup("w1", "maria"))![0].nome).toBe("Maria Souza"); // veio do IFCE, mas está no Drive pessoal
    // O Drive do IFCE nunca é tocado: do IFCE só se lê a lista de contatos (People API)
    expect(d.calls.filter((c) => c.includes(` ${IFCE} www.googleapis.com`))).toEqual([]);
    expect(d.calls.filter((c) => c.includes(` ${IFCE} people.googleapis.com`)).length).toBeGreaterThan(0);
    f.mockClear();
    await svc.contactsLookup("w1", "silva");
    expect(f).not.toHaveBeenCalled();
  });

  it("importar de novo invalida o cache da consulta", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Marcos", "85911112222")]] } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.contactsImport("w1", at);
    expect(await svc.contactsLookup("w1", "marcos")).toHaveLength(1);
    const d2 = fake({ people: { [PESSOAL]: [[person("Outro", "85933334444")]] } });
    d2.files.push(...d.files);
    vi.stubGlobal("fetch", vi.fn(d2.handler));
    await svc.contactsImport("w1", at);
    expect(await svc.contactsLookup("w1", "marcos")).toEqual([]);
  });

  /** OAuth de mentira por cima do Drive/People falsos. */
  const withOAuth = (d: ReturnType<typeof fake>, email: string) =>
    vi.fn(async (input: any, init?: RequestInit) => {
      const u = String(input);
      if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ refresh_token: "rt", access_token: "at", expires_in: 3600 }));
      if (u.startsWith("https://openidconnect.googleapis.com")) return new Response(JSON.stringify({ email }));
      return d.handler(input, init);
    });

  it("conectar a conta pela primeira vez importa os contatos em segundo plano", async () => {
    const d = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111")]] } });
    vi.stubGlobal("fetch", withOAuth(d, PESSOAL));
    expect(await svc.connect("w1", "codigo")).toBe(PESSOAL);
    await vi.waitFor(() => expect(d.of(PESSOAL).some((f) => f.name === "A.md")).toBe(true));
    await vi.waitFor(() => expect(db.update.mock.calls.some((c) => (c[0].data.config as any).contactsSyncedAt)).toBe(true));
  });

  it("reconectar preserva o marcador e não importa de novo", async () => {
    db.channels.forEach((c) => (c.config.contactsSyncedAt = "2026-09-01T00:00:00.000Z"));
    const d = fake({ people: { [PESSOAL]: [[person("Ana", "85900001111")]] } });
    vi.stubGlobal("fetch", withOAuth(d, PESSOAL));
    await svc.connect("w1", "codigo");
    await new Promise((r) => setTimeout(r, 30));
    expect(db.update.mock.calls[0][0].data.config).toMatchObject({ contactsSyncedAt: "2026-09-01T00:00:00.000Z" });
    expect(d.calls.some((c) => c.includes("people.googleapis.com"))).toBe(false);
  });
});
