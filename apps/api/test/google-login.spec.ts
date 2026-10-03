import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const users: any[] = [];
vi.mock("@openclaw/database", () => ({ prisma: { user: { findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null } } }));

import { AuthService } from "../src/modules/auth/auth.service";
import { GoogleService } from "../src/modules/integrations/google/google.service";

const store = new Map<string, any>();
const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
const jwt = { sign: () => "jwt-fake" };

describe("ticket do login com Google", () => {
  beforeEach(() => {
    store.clear();
    users.length = 0;
  });

  it("troca o ticket pela sessão uma única vez", async () => {
    users.push({ id: "u1", status: "ACTIVE", email: "a@a.com", name: "A", role: "USER", services: [], workspaces: [] });
    store.set("glogin:abc", { userId: "u1" });
    const auth = new AuthService(jwt as any, state as any);
    expect((await auth.loginWithGoogleTicket("abc")).accessToken).toBe("jwt-fake");
    await expect(auth.loginWithGoogleTicket("abc")).rejects.toThrow("expirado");
  });

  it("recusa ticket inexistente e conta que deixou de estar ativa", async () => {
    const auth = new AuthService(jwt as any, state as any);
    await expect(auth.loginWithGoogleTicket("nada")).rejects.toThrow();
    users.push({ id: "u2", status: "DISABLED", workspaces: [] });
    store.set("glogin:x", { userId: "u2" });
    await expect(auth.loginWithGoogleTicket("x")).rejects.toThrow();
  });
});

describe("identidade do Google", () => {
  const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const mockToken = (claims: object) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: idToken(claims) }) })));
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("devolve e-mail em minúsculas e se foi verificado", async () => {
    mockToken({ aud: "cid", iss: "https://accounts.google.com", email: "Ana@Gmail.com", email_verified: true });
    expect(await new GoogleService().loginIdentity("c")).toEqual({ email: "ana@gmail.com", verified: true });
    mockToken({ aud: "cid", iss: "accounts.google.com", email: "b@gmail.com" });
    expect((await new GoogleService().loginIdentity("c")).verified).toBe(false);
  });

  it("recusa token de outro app", async () => {
    mockToken({ aud: "outro", iss: "https://accounts.google.com", email: "x@gmail.com", email_verified: true });
    await expect(new GoogleService().loginIdentity("c")).rejects.toThrow("inválido");
  });

  it("a URL de login pede só identidade", () => {
    const url = new GoogleService().loginUrl("st");
    expect(new URL(url).searchParams.get("scope")).toBe("openid email profile");
    expect(url).not.toContain("gmail.modify");
  });
});
