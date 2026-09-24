import { lookup } from "dns/promises";
import { isIP } from "net";

const PRIVATE = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivate(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  return PRIVATE.some((r) => r.test(ip));
}

/** Bloqueia URLs que apontam para a rede interna (SSRF). Lança Error com o motivo. */
export async function assertPublicUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("URL inválida"); }
  const dev = process.env.NODE_ENV !== "production";
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) throw new Error("Use uma URL https");
  if (u.username || u.password) throw new Error("URL não pode conter credenciais");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (dev && (host === "localhost" || host === "127.0.0.1")) return;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("Não foi possível resolver o endereço");
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("A URL aponta para um endereço interno");
}
