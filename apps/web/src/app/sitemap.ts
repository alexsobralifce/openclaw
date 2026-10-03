import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.magobox.com.br").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [["/", 1], ["/privacidade", 0.3], ["/termos", 0.3], ["/exclusao-de-dados", 0.2]];
  return pages.map(([path, priority]) => ({ url: `${SITE}${path === "/" ? "" : path}`, changeFrequency: "monthly", priority }));
}
