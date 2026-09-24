import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Openclaw",
  description: "Plataforma de atendimento multi-canal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
