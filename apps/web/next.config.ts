import type { NextConfig } from "next";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * Content-Security-Policy. O Next e o script do tema injetam scripts inline, então `script-src` precisa de 'unsafe-inline'
 * (um nonce por pedido exigiria renderização dinâmica em todas as páginas). Mesmo assim a política barra o que mais importa
 * depois de um XSS: carregar script de outro site, mandar dados para um servidor de terceiros (`connect-src` só aceita o próprio
 * site e a API), embutir o painel em outro site e trocar o destino de formulários.
 */
const UMAMI = "https://umami-production-8dd4.up.railway.app";
const MP_SCRIPT = "https://sdk.mercadopago.com https://http2.mlstatic.com";
const MP_CONNECT = "https://api.mercadopago.com https://*.mercadopago.com https://*.mercadolibre.com https://api.mercadolibre.com https://http2.mlstatic.com";
const MP_FRAME = "https://*.mercadopago.com https://*.mercadolibre.com";

/**
 * `payments`: só a tela de Assinatura (Configurações) libera o script e o formulário de cartão do Mercado Pago,
 * que precisam rodar dentro da página. Todo o resto do painel (cofre, chat) segue com a política fechada.
 */
export function contentSecurityPolicy(api: string = API, dev = process.env.NODE_ENV !== "production", payments = false): string {
  const origin = new URL(api).origin;
  const ws = origin.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${UMAMI}${dev ? " 'unsafe-eval'" : ""}${payments ? ` ${MP_SCRIPT}` : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    `connect-src 'self' ${origin} ${ws} ${UMAMI}${dev ? " ws://localhost:*" : ""}${payments ? ` ${MP_CONNECT}` : ""}`,
    ...(payments ? [`frame-src ${MP_FRAME}`] : []),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Cabeçalhos de segurança do painel.
const otherHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
];
const securityHeaders = [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }, ...otherHeaders];
const paymentHeaders = [{ key: "Content-Security-Policy", value: contentSecurityPolicy(API, process.env.NODE_ENV !== "production", true) }, ...otherHeaders];

const nextConfig: NextConfig = {
  // Pasta de build separada (usada pelo script de prints do tour, para não mexer no `next dev` em uso)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@openclaw/types"],
  poweredByHeader: false,
  async headers() {
    return [
      // Um cabeçalho de política por rota: se as duas regras valessem juntas, valeria a mais fechada
      { source: "/((?!dashboard/settings).*)", headers: securityHeaders },
      { source: "/dashboard/settings", headers: paymentHeaders },
      // O navegador precisa checar o service worker a cada visita para pegar versões novas
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, max-age=0" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
    ];
  },
};

export default nextConfig;
