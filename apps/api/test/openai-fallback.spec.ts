import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ upsert: vi.fn(async (_a: any) => ({})) }));
vi.mock("@magobox/database", () => ({ prisma: { aiUsage: { upsert: (a: any) => h.upsert(a) } } }));

import { chatCompletion, fallbackReasoning, shouldFallback } from "../src/modules/channels/assistant/openai-chat";

const ok = (model: string) => new Response(JSON.stringify({ model, choices: [{ message: { content: "oi" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
const fail = (status: number, text = "erro") => new Response(text, { status });

function stub(...responses: (Response | Error)[]) {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      const r = responses[Math.min(bodies.length - 1, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }),
  );
  return bodies;
}
const call = () => chatCompletion({ messages: [{ role: "user", content: "oi" }] }, { apiKey: "k", ws: "w1" });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("modelo reserva da IA (OpenAI)", () => {
  beforeEach(() => {
    delete process.env.OPENAI_MODEL;
    process.env.OPENAI_FALLBACK_MODEL = "reserva-x";
    h.upsert.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_FALLBACK_MODEL;
  });

  it("principal responde: o reserva nem é chamado", async () => {
    const bodies = stub(ok("gpt-4o-mini"));
    await call();
    expect(bodies.map((b) => b.model)).toEqual(["gpt-4o-mini"]);
  });

  it("principal fora do ar (503): usa o reserva, com o mesmo pedido, e conta os tokens no modelo reserva", async () => {
    const bodies = stub(fail(503), ok("reserva-x"));
    const data = await call();
    expect(data.choices[0].message.content).toBe("oi");
    expect(bodies.map((b) => b.model)).toEqual(["gpt-4o-mini", "reserva-x"]);
    expect(bodies[1].messages).toEqual(bodies[0].messages);
    await flush();
    expect(h.upsert.mock.calls[0][0].where.userId_day_provider_model.model).toBe("reserva-x");
  });

  it("limite de uso (429), modelo inexistente (404) e falha de rede também acionam o reserva", async () => {
    for (const first of [fail(429), fail(404), new Error("fetch failed")]) {
      const bodies = stub(first, ok("reserva-x"));
      await call();
      expect(bodies).toHaveLength(2);
    }
  });

  it("erro do pedido ou da chave (400, 401, 403) não aciona o reserva", async () => {
    for (const s of [400, 401, 403]) {
      const bodies = stub(fail(s, "ruim"));
      await expect(call()).rejects.toThrow(`OpenAI ${s}`);
      expect(bodies).toHaveLength(1);
    }
  });

  it("os dois falham: o erro é o do último, em português quando é de rede", async () => {
    stub(fail(503), new Error("fetch failed"));
    await expect(call()).rejects.toThrow("OpenAI indisponível: fetch failed");
  });

  it("sem reserva configurada, ou igual ao principal, não repete a chamada", async () => {
    delete process.env.OPENAI_FALLBACK_MODEL;
    let bodies = stub(fail(503));
    await expect(call()).rejects.toThrow("OpenAI 503");
    expect(bodies).toHaveLength(1);
    process.env.OPENAI_FALLBACK_MODEL = "gpt-4o-mini";
    bodies = stub(fail(503));
    await expect(call()).rejects.toThrow("OpenAI 503");
    expect(bodies).toHaveLength(1);
  });

  it("o principal vem de OPENAI_MODEL", async () => {
    process.env.OPENAI_MODEL = "meu-principal";
    const bodies = stub(fail(500), ok("reserva-x"));
    await call();
    expect(bodies.map((b) => b.model)).toEqual(["meu-principal", "reserva-x"]);
    delete process.env.OPENAI_MODEL;
  });

  it("shouldFallback", () => {
    expect([null, 404, 408, 429, 500, 502, 503].every(shouldFallback)).toBe(true);
    expect([400, 401, 403, 422].some(shouldFallback)).toBe(false);
  });

  it("o reserva recebe reasoning_effort 'none' (o Luna recusa ferramentas sem isso); o principal nunca recebe", async () => {
    const bodies = stub(fail(503), ok("reserva-x"));
    await call();
    expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].reasoning_effort).toBe("none");
  });

  it("reserva que recusa o parâmetro: repete sem ele; erro de ferramentas com raciocínio não repete", async () => {
    let bodies = stub(fail(503), fail(400, "Unsupported parameter: reasoning_effort"), ok("reserva-x"));
    await call();
    expect(bodies.map((b) => b.reasoning_effort)).toEqual([undefined, "none", undefined]);
    bodies = stub(fail(503), fail(400, "Function tools with reasoning_effort are not supported"));
    await expect(call()).rejects.toThrow("Function tools");
    expect(bodies).toHaveLength(2);
  });

  it("OPENAI_FALLBACK_REASONING muda o valor, e 'off' não envia nada", async () => {
    process.env.OPENAI_FALLBACK_REASONING = "low";
    expect(fallbackReasoning()).toBe("low");
    process.env.OPENAI_FALLBACK_REASONING = "off";
    const bodies = stub(fail(503), ok("reserva-x"));
    await call();
    expect(bodies[1].reasoning_effort).toBeUndefined();
    delete process.env.OPENAI_FALLBACK_REASONING;
  });
});
