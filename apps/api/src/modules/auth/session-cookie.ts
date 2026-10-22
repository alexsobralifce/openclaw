import type { CookieOptions, NextFunction, Request, Response } from "express";
import { webOrigins } from "../../web-origins";

/** Cookie da sessão: HttpOnly, então nenhum script da página (nem um XSS) consegue ler o token. */
export const SESSION_COOKIE = "oc_session";
export const SESSION_DAYS = 180; // igual à validade do JWT; a sessão é renovada com o uso (ver SessionRenewInterceptor)
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Atributos do cookie. `COOKIE_DOMAIN` (ex.: `.magobox.com.br`) vale para app. e api. juntos; sem ele o cookie é só do host da API.
 * `SESSION_SAMESITE=none` só para painel e API em sites diferentes (ex.: endereços do Railway): exige HTTPS, e a defesa
 * contra CSRF passa a ser a checagem de Origin abaixo.
 */
export function cookieOptions(env: NodeJS.ProcessEnv = process.env): CookieOptions {
  const sameSite = env.SESSION_SAMESITE === "none" ? "none" : "lax";
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    path: "/",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MS });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Extrator do passport-jwt: lê o cookie da sessão (o cabeçalho Bearer continua valendo para clientes que não são o painel). */
export const tokenFromCookie = (req: Request): string | null => readCookie(req.headers?.cookie, SESSION_COOKIE);

const originAllowed = (origin: string | undefined, env?: NodeJS.ProcessEnv) => !!origin && webOrigins(env).includes(origin.replace(/\/+$/, ""));

/**
 * Defesa contra CSRF para quem se autentica pelo cookie: pedido que altera dados (POST, PUT, PATCH, DELETE) só passa se o
 * `Origin` for um site do painel. Com `Authorization: Bearer` ou sem cookie de sessão, nada muda (o navegador não anexa isso sozinho).
 */
export function csrfOriginCheck(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || req.headers.authorization || !readCookie(req.headers.cookie, SESSION_COOKIE)) return next();
    if (originAllowed(req.headers.origin as string | undefined, env)) return next();
    res.status(403).json({ statusCode: 403, message: "Origem não autorizada." });
  };
}

/** Token do handshake do websocket: `auth.token` (clientes de API) ou o cookie, que só vale vindo de um site do painel. */
export function socketToken(handshake: { auth?: any; headers: Record<string, any> }, env?: NodeJS.ProcessEnv): string | null {
  const explicit = handshake.auth?.token;
  if (typeof explicit === "string" && explicit) return explicit;
  const fromCookie = readCookie(handshake.headers?.cookie, SESSION_COOKIE);
  return fromCookie && originAllowed(handshake.headers?.origin, env) ? fromCookie : null;
}
