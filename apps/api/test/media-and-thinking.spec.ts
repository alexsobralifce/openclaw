import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: { aiUsage: { upsert: async () => ({}) } } }));

import { AssistantService } from "../src/modules/channels/assistant/assistant.service";
import { GeminiService, thinkingConfig } from "../src/modules/channels/assistant/gemini.service";
import { fmtDuration, maxAudioSeconds, maxPdfPages, pdfPageCount } from "../src/modules/channels/assistant/media-limits";
import { audioSeconds } from "../src/modules/channels/whatsapp/parse";

const fakePdf = (pages: number, declared = pages) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Kids [] /Count ${declared} >> endobj\n` + Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj`).join("\n"));

describe("limites de PDF e áudio", () => {
  afterEach(() => {
    delete process.env.MAX_PDF_PAGES;
    delete process.env.MAX_AUDIO_SECONDS;
  });

  it("conta páginas pelos objetos e pelo total declarado, sem confundir /Pages com /Page", () => {
    expect(pdfPageCount(fakePdf(12))).toBe(12);
    expect(pdfPageCount(fakePdf(3, 40))).toBe(40);
    expect(pdfPageCount(Buffer.from("não é um pdf"))).toBe(0);
    expect(pdfPageCount(Buffer.from("<< /Type /Pages /Kids [] >>"))).toBe(0);
  });

  it("os limites padrão têm folga e podem ser mudados pelo ambiente", () => {
    expect(maxPdfPages()).toBe(80);
    expect(maxAudioSeconds()).toBe(300);
    process.env.MAX_PDF_PAGES = "30";
    process.env.MAX_AUDIO_SECONDS = "90";
    expect([maxPdfPages(), maxAudioSeconds()]).toEqual([30, 90]);
    process.env.MAX_PDF_PAGES = "lixo";
    expect(maxPdfPages()).toBe(80);
  });

  it("duração em texto e leitura dos segundos do WhatsApp", () => {
    expect(fmtDuration(200)).toBe("3 min 20 s");
    expect(fmtDuration(300)).toBe("5 min");
    expect(fmtDuration(45)).toBe("45 s");
    expect(audioSeconds({ audioMessage: { seconds: 412 } })).toBe(412);
    expect(audioSeconds({ ephemeralMessage: { message: { audioMessage: { seconds: 9 } } } })).toBe(9);
    expect(audioSeconds({ conversation: "oi" })).toBeNull();
  });

  it("PDF acima do limite: avisa em português e não manda para a IA", async () => {
    const svc = Object.create(AssistantService.prototype) as any;
    const sent: string[] = [];
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.menu = { agendaMediaIntent: vi.fn(async () => "note"), noteIngest: vi.fn(async () => "NÃO DEVIA"), agendaIngest: vi.fn() };
    svc.evolution = { getMediaBase64: vi.fn(async () => ({ base64: fakePdf(200).toString("base64"), mimetype: "application/pdf" })) };
    svc.sendToUser = vi.fn(async (_c: any, _i: string, t: string) => void sent.push(t));
    svc.scheduleIdle = vi.fn(async () => {});
    await svc.handleAgendaMedia({ userId: "u", name: "Ana", phone: "1", workspaceId: "w", services: [] }, "i", {}, { mime: "application/pdf", caption: "" });
    expect(svc.menu.noteIngest).not.toHaveBeenCalled();
    expect(sent.some((t) => t.includes("200 páginas") && t.includes("limite de 80"))).toBe(true);
  });
});

describe("pensamento do Gemini", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "k";
    delete process.env.GEMINI_THINKING_LEVEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_THINKING_LEVEL;
  });
  const okBody = { candidates: [{ content: { parts: [{ text: "texto lido" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };

  it("nível 'low' por padrão; 'minimal' e lixo não são enviados; 'off' desliga", () => {
    expect(thinkingConfig()).toEqual({ thinkingConfig: { thinkingLevel: "low" } });
    process.env.GEMINI_THINKING_LEVEL = "HIGH";
    expect(thinkingConfig().thinkingConfig?.thinkingLevel).toBe("high");
    for (const v of ["minimal", "off", "lixo", ""]) {
      process.env.GEMINI_THINKING_LEVEL = v;
      expect(thinkingConfig()).toEqual({});
    }
  });

  it("a leitura de arquivo e a transcrição mandam o nível de pensamento", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: any, init: any) => (bodies.push(JSON.parse(init.body)), new Response(JSON.stringify(okBody)))));
    const g = new GeminiService();
    await g.extract("p", { text: "t" });
    await g.transcribe(Buffer.from("a"), "audio/ogg");
    expect(bodies.map((b) => b.generationConfig)).toEqual([{ thinkingConfig: { thinkingLevel: "low" } }, { thinkingConfig: { thinkingLevel: "low" } }]);
  });

  it("só o principal recebe o nível de pensamento; o reserva vai sem (ele não pensa por padrão)", async () => {
    process.env.GEMINI_FALLBACK_MODEL = "reserva-lite";
    const sent: { model: string; cfg: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init: any) => {
        const model = String(url).match(/models\/([^:]+):/)![1];
        sent.push({ model, cfg: JSON.parse(init.body).generationConfig });
        return model === "reserva-lite" ? new Response(JSON.stringify(okBody)) : new Response("alta demanda", { status: 503 });
      }),
    );
    expect(await new GeminiService().extract("p", { text: "t" })).toBe("texto lido");
    const principal = sent.filter((x) => x.model !== "reserva-lite");
    expect(principal.length).toBeGreaterThan(0);
    expect(principal.every((x) => x.cfg?.thinkingConfig?.thinkingLevel === "low")).toBe(true);
    expect(sent.filter((x) => x.model === "reserva-lite").every((x) => x.cfg === undefined)).toBe(true);
  });

  it("modelo que recusa o nível (400): repete na hora sem ele e a leitura funciona", async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: any, init: any) => {
        const b = JSON.parse(init.body);
        bodies.push(b);
        return b.generationConfig?.thinkingConfig ? new Response("thinking level not supported", { status: 400 }) : new Response(JSON.stringify(okBody));
      }),
    );
    expect(await new GeminiService().extract("p", { text: "t" })).toBe("texto lido");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].generationConfig).toEqual({});
  });

  it("um 400 sem relação com o nível não fica em laço: falha", async () => {
    const f = vi.fn(async () => new Response("pedido ruim", { status: 400 }));
    vi.stubGlobal("fetch", f);
    await expect(new GeminiService().extract("p", { text: "t" })).rejects.toThrow("Gemini 400");
    expect(f).toHaveBeenCalledTimes(2); // com e sem o nível; nada além disso
  });
});
