import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { AssistantService } from "../src/modules/channels/assistant/assistant.service";

process.env.WEBHOOK_SECRET = "segredo-de-teste-da-memoria";

function build(opts: { secret?: boolean } = {}) {
  const store = new Map<string, any>();
  const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
  const sendText = vi.fn(async () => ({ key: { id: "M1", remoteJid: "5585@s.whatsapp.net" } }));
  const menu = {
    setExecutor() {},
    setFileSender() {},
    setChatCleaner() {},
    respond: vi.fn(async (): Promise<string | null> => "ok"),
    isCar: async () => false,
    takeSecret: async () => !!opts.secret,
    takeRedact: async () => false,
    awaitingPin: async () => false,
    requestConfirm: vi.fn(),
  };
  const memory = { promptBlock: async () => "" };
  const svc = new AssistantService({ sendText } as any, {} as any, menu as any, memory as any, {} as any, state as any);
  return { svc, store, menu, sendText };
}

const c = { userId: "u1", name: "Ana", phone: "5585", workspaceId: "w1", services: [] } as any;
const handle = (svc: AssistantService, text: string) => svc.handle(c, "inst", text);

describe("memória da conversa no assistente", () => {
  it("guarda a troca de uma mensagem normal, cifrada", async () => {
    const { svc, store, menu } = build();
    menu.respond.mockResolvedValue("Achei 3 e-mails do Arnaud.");
    await handle(svc, "emails do arnaud");
    const doc = store.get("conv:u1");
    expect(doc.turns).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain("arnaud");
  });

  it("não guarda escolha de menu, resposta com segredo nem conversa do cofre", async () => {
    const a = build();
    await handle(a.svc, "1");
    expect(a.store.has("conv:u1")).toBe(false);

    const b = build({ secret: true });
    await handle(b.svc, "qual a senha do wifi");
    expect(b.store.has("conv:u1")).toBe(false);

    const v = build();
    await handle(v.svc, "abrir cofre");
    await handle(v.svc, "senha do netflix");
    expect(v.store.has("conv:u1")).toBe(false);
  });

  it("não guarda quando o assistente falha", async () => {
    const { svc, store, menu } = build();
    menu.respond.mockRejectedValue(new Error("quebrou"));
    await handle(svc, "emails do arnaud");
    expect(store.has("conv:u1")).toBe(false);
  });

  it("'esquecer a conversa' apaga a memória e não vai para a IA", async () => {
    const { svc, store, menu, sendText } = build();
    await handle(svc, "emails do arnaud");
    expect(store.has("conv:u1")).toBe(true);
    menu.respond.mockClear();
    await handle(svc, "esquecer a conversa");
    expect(store.has("conv:u1")).toBe(false);
    expect(menu.respond).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.stringContaining("esqueci"));
  });

  describe("a IA livre recebe as últimas trocas", () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = "test";
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.OPENAI_API_KEY;
    });

    it("a segunda mensagem chega à IA com a primeira no prompt", async () => {
      const { svc, menu } = build();
      const sent: any[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_u: any, init: any) => {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Do João há 1 e-mail." } }] }));
      }));
      menu.respond.mockResolvedValueOnce("Achei 3 e-mails do Arnaud.").mockResolvedValueOnce(null);
      await handle(svc, "emails do arnaud");
      await handle(svc, "e do joao?");
      const system = sent[0].messages[0].content as string;
      expect(system).toContain("CONVERSA RECENTE");
      expect(system).toContain("Dono: emails do arnaud");
      expect(system).toContain("Achei 3 e-mails do Arnaud.");
      expect(sent[0].messages[sent[0].messages.length - 1]).toEqual({ role: "user", content: "e do joao?" });
    });

    it("sem histórico, o prompt não ganha o bloco", async () => {
      const { svc, menu } = build();
      const sent: any[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_u: any, init: any) => {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "oi" } }] }));
      }));
      menu.respond.mockResolvedValue(null);
      await handle(svc, "bom dia");
      expect(sent[0].messages[0].content).not.toContain("CONVERSA RECENTE");
    });
  });
});
