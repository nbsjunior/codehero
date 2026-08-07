import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./admin-cockpit.css";

export const metadata: Metadata = {
  title: "Painel",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
