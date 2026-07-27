import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "CodeHero — Seja o herói do PR",
  description:
    "Regras que se atualizam sozinhas, com prova de precisão antes do CI. Mesmo resultado em todo scan — sem incoerência e sem falso positivo no quality gate.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
