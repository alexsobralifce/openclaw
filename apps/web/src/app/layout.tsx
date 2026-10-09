import type { Metadata, Viewport } from "next";
import "./globals.css";

// Endereço público do site (defina NEXT_PUBLIC_SITE_URL no build). Sem ele, a imagem de compartilhamento fica de fora
// em vez de sair com um endereço errado.
const site = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: site ? new URL(site) : undefined,
  applicationName: "MagoBox",
  title: { default: "MagoBox: secretária virtual para e-mail, agenda e senhas", template: "%s | MagoBox" },
  description: "Secretária particular no app ou no WhatsApp: organiza documentos, notas, senhas e compromissos e responde e-mails e cria eventos por voz. 7 dias grátis.",
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, title: "MagoBox", statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    siteName: "MagoBox",
    locale: "pt_BR",
    url: "/",
    title: "MagoBox: secretária virtual para e-mail, agenda e senhas",
    description: "Documentos, notas, senhas e compromissos organizados. Responda e-mails e crie eventos por voz, no app ou no WhatsApp.",
    ...(site ? { images: [{ url: "/brand/magobox-og.png", width: 1200, height: 630, alt: "MagoBox" }] } : {}),
  },
  twitter: { card: "summary_large_image", title: "MagoBox: secretária virtual para e-mail, agenda e senhas", description: "Sua secretária particular no app ou no WhatsApp. 7 dias grátis." },
};

export const viewport: Viewport = {
  themeColor: "#2E1065",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script defer src="https://umami-production-8dd4.up.railway.app/script.js" data-website-id="a48228a8-709f-483a-bfbf-672c8e16b099" />
        {/* Tema do aparelho (claro/escuro) aplicado antes da primeira pintura; só vale no painel (ver ThemeSync) */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(matchMedia('(prefers-color-scheme: light)').matches&&location.pathname.indexOf('/dashboard')===0)document.documentElement.classList.add('light')}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
