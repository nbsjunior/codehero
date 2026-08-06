import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeHero — Gate de engenharia com esteira que aprende",
  description:
    "Unifique SAST, SCA, secrets, IaC e mainframe num contrato de gate. IA pós-política, falso positivo como dado de produto — controle executivo para o CTO.",
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
