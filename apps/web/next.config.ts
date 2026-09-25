import type { NextConfig } from "next";

// Cabeçalhos de segurança básicos. Sem CSP por enquanto: o Next injeta scripts inline e uma política
// mal ajustada quebraria o painel.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@openclaw/types"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
