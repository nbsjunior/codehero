"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

export interface CockpitNavItem {
  id: string;
  label: string;
  hint?: string;
  /** When set, navigates instead of selecting a tab. */
  href?: string;
  external?: boolean;
}

export interface CockpitNavGroup {
  id: string;
  label: string;
  items: CockpitNavItem[];
}

/**
 * Única navegação do painel — grupos + links (Docs / Estimativa) + rodapé
 * com usuário. Substitui o menu lateral duplicado do AppShell em /admin.
 */
export default function AdminCockpitShell({
  groups,
  tab,
  onSelectTab,
  children,
}: {
  groups: CockpitNavGroup[];
  tab: string;
  onSelectTab: (id: string) => void;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const flatItems = groups.flatMap((g) => g.items);
  const current = flatItems.find((i) => i.id === tab) ?? flatItems.find((i) => !i.href) ?? flatItems[0];
  const currentGroup = groups.find((g) => g.items.some((i) => i.id === tab)) ?? groups[0];

  useEffect(() => {
    setNavOpen(false);
  }, [tab]);

  function selectTab(id: string) {
    onSelectTab(id);
    setNavOpen(false);
  }

  function renderItem(item: CockpitNavItem) {
    if (item.href) {
      if (item.external) {
        return (
          <a
            key={item.id}
            href={item.href}
            className="hero-cockpit-nav__btn"
            target="_blank"
            rel="noreferrer"
            onClick={() => setNavOpen(false)}
          >
            {item.label}
          </a>
        );
      }
      return (
        <Link
          key={item.id}
          href={item.href}
          className="hero-cockpit-nav__btn"
          onClick={() => setNavOpen(false)}
        >
          {item.label}
        </Link>
      );
    }
    return (
      <button
        key={item.id}
        type="button"
        className={`hero-cockpit-nav__btn${tab === item.id ? " is-active" : ""}`}
        onClick={() => selectTab(item.id)}
        aria-current={tab === item.id ? "page" : undefined}
      >
        {item.label}
      </button>
    );
  }

  return (
    <div className={`hero-cockpit${navOpen ? " hero-cockpit--nav-open" : ""}`}>
      <aside className="hero-cockpit-sidebar" aria-label="Navegação do painel">
        <Link href="/admin/#instalacao" className="hero-sidebar-brand" onClick={() => setNavOpen(false)} style={{ marginBottom: "1rem" }}>
          <span className="hero-burst">⚡</span>
          <span className="hero-display">CodeHero</span>
        </Link>

        <nav className="hero-cockpit-nav">
          {groups.map((group) => (
            <div key={group.id} className="hero-cockpit-nav-group">
              <p className="hero-cockpit-nav-group__label">{group.label}</p>
              <ul className="hero-cockpit-nav-group__list">
                {group.items.map((item) => (
                  <li key={item.id}>{renderItem(item)}</li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="hero-sidebar-spacer" />

        <div className="hero-sidebar-footer" style={{ padding: "0.75rem 0 0" }}>
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

      {navOpen && (
        <button type="button" className="hero-cockpit-backdrop" aria-label="Fechar menu" onClick={() => setNavOpen(false)} />
      )}

      <div className="hero-cockpit-workspace">
        <div className="hero-cockpit-topbar">
          <button
            type="button"
            className="hero-btn hero-btn-outline hero-cockpit-topbar__menu"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
          >
            ☰ Menu
          </button>
          <span className="hero-cockpit-topbar__crumb">
            {currentGroup?.label}
            <span aria-hidden="true"> / </span>
            {current?.label}
          </span>
        </div>

        <div className="hero-cockpit-main">{children}</div>
      </div>
    </div>
  );
}
