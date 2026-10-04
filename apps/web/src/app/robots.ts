import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.magobox.com.br").replace(/\/$/, "");

// O Google pode ler a página inicial e as páginas legais; o painel e o login são de uso interno.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/auth/"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
