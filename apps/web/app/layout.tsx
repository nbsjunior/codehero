import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "CodeHero — Seja o herói do PR",
  description:
    "Corte bugs e dívida técnica pela metade. Dress code em português, IA que propõe regras e scanner determinístico que aplica — gratuito para o time.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
