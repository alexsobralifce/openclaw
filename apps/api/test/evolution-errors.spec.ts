import { afterEach, describe, expect, it, vi } from "vitest";
import { EvolutionError, EvolutionService, evolutionMessage } from "../src/modules/channels/evolution/evolution.service";

const svc = new EvolutionService();
afterEach(() => vi.unstubAllGlobals());

const failWith = (status: number, body: string) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

describe("erros do Evolution", () => {
  it("Evolution fora do ar vira erro 'inacessível', sem status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }));
    const e: any = await svc.getConnectionState("x").catch((err) => err);
    expect(e).toBeInstanceOf(EvolutionError);
    expect(e.unreachable).toBe(true);
    expect(e.message).toContain("ECONNREFUSED");
    expect(evolutionMessage(e)).toContain("fora do ar");
  });

  it("instância perdida (404) é reconhecida e pede reconexão", async () => {
    failWith(404, '{"response":{"message":["The \\"oc_1\\" instance does not exist"]}}');
    const e: any = await svc.getQrCode("oc_1").catch((err) => err);
    expect(svc.isMissingInstance(e)).toBe(true);
    expect(evolutionMessage(e)).toContain("desconectado");
  });

  it("conexão fechada em outro status também pede reconexão", async () => {
    failWith(500, '{"message":"Connection Closed"}');
    const e: any = await svc.sendText("oc_1", "5585999999999", "oi").catch((err) => err);
    expect(svc.isMissingInstance(e)).toBe(false);
    expect(evolutionMessage(e)).toContain("desconectado");
  });

  it("chave recusada e demais erros têm textos próprios, sem vazar o corpo da resposta", async () => {
    failWith(401, "segredo-interno");
    const auth: any = await svc.getQrCode("x").catch((err) => err);
    expect(evolutionMessage(auth)).toContain("recusou o acesso");
    failWith(400, "detalhe-técnico");
    const other: any = await svc.getQrCode("x").catch((err) => err);
    expect(evolutionMessage(other)).not.toContain("detalhe-técnico");
    expect(evolutionMessage(new Error("qualquer"))).toContain("Não foi possível");
  });
});
