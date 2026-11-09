// Medição offline do tamanho do contexto que o assistente manda à IA (sem custo, sem rede).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as any[],
  sent: [] as any[][],
}));

vi.mock("@openclaw/database", () => ({ prisma: {} }));
vi.mock("../src/modules/channels/assistant/openai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/channels/assistant/openai-chat")>()),
  chatCompletion: async (req: { messages: any[] }) => {
    h.sent.push(JSON.parse(JSON.stringify(req.messages)));
    const next = h.queue.shift();
    if (!next) throw new Error("sem resposta roteirizada");
    return { model: "teste", choices: [{ message: next }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
  },
}));

import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { MAX_TOTAL_CHARS } from "../src/modules/channels/assistant/conversation-memory";

const TOOL_CAP = 2_500;

// Dados de ferramentas com tamanho realista: e-mails com trecho, eventos com descrição
const emails = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, de: `Remetente ${i} <r${i}@exemplo.com>`, assunto: `Assunto número ${i} sobre o projeto`, data: "2026-11-09T10:00:00Z", trecho: "Lorem ipsum dolor sit amet ".repeat(12) }));
const events = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}`, titulo: `Reunião ${i} com a equipe`, inicio: `2026-11-10T${String(8 + (i % 10)).padStart(2, "0")}:00`, fim: `2026-11-10T${String(9 + (i % 10)).padStart(2, "0")}:00`, local: "Sala 3", descricao: "Pauta e decisões do dia ".repeat(8) }));

const call = (id: string, name: string, args: object = {}) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function makeService() {
  const store = new Map<string, any>();
  const state = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: any) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  };
  const svc = new AssistantService(
    {} as any,
    {} as any,
    new Proxy({}, { get: () => () => {} }) as any, // o laço não usa o menu, só a construção
    { promptBlock: async () => "" } as any,
    {} as any,
    state as any,
  );
  return { svc, state };
}

const commander = { userId: "u1", name: "Ana", phone: "5511", workspaceId: "ws1", services: ["email", "calendar", "drive", "notes", "contacts", "inbox", "assistant", "vault"] } as any;

/** Roda o laço de ferramentas de verdade e devolve o maior envio à IA (em caracteres de JSON). */
async function measure(text: string, responses: any[], results: Record<string, unknown>, prior = 0) {
  const { svc, state } = makeService();
  if (prior) {
    const { ConversationMemory } = await import("../src/modules/channels/assistant/conversation-memory");
    const mem = new ConversationMemory(state as any);
    for (let i = 0; i < prior; i++) await mem.remember("u1", "ws1", `pergunta anterior ${i} sobre a agenda da semana`, `resposta anterior ${i} com os detalhes combinados ${"x".repeat(300)}`);
  }
  h.queue = [...responses];
  h.sent = [];
  vi.spyOn(svc as any, "runTool").mockImplementation(async (_ws: string, name: string) => results[name] ?? { ok: true });
  const answer = await (svc as any).think(commander, text);
  const sizes = h.sent.map((m) => JSON.stringify(m).length);
  const toolMsgs = h.sent.at(-1)!.filter((m) => m.role === "tool").map((m) => m.content.length);
  const toolContents = h.sent.at(-1)!.filter((m) => m.role === "tool").map((m) => m.content as string);
  return { answer, calls: h.sent.length, maxSize: Math.max(...sizes), toolMsgs, toolContents };
}

describe("medição: contexto enviado à IA no laço de ferramentas", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "k-teste";
  });

  it("cenário 1: listar e-mails com resultado grande", async () => {
    const r = await measure("lista meus e-mails não lidos", [
      { role: "assistant", content: null, tool_calls: [call("c1", "gmail_search", { query: "is:unread" })] },
      { role: "assistant", content: "Você tem 30 e-mails não lidos." },
    ], { gmail_search: { itens: emails(30) } });
    console.log(`[medição] e-mails: ${r.calls} chamadas · maior envio ${r.maxSize} caracteres · tool ${r.toolMsgs.join(",")}`);
    expect(r.answer).toContain("30 e-mails");
    expect(Math.max(...r.toolMsgs)).toBeLessThanOrEqual(TOOL_CAP);
    expect(r.toolContents[0]).toMatch(/…\(\d+ itens omitidos\)$/);
  });

  it("cenário 2: agenda", async () => {
    const r = await measure("o que tenho na agenda amanhã", [
      { role: "assistant", content: null, tool_calls: [call("c1", "calendar_list_events", { dia: "amanhã" })] },
      { role: "assistant", content: "Você tem 20 compromissos." },
    ], { calendar_list_events: { itens: events(20) } });
    console.log(`[medição] agenda: ${r.calls} chamadas · maior envio ${r.maxSize} caracteres · tool ${r.toolMsgs.join(",")}`);
    expect(r.answer).toContain("20 compromissos");
    expect(Math.max(...r.toolMsgs)).toBeLessThanOrEqual(TOOL_CAP);
  });

  it("cenário 3: pedido com 2 ferramentas (e-mail e agenda) e histórico cheio", async () => {
    const r = await measure("resume meus e-mails e a agenda de hoje", [
      { role: "assistant", content: null, tool_calls: [call("c1", "gmail_search", { query: "is:unread" }), call("c2", "calendar_list_events", { dia: "hoje" })] },
      { role: "assistant", content: "Resumo pronto." },
    ], { gmail_search: { itens: emails(30) }, calendar_list_events: { itens: events(20) } }, 10);
    console.log(`[medição] 2 ferramentas + histórico: ${r.calls} chamadas · maior envio ${r.maxSize} caracteres · tool ${r.toolMsgs.join(",")}`);
    expect(r.answer).toBe("Resumo pronto.");
    expect(Math.max(...r.toolMsgs)).toBeLessThanOrEqual(TOOL_CAP);
    expect(MAX_TOTAL_CHARS).toBeLessThanOrEqual(3_000);
  });
});
