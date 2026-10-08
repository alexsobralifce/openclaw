import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.magobox.com.br").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  // lastmod é a data da última mudança real do conteúdo da página: atualizar aqui ao editar a página
  const pages: [string, number, string][] = [["/", 1, "2026-10-08"], ["/privacidade", 0.3, "2026-10-04"], ["/termos", 0.3, "2026-10-04"], ["/exclusao-de-dados", 0.2, "2026-10-04"]];
  return pages.map(([path, priority, lastModified]) => ({ url: `${SITE}${path === "/" ? "" : path}`, lastModified, changeFrequency: "monthly", priority }));
}
