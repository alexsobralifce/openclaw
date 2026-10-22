import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleService } from "../src/modules/integrations/google/google.service";

interface FakeFile { id: string; name: string; mimeType: string; parents: string[]; content: string; size: number }

/** Drive em memória: só o que as notas usam (buscar, criar pasta, criar/ler/atualizar arquivo). */
function fakeDrive(opts: { readDelay?: number; fail?: { status: number; body: string } } = {}) {
  const files: FakeFile[] = [];
  const calls: string[] = [];
  let seq = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const handler = async (input: any, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (opts.fail) return new Response(opts.fail.body, { status: opts.fail.status });

    if (url.pathname.startsWith("/upload/drive/v3/files")) {
      const body = String(init?.body ?? "");
      if (method === "POST") {
        const parts = body.split(/--oc[^\r\n]*/).filter((p) => p.includes("Content-Type"));
        const meta = JSON.parse(parts[0].split("\r\n\r\n")[1].trim());
        const content = parts[1].split("\r\n\r\n")[1].replace(/\r\n$/, "");
        const f = { id: `f${++seq}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, content, size: content.length };
        files.push(f);
        return json({ id: f.id });
      }
      const id = url.pathname.split("/").pop()!;
      const f = files.find((x) => x.id === id)!;
      f.content = body;
      f.size = body.length;
      return json({ id });
    }

    const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m && url.searchParams.get("alt") === "media") {
      // O conteúdo é fixado no momento do pedido: quem lê durante a gravação de outro vê a versão antiga, como na rede real
      const f = files.find((x) => x.id === m[1]);
      const snapshot = f?.content;
      if (opts.readDelay) await new Promise((r) => setTimeout(r, opts.readDelay));
      return f ? new Response(snapshot) : new Response("nao achei", { status: 404 });
    }

    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init?.body));
      const f = { id: `f${++seq}`, name: meta.name, mimeType: meta.mimeType, parents: [], content: "", size: 0 };
      files.push(f);
      return json({ id: f.id });
    }

    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const name = q.match(/name='([^']+)'/)?.[1];
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const text = [...q.matchAll(/fullText contains '([^']+)'/g)].map((x) => x[1].toLowerCase());
      const out = files.filter(
        (f) =>
          (!name || f.name === name) &&
          (!parent || f.parents.includes(parent)) &&
          (!text.length || text.some((t) => f.content.toLowerCase().includes(t))) &&
          (!q.includes("mimeType='application/vnd.google-apps.folder'") || f.mimeType === "application/vnd.google-apps.folder"),
      );
      return json({ files: out.map((f) => ({ id: f.id, name: f.name, size: String(f.size), modifiedTime: "2026-10-01T00:00:00Z" })) });
    }
    return new Response("rota inesperada", { status: 500 });
  };
  return { files, calls, handler };
}

const tz = "America/Fortaleza";
const at = new Date("2026-10-02T00:30:00Z"); // 21:30 do dia 1º em Fortaleza

describe("notas no Drive", () => {
  let svc: GoogleService;
  beforeEach(() => {
    svc = new GoogleService();
    (svc as any).accessToken = vi.fn().mockResolvedValue("tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("primeira nota cria a pasta Assist.IA e o arquivo do dia", async () => {
    const d = fakeDrive();
    vi.stubGlobal("fetch", vi.fn(d.handler));
    const r = await svc.noteAppend("ws1", "ligar pro Marcos", tz, "a@x.com", at);
    expect(r).toEqual({ nome: "2026-10-01.md", dia: "2026-10-01" });
    const folder = d.files.find((f) => f.mimeType === "application/vnd.google-apps.folder")!;
    expect(folder.name).toBe("Assist.IA");
    const note = d.files.find((f) => f.name === "2026-10-01.md")!;
    expect(note.parents).toEqual([folder.id]);
    expect(note.content).toBe("# 2026-10-01\n\n- 21:30 ligar pro Marcos\n");
  });

  it("segunda nota do dia acrescenta no mesmo arquivo e reaproveita a pasta", async () => {
    const d = fakeDrive();
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.noteAppend("ws1", "primeira", tz, "a@x.com", at);
    await svc.noteAppend("ws1", "segunda", tz, "a@x.com", new Date("2026-10-02T01:00:00Z"));
    expect(d.files.filter((f) => f.name === "2026-10-01.md")).toHaveLength(1);
    expect(d.files.filter((f) => f.name === "Assist.IA")).toHaveLength(1);
    expect(d.files.find((f) => f.name === "2026-10-01.md")!.content).toBe("# 2026-10-01\n\n- 21:30 primeira\n- 22:00 segunda\n");
  });

  it("pasta que já existe no Drive não é recriada (processo reiniciado)", async () => {
    const d = fakeDrive();
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.noteAppend("ws1", "a", tz, "a@x.com", at);
    const again = new GoogleService();
    (again as any).accessToken = vi.fn().mockResolvedValue("tok");
    await again.noteAppend("ws1", "b", tz, "a@x.com", at);
    expect(d.files.filter((f) => f.name === "Assist.IA")).toHaveLength(1);
    expect(d.files.filter((f) => f.name === "2026-10-01.md")).toHaveLength(1);
  });

  it("duas notas ao mesmo tempo não se sobrescrevem", async () => {
    const d = fakeDrive({ readDelay: 15 });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await svc.noteAppend("ws1", "zero", tz, "a@x.com", at);
    await Promise.all([svc.noteAppend("ws1", "um", tz, "a@x.com", at), svc.noteAppend("ws1", "dois", tz, "a@x.com", at)]);
    const content = d.files.find((f) => f.name === "2026-10-01.md")!.content;
    expect(content).toContain("zero");
    expect(content).toContain("um");
    expect(content).toContain("dois");
  });

  it("conta sem o escopo novo recebe pedido de reconexão", async () => {
    const d = fakeDrive({ fail: { status: 403, body: '{"error":{"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED"}}' } });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    await expect(svc.noteAppend("ws1", "x", tz, "a@x.com", at)).rejects.toThrow(/Reconecte o Google/);
  });

  it("uma falha não trava as notas seguintes", async () => {
    let fail = true;
    const d = fakeDrive();
    vi.stubGlobal("fetch", vi.fn((i: any, init?: RequestInit) => (fail ? Promise.resolve(new Response("erro", { status: 500 })) : d.handler(i, init))));
    await expect(svc.noteAppend("ws1", "x", tz, "a@x.com", at)).rejects.toThrow();
    fail = false;
    await expect(svc.noteAppend("ws1", "y", tz, "a@x.com", at)).resolves.toMatchObject({ nome: "2026-10-01.md" });
  });

  it("busca devolve os trechos que citam as palavras", async () => {
    const d = fakeDrive();
    vi.stubGlobal("fetch", vi.fn(d.handler));
    d.files.push({ id: "n1", name: "reunioes.md", mimeType: "text/markdown", parents: [], content: "# Reuniões\n\n- Contrato do Marcos assinado\n- Comprar café", size: 60 });
    d.files.push({ id: "n2", name: "outra.md", mimeType: "text/markdown", parents: [], content: "- nada a ver", size: 12 });
    const hits = await svc.noteSearch("ws1", ["contrato"], "a@x.com");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "n1", nome: "reunioes.md", trechos: ["- Contrato do Marcos assinado"] });
  });

  it("busca sem palavras não chama o Drive", async () => {
    const d = fakeDrive();
    const f = vi.fn(d.handler);
    vi.stubGlobal("fetch", f);
    expect(await svc.noteSearch("ws1", [], "a@x.com")).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
