import type { MetadataRoute } from "next";

// Faz o MagoBox instalável no celular (Adicionar à tela inicial), com nome e ícone próprios.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MagoBox — sua secretária virtual",
    short_name: "MagoBox",
    description: "Sua secretária virtual: e-mail, agenda, Drive, senhas e clientes, no WhatsApp e no app.",
    lang: "pt-BR",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#030712",
    theme_color: "#6D28D9",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
