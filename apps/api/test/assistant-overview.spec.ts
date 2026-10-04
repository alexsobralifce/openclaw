import { describe, expect, it, vi } from "vitest";

const count = vi.hoisted(() => vi.fn(async (_args?: unknown) => 7));
vi.mock("@openclaw/database", () => ({ prisma: { memory: { count } } }));

import { AssistantSettingsController } from "../src/modules/channels/assistant/assistant-settings.controller";

describe("resumo do painel: rotina e memória", () => {
  it("devolve os totais e só os itens de hoje, sem conteúdo da memória", async () => {
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Fortaleza" })).getDay();
    const memory: any = {
      listRoutine: async () => [
        { id: "1", topic: "Academia", description: "x", days: [today], time: "06:30" },
        { id: "2", topic: "Aulas", description: "y", days: [(today + 1) % 7], time: "19:00" },
      ],
    };
    const ctrl = new AssistantSettingsController({} as any, {} as any, memory);
    const r = await ctrl.overview({ user: { workspaces: [{ workspaceId: "w1" }] } });
    expect(r.routine.total).toBe(2);
    expect(r.routine.today).toEqual([{ topic: "Academia", when: expect.stringContaining("06:30") }]);
    expect(r.memories).toBe(7);
    expect(count).toHaveBeenCalledWith({ where: { workspaceId: "w1", kind: { not: "routine" } } });
  });
});
