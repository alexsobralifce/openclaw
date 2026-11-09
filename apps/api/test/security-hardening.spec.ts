import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bcrypt from "bcryptjs";

const db = vi.hoisted(() => ({
  users: [] as any[],
  channels: [] as any[],
}));

vi.mock("@magobox/database", () => ({
  prisma: {
    user: {
      count: async (a?: any) => db.users.filter((u) => !a?.where?.status || u.status === a.where.status).length,
      findFirst: async (a: any) => {
        const eq = a.where.email?.equals?.toLowerCase();
        return db.users.find((u) => u.email.toLowerCase() === eq) ?? null;
      },
    },
    channel: { findMany: async () => db.channels },
  },
}));

import { AuthService } from "../src/modules/auth/auth.service";
import { RateLimitGuard, RateLimit } from "../src/modules/auth/rate-limit";
import { ChannelsService } from "../src/modules/channels/channels.service";
import { isSealed, openToken, sealToken } from "../src/modules/webhooks/crypto";

function fakeState() {
  const m = new Map<string, any>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: any) => void m.set(k, v),
    del: async (k: string) => void m.delete(k),
    incr: async (k: string) => {
      m.set(k, (m.get(k) ?? 0) + 1);
      return m.get(k);
    },
  };
}

describe("tokens do Google cifrados", () => {
  it("cifra, decifra e não deixa o texto original à vista", () => {
    const sealed = sealToken("1//refresh-token-secreto");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("refresh-token-secreto");
    expect(openToken(sealed)).toBe("1//refresh-token-secreto");
  });

  it("valor antigo, em texto puro, continua funcionando até migrar", () => {
    expect(isSealed("1//antigo")).toBe(false);
    expect(openToken("1//antigo")).toBe("1//antigo");
  });

  it("cada cifragem é diferente e adulteração é detectada", () => {
    expect(sealToken("x")).not.toBe(sealToken("x"));
    const s = sealToken("segredo");
    const tampered = s.slice(0, -3) + (s.endsWith("AAA") ? "BBB" : "AAA");
    expect(() => openToken(tampered)).toThrow();
  });
});

describe("listagem de canais não vaza segredos", () => {
  it("devolve só campos seguros", async () => {
    db.channels = [
      { id: "c1", name: "Google (a@x.com)", type: "EMAIL", isActive: true, createdAt: new Date(), workspaceId: "w", config: { provider: "google", email: "a@x.com", refreshToken: "enc1:SEGREDO", lastSeenMs: 1 } },
      { id: "c2", name: "WA", type: "WHATSAPP", isActive: true, createdAt: new Date(), workspaceId: "w", config: { instanceName: "oc_1", webhookUrl: "http://x", evolutionData: { hash: { apikey: "CHAVE-DA-INSTANCIA" } } } },
    ];
    const out = await new ChannelsService().listChannels("w");
    const json = JSON.stringify(out);
    expect(json).not.toContain("SEGREDO");
    expect(json).not.toContain("CHAVE-DA-INSTANCIA");
    expect(json).not.toContain("refreshToken");
    expect(out[0].config).toEqual({ provider: "google", email: "a@x.com" });
    expect(out[1].config).toEqual({ instanceName: "oc_1" });
  });
});

describe("login: força bruta", () => {
  let auth: AuthService;
  const jwt: any = { sign: () => "tok" };

  beforeEach(() => {
    db.users = [{ id: "u1", email: "Ana@X.com", name: "Ana", passwordHash: bcrypt.hashSync("senha-correta-1", 4), status: "ACTIVE", role: "USER", services: [], workspaces: [] }];
    auth = new AuthService(jwt, fakeState() as any);
  });

  it("bloqueia a conta depois de 8 erros, mesmo com a senha certa depois", async () => {
    for (let i = 0; i < 8; i++) await expect(auth.login("ana@x.com", "errada")).rejects.toMatchObject({ status: 401 });
    await expect(auth.login("ana@x.com", "senha-correta-1")).rejects.toMatchObject({ status: 429 });
  });

  it("e-mail inexistente também conta e responde igual a senha errada", async () => {
    const a = await auth.login("nao@existe.com", "x").catch((e) => e);
    const b = await auth.login("ana@x.com", "errada").catch((e) => e);
    expect(a.status).toBe(401);
    expect(a.message).toBe(b.message);
  });

  it("login certo zera o contador e ignora maiúsculas no e-mail", async () => {
    for (let i = 0; i < 5; i++) await auth.login("ana@x.com", "errada").catch(() => {});
    const ok: any = await auth.login("ANA@x.com", "senha-correta-1");
    expect(ok.accessToken).toBe("tok");
    for (let i = 0; i < 5; i++) await expect(auth.login("ana@x.com", "errada")).rejects.toMatchObject({ status: 401 });
  });
});

describe("cadastro público", () => {
  it("recusa e-mail repetido com outra caixa", async () => {
    db.users = [{ id: "r", email: "Root@x.com", status: "ACTIVE" }];
    const auth = new AuthService({ sign: () => "t" } as any, fakeState() as any);
    await expect(auth.register("root@x.com", "R", "12345678", "W")).rejects.toMatchObject({ status: 409 });
  });
});

describe("RateLimitGuard", () => {
  class Ctrl {
    @RateLimit("t", 3, 60) route() {}
    free() {}
  }
  const ctx = (handler: any, ip = "1.1.1.1") => ({
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ ip }), getResponse: () => ({ setHeader: () => {} }) }),
  }) as any;

  it("libera até o limite e barra depois, por IP", async () => {
    const { Reflector } = await import("@nestjs/core");
    const guard = new RateLimitGuard(new Reflector(), fakeState() as any);
    const h = Ctrl.prototype.route;
    for (let i = 0; i < 3; i++) expect(await guard.canActivate(ctx(h))).toBe(true);
    await expect(guard.canActivate(ctx(h))).rejects.toMatchObject({ status: 429 });
    expect(await guard.canActivate(ctx(h, "2.2.2.2"))).toBe(true);
    expect(await guard.canActivate(ctx(Ctrl.prototype.free))).toBe(true);
  });
});
