import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  up: true,
  stuck: 0,
  channels: [{ config: { instanceName: "inst" } }] as any[],
}));

vi.mock("@magobox/database", () => ({
  prisma: {
    $queryRaw: async () => {
      if (!db.up) throw new Error("connection refused");
      return [{ "?column?": 1 }];
    },
    inboundEvent: { count: async () => db.stuck },
    workspaceMember: { findMany: async () => [{ workspaceId: "ws" }] },
    channel: { findMany: async () => db.channels },
  },
}));

import { HealthService } from "../src/modules/health/health.service";

const svc = (state: any) => new HealthService({ getConnectionState: async () => (state instanceof Error ? Promise.reject(state) : state) } as any);

describe("health", () => {
  beforeEach(() => {
    db.up = true;
    db.stuck = 0;
    db.channels = [{ config: { instanceName: "inst" } }];
  });

  it("live: só depende do banco", async () => {
    expect((await svc({}).live()).status).toBe("ok");
    db.up = false;
    expect(await svc({}).live()).toEqual({ status: "down", failing: ["db"] });
  });

  it("full: tudo certo", async () => {
    expect(await svc({ instance: { state: "open" } }).full()).toEqual({ status: "ok", failing: [] });
  });

  it("full: WhatsApp desconectado é 'degraded' e diz o quê", async () => {
    expect(await svc({ instance: { state: "close" } }).full()).toEqual({ status: "degraded", failing: ["whatsapp-desconectado"] });
    expect((await svc({ state: "connecting" }).full()).failing).toEqual(["whatsapp-desconectado"]);
  });

  it("full: Evolution fora do ar", async () => {
    expect((await svc(new Error("ECONNREFUSED")).full()).failing).toEqual(["evolution"]);
  });

  it("full: mensagens paradas na fila de entrada", async () => {
    db.stuck = 3;
    expect((await svc({ instance: { state: "open" } }).full()).failing).toEqual(["fila-de-entrada"]);
  });

  it("full: banco fora do ar é 'down' e não consulta o resto", async () => {
    db.up = false;
    expect(await svc({ instance: { state: "open" } }).full()).toEqual({ status: "down", failing: ["db"] });
  });

  it("full: sem canal de WhatsApp do root não há o que alarmar", async () => {
    db.channels = [];
    expect((await svc({ instance: { state: "close" } }).full()).status).toBe("ok");
  });

  it("full: resultado fica em cache por 30 s", async () => {
    const s = svc({ instance: { state: "open" } });
    await s.full();
    db.up = false;
    expect((await s.full()).status).toBe("ok");
  });
});
