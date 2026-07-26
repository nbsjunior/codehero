"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";
import { checkPlatformAdmin } from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/admin", label: "Admin", icon: "▲", adminOnly: true },
  { href: "/docs", label: "Docs", icon: "▤" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    checkPlatformAdmin()
      .then((v) => {
        if (!cancelled) setIsAdmin(v);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="hero-app-shell">
      <aside className="hero-sidebar">
        <Link href="/" className="hero-sidebar-brand">
          <span className="hero-burst">⚡</span>
          <span className="hero-display">CodeHero</span>
        </Link>

        <p className="hero-sidebar-kicker">Plataforma</p>
        <nav className="hero-sidebar-nav">
          {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`hero-sidebar-link${active ? " is-active" : ""}`}>
                <span aria-hidden>{item.icon}</span>
                {item.label}
                {item.adminOnly && (
                  <span className="hero-badge" style={{ marginLeft: "auto", fontSize: "0.6rem" }}>
                    Admin
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="hero-sidebar-spacer" />

        <div className="hero-sidebar-footer">
          <p
            className="hero-caption"
            style={{ margin: "0 0 0.6rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={user?.email ?? undefined}
          >
            {user?.displayName ?? user?.email}
          </p>
          <button type="button" className="hero-btn hero-btn-outline hero-btn-block" onClick={() => signOut(auth)}>
            Sair
          </button>
        </div>
      </aside>

      <div className="hero-main">{children}</div>
    </div>
  );
}
