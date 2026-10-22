import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { GoogleService } from "../src/modules/integrations/google/google.service";

function build() {
  const g = vi.fn(async () => ({ id: "e1", htmlLink: "https://cal/e1" }));
  const svc = Object.create(GoogleService.prototype) as any;
  svc.g = g;
  return { svc: svc as GoogleService, g };
}

describe("calendarCreate", () => {
  it("evento com hora usa dateTime", async () => {
    const { svc, g } = build();
    await svc.calendarCreate("w", { title: "Reunião", start: "2026-10-01T14:00:00-03:00", end: "2026-10-01T15:00:00-03:00" });
    const body = JSON.parse((g.mock.calls[0] as any)[3].body);
    expect(body.start).toEqual({ dateTime: "2026-10-01T14:00:00-03:00", timeZone: "America/Fortaleza" });
    expect(body.end.dateTime).toBe("2026-10-01T15:00:00-03:00");
  });

  it("evento sem hora vira dia inteiro, com fim no dia seguinte", async () => {
    const { svc, g } = build();
    await svc.calendarCreate("w", { title: "Prazo", start: "2026-10-31", end: "2026-10-31" });
    const body = JSON.parse((g.mock.calls[0] as any)[3].body);
    expect(body.start).toEqual({ date: "2026-10-31" });
    expect(body.end).toEqual({ date: "2026-11-01" });
  });
});
