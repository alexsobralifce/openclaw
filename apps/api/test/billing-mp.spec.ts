import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { nextPlanUntil, parseReference, PERIOD_DAYS, verifyMpSignature } from "../src/modules/billing/mp-utils";
import { planExpired } from "../src/modules/auth/plans";

const sign = (secret: string, id: string, reqId: string, ts: string) => createHmac("sha256", secret).update(`id:${id};request-id:${reqId};ts:${ts};`).digest("hex");

describe("assinatura do aviso do Mercado Pago", () => {
  it("aceita a assinatura correta e rejeita adulteração ou ausência", () => {
    const v1 = sign("segredo", "123", "req-1", "1700000000");
    const base = { secret: "segredo", requestId: "req-1", dataId: "123", signature: `ts=1700000000,v1=${v1}` };
    expect(verifyMpSignature(base)).toBe(true);
    expect(verifyMpSignature({ ...base, dataId: "124" })).toBe(false);
    expect(verifyMpSignature({ ...base, secret: "outro" })).toBe(false);
    expect(verifyMpSignature({ ...base, secret: "" })).toBe(false);
    expect(verifyMpSignature({ ...base, signature: undefined })).toBe(false);
  });
});

describe("referência e vencimento", () => {
  it("separa usuário e plano", () => {
    expect(parseReference("abc:mago")).toEqual({ userId: "abc", planId: "mago" });
    expect(parseReference("sem-dois-pontos")).toBeNull();
  });

  it("soma o período a partir do que resta, sem perder dias ao renovar cedo", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const day = 24 * 3600 * 1000;
    expect(nextPlanUntil(null, now).getTime() - now.getTime()).toBe(PERIOD_DAYS * day);
    expect(nextPlanUntil(new Date(now.getTime() + 10 * day), now).getTime() - now.getTime()).toBe((10 + PERIOD_DAYS) * day);
    expect(nextPlanUntil(new Date(now.getTime() - 5 * day), now).getTime() - now.getTime()).toBe(PERIOD_DAYS * day);
  });

  it("só pausa usuário comum com plano e vencimento passado", () => {
    const past = new Date("2026-01-01");
    const now = new Date("2026-10-10");
    expect(planExpired({ role: "USER", plan: "mago", planUntil: past }, now)).toBe(true);
    expect(planExpired({ role: "USER", plan: "mago", planUntil: null }, now)).toBe(false);
    expect(planExpired({ role: "USER", plan: null, planUntil: past }, now)).toBe(false);
    expect(planExpired({ role: "ADMIN", plan: "mago", planUntil: past }, now)).toBe(false);
    // cadastro novo: bloqueado até ter plano (assinado ou dado pelo admin); admin/root e quem já tem plano passam
    expect(planExpired({ role: "USER", plan: null, planRequired: true }, now)).toBe(true);
    expect(planExpired({ role: "USER", plan: "teste", planUntil: new Date("2026-10-17"), planRequired: true }, now)).toBe(false);
    expect(planExpired({ role: "ADMIN", plan: null, planRequired: true }, now)).toBe(false);  });
});
