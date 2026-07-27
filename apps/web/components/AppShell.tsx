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
  external?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/admin/", label: "Admin", icon: "▲", adminOnly: true },
  { href: "/docs/", label: "Docs", icon: "▤" },
  { href: "https://produtech.web.app", label: "Estimativa Build", icon: "▣", external: true },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("hero-nav-lock");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("hero-nav-lock");
    };
  }, [navOpen]);

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  function renderNav(onNavigate?: () => void) {
    return items.map((item) => {
      const active =
        !item.external &&
        (pathname === item.href ||
          pathname === item.href.replace(/\/$/, "") ||
          (item.href !== "/" && pathname?.startsWith(item.href.replace(/\/$/, ""))));
      const className = `hero-sidebar-link${active ? " is-active" : ""}`;
      const content = (
        <>
          <span aria-hidden>{item.icon}</span>
          {item.label}
          {item.adminOnly && (
            <span className="hero-badge" style={{ marginLeft: "auto", fontSize: "0.6rem" }}>
              Admin
            </span>
          )}
        </>
      );
      if (item.external) {
        return (
          <a
            key={item.href}
            href={item.href}
            className={className}
            target="_blank"
            rel="noreferrer"
            onClick={onNavigate}
          >
            {content}
          </a>
        );
      }
      return (
        <Link key={item.href} href={item.href} className={className} onClick={onNavigate}>
          {content}
        </Link>
      );
    });
  }

  return (
    <div className="hero-app-shell">
      <header className="hero-mobile-bar">
        <Link href="/" className="hero-sidebar-brand" onClick={() => setNavOpen(false)}>
          <span className="hero-burst">⚡</span>
          <span className="hero-display">CodeHero</span>
        </Link>
        <button
          type="button"
          className="hero-mobile-toggle"
          aria-expanded={navOpen}
          aria-controls="hero-mobile-drawer"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span className="cr-sr-only">Menu</span>
          <span aria-hidden>{navOpen ? "✕" : "☰"}</span>
        </button>
      </header>

      {navOpen ? (
        <button
          type="button"
          className="hero-mobile-backdrop"
          aria-label="Fechar menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside id="hero-mobile-drawer" className={`hero-sidebar${navOpen ? " is-open" : ""}`}>
        <Link href="/" className="hero-sidebar-brand hero-sidebar-brand-desktop" onClick={() => setNavOpen(false)}>
          <span className="hero-burst">⚡</span>
          <span className="hero-display">CodeHero</span>
        </Link>

        <p className="hero-sidebar-kicker">Plataforma</p>
        <nav className="hero-sidebar-nav">{renderNav(() => setNavOpen(false))}</nav>

        <div className="hero-sidebar-spacer" />

        <div className="hero-sidebar-footer">
          <p
            className="hero-caption"
            style={{ margin: "0 0 0.6rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={user?.email ?? undefined}
          >
            {user?.displayName ?? user?.email}
          </p>
          <button
            type="button"
            className="hero-btn hero-btn-outline hero-btn-block"
            onClick={() => {
              setNavOpen(false);
              void signOut(auth);
            }}
          >
            Sair
          </button>
        </div>
      </aside>

      <div className="hero-main">{children}</div>

      <nav className="hero-bottom-nav" aria-label="Navegação principal">
        {items
          .filter((i) => !i.external)
          .slice(0, 4)
          .map((item) => {
            const active =
              pathname === item.href ||
              pathname === item.href.replace(/\/$/, "") ||
              (item.href !== "/" && pathname?.startsWith(item.href.replace(/\/$/, "")));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`hero-bottom-link${active ? " is-active" : ""}`}
              >
                <span aria-hidden>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
      </nav>
    </div>
  );
}
