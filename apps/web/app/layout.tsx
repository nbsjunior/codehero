import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "CodeHero — Painel do Herói",
  description: "Análise estática de código que evolui — sem IA no caminho de cada arquivo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
