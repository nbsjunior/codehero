import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./landing-comic.css";

export const metadata: Metadata = {
  title: "CodeHero · Análise de código que decide sempre igual",
  description:
    "Junta o que as suas ferramentas de análise já encontram, tira o que está repetido e decide o que segura o merge. Lê COBOL e DB2 como uma coisa só, que é como eles quebram.",
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
    { media: "(prefers-color-scheme: light)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: dark)", color: "#070707" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
