import { describe, expect, it, vi } from "vitest";
import { cookieOptions, csrfOriginCheck, readCookie, socketToken, tokenFromCookie } from "../src/modules/auth/session-cookie";

const env = { WEB_URL: "https://app.magobox.com.br", WEB_ORIGINS: "https://www.magobox.com.br" } as NodeJS.ProcessEnv;

function run(req: any) {
  const res: any = { status: vi.fn(() => res), json: vi.fn() };
  const next = vi.fn();
  csrfOriginCheck(env)(req, res, next);
  return { next, res };
}

describe("cookie de sessão", () => {
  it("lê o cookie certo no meio de outros", () => {
    expect(readCookie("a=1; oc_session=abc%2E123; b=2", "oc_session")).toBe("abc.123");
    expect(readCookie("xoc_session=zzz", "oc_session")).toBeNull();
    expect(readCookie(undefined, "oc_session")).toBeNull();
    expect(tokenFromCookie({ headers: { cookie: "oc_session=t" } } as any)).toBe("t");
  });

  it("HttpOnly sempre; Secure em produção; domínio opcional; SameSite=none só por opção", () => {
    expect(cookieOptions({ NODE_ENV: "development" } as any)).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax" });
    expect(cookieOptions({ NODE_ENV: "production", COOKIE_DOMAIN: ".magobox.com.br" } as any)).toMatchObject({ secure: true, domain: ".magobox.com.br" });
    expect(cookieOptions({ SESSION_SAMESITE: "none" } as any)).toMatchObject({ sameSite: "none", secure: true });
  });
});

describe("CSRF por Origin (sessão em cookie)", () => {
  const cookie = "oc_session=t";
  it("POST com cookie e Origin do painel passa", () => {
    expect(run({ method: "POST", headers: { cookie, origin: "https://app.magobox.com.br" } }).next).toHaveBeenCalled();
    expect(run({ method: "DELETE", headers: { cookie, origin: "https://www.magobox.com.br/" } }).next).toHaveBeenCalled();
  });
  it("POST com cookie e Origin de outro site, ou sem Origin, é barrado", () => {
    const a = run({ method: "POST", headers: { cookie, origin: "https://evil.example" } });
    expect(a.next).not.toHaveBeenCalled();
    expect(a.res.status).toHaveBeenCalledWith(403);
    expect(run({ method: "PATCH", headers: { cookie } }).next).not.toHaveBeenCalled();
  });
  it("leitura, Bearer ou pedido sem cookie não são afetados", () => {
    expect(run({ method: "GET", headers: { cookie, origin: "https://evil.example" } }).next).toHaveBeenCalled();
    expect(run({ method: "POST", headers: { cookie, authorization: "Bearer x" } }).next).toHaveBeenCalled();
    expect(run({ method: "POST", headers: { origin: "https://evil.example" } }).next).toHaveBeenCalled();
  });
});

describe("websocket", () => {
  it("auth.token vale; cookie só vindo de um site do painel", () => {
    expect(socketToken({ auth: { token: "k" }, headers: {} }, env)).toBe("k");
    expect(socketToken({ auth: {}, headers: { cookie: "oc_session=t", origin: "https://app.magobox.com.br" } }, env)).toBe("t");
    expect(socketToken({ auth: {}, headers: { cookie: "oc_session=t", origin: "https://evil.example" } }, env)).toBeNull();
    expect(socketToken({ auth: {}, headers: { cookie: "oc_session=t" } }, env)).toBeNull();
  });
});
