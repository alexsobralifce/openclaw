import { describe, expect, it, vi } from "vitest";

// email-watcher importa o Prisma e serviços: mocks mínimos só para carregar o módulo
vi.mock("@openclaw/database", () => ({ prisma: {} }));
vi.mock("../src/modules/integrations/google/google.service", () => ({ GoogleService: class {} }));
vi.mock("../src/modules/webhooks/webhooks.service", () => ({ WebhooksService: class {} }));

import { digestSlot } from "../src/modules/channels/assistant/email-watcher.service";

// Fortaleza é UTC-3 (sem horário de verão): 11:00Z = 08:00 local
const utc = (iso: string) => Date.parse(iso);

describe("digestSlot (resumo de e-mails às 8h, 12h, 16h e 22h, horário de Fortaleza)", () => {
  it("vira no horário exato", () => {
    expect(digestSlot(utc("2026-10-24T11:00:00Z"))).toBe("2026-10-24-8");
    expect(digestSlot(utc("2026-10-24T15:00:00Z"))).toBe("2026-10-24-12");
    expect(digestSlot(utc("2026-10-24T19:00:00Z"))).toBe("2026-10-24-16");
    expect(digestSlot(utc("2026-10-24T01:00:00Z"))).toBe("2026-10-23-22");
  });

  it("entre os horários fica no último que já passou", () => {
    expect(digestSlot(utc("2026-10-24T14:59:00Z"))).toBe("2026-10-24-8");
    expect(digestSlot(utc("2026-10-25T00:59:00Z"))).toBe("2026-10-24-16");
    expect(digestSlot(utc("2026-10-25T01:00:00Z"))).toBe("2026-10-24-22");
  });

  it("antes das 8h o último resumo foi o das 22h de ontem", () => {
    expect(digestSlot(utc("2026-10-24T10:59:00Z"))).toBe("2026-10-23-22");
  });
});
