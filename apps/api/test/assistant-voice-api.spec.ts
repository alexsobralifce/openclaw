import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/channels/assistant/commander", async (orig) => ({
  ...(await orig<any>()),
  workspaceCommander: vi.fn(),
}));

import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { workspaceCommander } from "../src/modules/channels/assistant/commander";
import { SCOPES } from "../src/modules/public-api/scopes";
import { openApiSpec } from "../src/modules/public-api/openapi";

const owner = { userId: "u1", name: "Ana", phone: "5585999999999", workspaceId: "ws1", services: ["assistant", "email"] };

function make(respond: () => Promise<string | null>) {
  const menu = { enterCar: vi.fn(), respond: vi.fn(respond), takeSecret: vi.fn(), takeRedact: vi.fn() };
  const svc = Object.create(AssistantService.prototype) as any;
  svc.menu = menu;
  svc.logger = { log: vi.fn(), error: vi.fn() };
  return { svc: svc as AssistantService, menu };
}

describe("comando de voz pela API pública", () => {
  beforeEach(() => vi.mocked(workspaceCommander).mockResolvedValue(owner as any));

  it("liga o modo carro e devolve o texto falável, sem emoji nem markdown", async () => {
    const { svc, menu } = make(async () => "📩 *Novo e-mail*\n━━━━\n👤 *De:* Ana\n1️⃣ 📖 Ler\n2️⃣ 🗑️ Apagar");
    const out = await svc.voice("ws1", "ler e-mails");
    expect(menu.enterCar).toHaveBeenCalledWith("ws1");
    expect(out.fala).toBe("Novo e-mail. De: Ana. Diga: ler ou apagar.");
  });

  it("vários comandos separados por ponto e vírgula rodam em ordem e respondem o último", async () => {
    const calls: string[] = [];
    const { svc } = make(async () => null);
    (svc as any).menu.respond = vi.fn(async (_ws: string, t: string) => {
      calls.push(t);
      return t === "Pessoal" ? "Seu e-mail pessoal" : "Qual conta?";
    });
    const out = await svc.voice("ws1", "ler e-mails; Pessoal");
    expect(calls).toEqual(["ler e-mails", "Pessoal"]);
    expect(out.fala).toBe("Seu e-mail pessoal");
  });

  it("limita a quatro comandos por chamada", async () => {
    const calls: string[] = [];
    const { svc } = make(async () => null);
    (svc as any).menu.respond = vi.fn(async (_ws: string, t: string) => (calls.push(t), "ok"));
    await svc.voice("ws1", "a;b;c;d;e;f");
    expect(calls).toHaveLength(4);
  });

  it("limpa as marcas de segredo e de código digitado (nada vai ao WhatsApp)", async () => {
    const { svc, menu } = make(async () => "ok");
    await svc.voice("ws1", "oi");
    expect(menu.takeSecret).toHaveBeenCalledWith("ws1");
    expect(menu.takeRedact).toHaveBeenCalledWith("ws1");
  });

  it("sem resposta do menu, não deixa a IA livre agir: pede um comando conhecido", async () => {
    const { svc } = make(async () => null);
    expect((await svc.voice("ws1", "manda um oi para o cliente")).fala).toMatch(/^Não entendi/);
  });

  it("erro no menu vira a mesma mensagem, sem vazar o erro", async () => {
    const { svc } = make(async () => {
      throw new Error("segredo interno");
    });
    expect((await svc.voice("ws1", "x")).fala).not.toMatch(/segredo interno/);
  });

  it("recusa conta sem o serviço assistente", async () => {
    vi.mocked(workspaceCommander).mockResolvedValue({ ...owner, services: ["email"] } as any);
    const { svc } = make(async () => "x");
    await expect(svc.voice("ws1", "x")).rejects.toThrow(/não está liberado/);
  });

  it("escopo e rota documentados", () => {
    expect(SCOPES).toContain("assistant:command");
    expect((openApiSpec() as any).paths["/assistant/command"].post).toBeTruthy();
  });
});
