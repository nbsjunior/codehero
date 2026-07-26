import type { ReactNode } from "react";

export const metadata = {
  title: "CodeHero — Dashboard",
  description: "AI-optimized static analysis & remediation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0b1120",
          color: "#e5e7eb",
        }}
      >
        {children}
      </body>
    </html>
  );
}
