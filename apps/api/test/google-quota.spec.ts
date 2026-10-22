import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { GoogleQuotaError, GoogleService } from "../src/modules/integrations/google/google.service";

const QUOTA_BODY = JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'" } });

function svc() {
  const s = new GoogleService() as any;
  s.accessToken = async () => "tok";
  s.sleepMs = vi.fn(async () => {});
  return s;
}

afterEach(() => vi.unstubAllGlobals());

describe("cota do Google", () => {
  it("cota por minuto vira mensagem clara; outro 403 segue como estava", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(QUOTA_BODY, { status: 403 })));
    const e = await svc().g("w1", "a@gmail.com", "https://gmail.googleapis.com/x").catch((x: Error) => x);
    expect(e).toBeInstanceOf(GoogleQuotaError);
    expect(e.message).toMatch(/limitou as consultas.*1 minuto/);
    expect(e.message).not.toMatch(/project_number|Total Query Cost/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Insufficient Permission" } }), { status: 403 })));
    await expect(svc().g("w1", "a", "https://gmail.googleapis.com/x")).rejects.toThrow(/^Google API 403: /);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(svc().g("w1", "a", "https://gmail.googleapis.com/x")).rejects.toBeInstanceOf(GoogleQuotaError);
  });

  it("a importação do catálogo espera e tenta de novo quando o Google limita", async () => {
    let msgCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes("/messages?")) return new Response(JSON.stringify({ messages: [{ id: "m1" }] }));
        msgCalls++;
        if (msgCalls <= 2) return new Response(QUOTA_BODY, { status: 403 });
        return new Response(JSON.stringify({ payload: { headers: [{ name: "From", value: "Ana <ana@x.com>" }] } }));
      }),
    );
    const s = svc();
    const out = await s.gmailHeaders("w1", "a@gmail.com", "in:inbox", 10);
    expect(out).toEqual([{ from: "Ana <ana@x.com>", to: undefined, cc: undefined }]);
    expect(msgCalls).toBe(3);
    expect(s.sleepMs.mock.calls.map((c: number[]) => c[0])).toEqual([20_000, 40_000]);
  });

  it("desiste depois de 3 tentativas sem derrubar a importação (o endereço some, o resto segue)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => (String(url).includes("/messages?") ? new Response(JSON.stringify({ messages: [{ id: "m1" }, { id: "m2" }] })) : new Response(QUOTA_BODY, { status: 403 }))),
    );
    const s = svc();
    expect(await s.gmailHeaders("w1", "a", "in:inbox", 10)).toEqual([]);
    expect(s.sleepMs).toHaveBeenCalledTimes(4); // 2 esperas por mensagem
  });

  it("a lista de mensagens com cota estourada sobe como erro claro (a importação inteira falha com aviso)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(QUOTA_BODY, { status: 403 })));
    await expect(svc().gmailHeaders("w1", "a", "in:inbox", 10)).rejects.toBeInstanceOf(GoogleQuotaError);
  });
});
