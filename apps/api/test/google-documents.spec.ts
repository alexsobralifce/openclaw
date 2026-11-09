import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleService } from "../src/modules/integrations/google/google.service";

interface FakeFile { id: string; name: string; mimeType: string; parents: string[] }

const FOLDER = "application/vnd.google-apps.folder";

/**
 * Drive em memória com Assist.IA/Documentos e dois PDFs na raiz de Documentos.
 * `hideNewFolders` simula a consistência eventual: pasta recém-criada ainda não aparece na busca.
 */
function fakeDocsDrive(opts: { hideNewFolders?: boolean } = {}) {
  const files: FakeFile[] = [
    { id: "pastaassist", name: "Assist.IA", mimeType: FOLDER, parents: [] },
    { id: "pastadocs00", name: "Documentos", mimeType: FOLDER, parents: ["pastaassist"] },
    { id: "pdfarquivo1", name: "a.pdf", mimeType: "application/pdf", parents: ["pastadocs00"] },
    { id: "pdfarquivo2", name: "b.pdf", mimeType: "application/pdf", parents: ["pastadocs00"] },
  ];
  const created = new Set<string>();
  let seq = 0;
  let patches = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  const handler = async (input: any, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init?.body));
      const f: FakeFile = { id: `pastanova${++seq}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [] };
      files.push(f);
      created.add(f.id);
      return json({ id: f.id });
    }
    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const name = q.match(/name='([^']+)'/)?.[1];
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const out = files.filter(
        (f) =>
          (!name || f.name === name) &&
          (!parent || f.parents.includes(parent)) &&
          (!q.includes(`mimeType='${FOLDER}'`) || f.mimeType === FOLDER) &&
          !(opts.hideNewFolders && created.has(f.id)),
      );
      return json({ files: out.map((f) => ({ id: f.id })) });
    }
    const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      const f = files.find((x) => x.id === m[1])!;
      if (method === "PATCH") {
        patches++;
        const add = url.searchParams.get("addParents") ?? "";
        f.parents = [add];
        return json({ id: f.id, parents: f.parents });
      }
      return json({ parents: f.parents, trashed: false, mimeType: f.mimeType });
    }
    return new Response("rota inesperada", { status: 500 });
  };
  return { files, handler, created, patches: () => patches };
}

describe("documentMove no Drive", () => {
  let svc: GoogleService;
  beforeEach(() => {
    svc = new GoogleService();
    (svc as any).accessToken = vi.fn().mockResolvedValue("tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mover para a pasta em que o PDF já está devolve false e não faz PATCH", async () => {
    const d = fakeDocsDrive();
    vi.stubGlobal("fetch", vi.fn(d.handler));
    expect(await svc.documentMove("ws1", "pdfarquivo1", "Finanças", "a@x.com")).toBe(true);
    expect(d.patches()).toBe(1);
    expect(await svc.documentMove("ws1", "pdfarquivo1", "Finanças", "a@x.com")).toBe(false);
    expect(d.patches()).toBe(1);
  });

  it("duas moves para a mesma categoria nova criam a pasta uma única vez", async () => {
    const d = fakeDocsDrive({ hideNewFolders: true });
    vi.stubGlobal("fetch", vi.fn(d.handler));
    const folders = new Map<string, string>();
    await svc.documentMove("ws1", "pdfarquivo1", "Viagens", "a@x.com", folders);
    await svc.documentMove("ws1", "pdfarquivo2", "Viagens", "a@x.com", folders);
    expect(d.files.filter((f) => f.name === "Viagens")).toHaveLength(1);
    const pasta = d.files.find((f) => f.name === "Viagens")!.id;
    expect(d.files.find((f) => f.id === "pdfarquivo1")!.parents).toEqual([pasta]);
    expect(d.files.find((f) => f.id === "pdfarquivo2")!.parents).toEqual([pasta]);
  });
});
