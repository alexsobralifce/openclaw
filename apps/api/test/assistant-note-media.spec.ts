import { describe, expect, it, vi } from "vitest";
import { AssistantService } from "../src/modules/channels/assistant/assistant.service";

const c = { userId: "u1", name: "Ana", phone: "5585999999999", workspaceId: "ws1", services: ["assistant", "drive"] } as any;

function make(mode: "note" | "yes" | "hint" | "no", opts: { ingest?: () => Promise<string>; download?: () => Promise<any>; ackFails?: boolean } = {}) {
  const order: string[] = [];
  const sent: string[] = [];
  const svc = Object.create(AssistantService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.menu = {
    agendaMediaIntent: vi.fn(async () => mode),
    noteIngest: vi.fn(async () => (order.push("ingest"), opts.ingest ? opts.ingest() : "📝 *Nota criada!*")),
    agendaIngest: vi.fn(async () => "🗓️ Confirmar evento"),
  };
  svc.evolution = { getMediaBase64: vi.fn(async () => (order.push("download"), opts.download ? opts.download() : { base64: "AAAA", mimetype: "application/pdf" })) };
  svc.sendToUser = vi.fn(async (_c: any, _i: string, text: string) => {
    order.push("send");
    sent.push(text);
    if (opts.ackFails && sent.length === 1) throw new Error("evolution fora");
  });
  svc.scheduleIdle = vi.fn(async () => {});
  return { svc: svc as AssistantService, sent, order };
}

const media = { mime: "application/pdf", caption: "" };

describe("PDF para nota: aviso de recebimento", () => {
  it("avisa que a nota está sendo criada ANTES de ler o arquivo, e depois confirma", async () => {
    const { svc, sent, order } = make("note");
    await svc.handleAgendaMedia(c, "inst", { id: "k" }, media);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("Recebi o arquivo");
    expect(sent[0]).toContain("confirmo o cadastro");
    expect(sent[1]).toContain("Nota criada");
    expect(order).toEqual(["send", "download", "ingest", "send"]);
  });

  it("se o aviso falhar, a nota é criada mesmo assim", async () => {
    const { svc, sent } = make("note", { ackFails: true });
    await svc.handleAgendaMedia(c, "inst", { id: "k" }, media);
    expect(sent[1]).toContain("Nota criada");
  });

  it("falha ao baixar: diz que a nota NÃO foi criada", async () => {
    const { svc, sent } = make("note", { download: async () => { throw new Error("timeout"); } });
    await svc.handleAgendaMedia(c, "inst", { id: "k" }, media);
    expect(sent[1]).toContain("*não* foi criada");
  });

  it("agenda e orientação não mandam o aviso de nota", async () => {
    const a = make("yes");
    await a.svc.handleAgendaMedia(c, "inst", { id: "k" }, media);
    expect(a.sent).toEqual(["🗓️ Confirmar evento"]);
    const b = make("hint");
    await b.svc.handleAgendaMedia(c, "inst", { id: "k" }, media);
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]).toContain("O que faço com ele");
  });
});
