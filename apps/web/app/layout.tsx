import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeHero — Seja o herói do PR",
  description:
    "Regras que se atualizam sozinhas, com prova de precisão antes do CI. Mesmo resultado em todo scan — sem incoerência e sem falso positivo no quality gate.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CodeHero",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#09080c" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
