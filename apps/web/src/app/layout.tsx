import type { Metadata, Viewport } from "next";
import "./globals.css";

// Endereço público do site (defina NEXT_PUBLIC_SITE_URL no build). Sem ele, a imagem de compartilhamento fica de fora
// em vez de sair com um endereço errado.
const site = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: site ? new URL(site) : undefined,
  applicationName: "MagoBox",
  title: { default: "MagoBox — sua secretária virtual no WhatsApp", template: "%s | MagoBox" },
  description: "Sua secretária virtual: e-mail, agenda, Drive, senhas e clientes, no WhatsApp e no app. Por texto, áudio, foto ou link.",
  appleWebApp: { capable: true, title: "MagoBox", statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    siteName: "MagoBox",
    locale: "pt_BR",
    title: "MagoBox — sua secretária virtual no WhatsApp",
    description: "E-mail, agenda, Drive e senhas. Por texto, áudio, foto ou link.",
    ...(site ? { images: [{ url: "/brand/magobox-og.png", width: 1200, height: 630, alt: "MagoBox" }] } : {}),
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#6D28D9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
