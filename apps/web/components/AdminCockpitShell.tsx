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
  href?: string;
  external?: boolean;
}

export interface CockpitNavGroup {
  id: string;
  label: string;
  /** Agrupa visualmente: operação | portfolio | governanca | recursos */
  tier?: "operation" | "portfolio" | "governance" | "resources";
  items: CockpitNavItem[];
}

/**
 * Shell executivo do painel — sidebar preta, acento vermelho, menus segregados.
 */
export default function AdminCockpitShell({
  groups,
  tab,
  onSelectTab,
  isPlatformAdmin = false,
  children,
}: {
  groups: CockpitNavGroup[];
  tab: string;
  onSelectTab: (id: string) => void;
  isPlatformAdmin?: boolean;
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
            className="ex-nav__link"
            target="_blank"
            rel="noreferrer"
            onClick={() => setNavOpen(false)}
          >
            <span>{item.label}</span>
            <span className="ex-nav__ext" aria-hidden>
              ↗
            </span>
          </a>
        );
      }
      return (
        <Link key={item.id} href={item.href} className="ex-nav__link" onClick={() => setNavOpen(false)}>
          {item.label}
        </Link>
      );
    }
    return (
      <button
        key={item.id}
        type="button"
        className={`ex-nav__link${tab === item.id ? " is-active" : ""}`}
        onClick={() => selectTab(item.id)}
        aria-current={tab === item.id ? "page" : undefined}
      >
        {item.label}
      </button>
    );
  }

  const useTiers = groups.some((g) => g.tier);
  const tiers: { id: NonNullable<CockpitNavGroup["tier"]>; label: string }[] = [
    { id: "operation", label: "Operação" },
    { id: "portfolio", label: "Portfólio" },
    { id: "governance", label: "Governança" },
    { id: "resources", label: "Recursos" },
  ];

  function renderGroup(group: CockpitNavGroup) {
    return (
      <div key={group.id} className="ex-nav__group">
        <p className="ex-nav__group-label">{group.label}</p>
        <ul className="ex-nav__list">
          {group.items.map((item) => (
            <li key={item.id}>{renderItem(item)}</li>
          ))}
        </ul>
      </div>
    );
  }

  function renderTier() {
    if (!useTiers) return groups.map(renderGroup);
    const placed = new Set<string>();
    return (
      <>
        {tiers.map((tier) => {
          const tierGroups = groups.filter((g) => g.tier === tier.id);
          if (tierGroups.length === 0) return null;
          for (const g of tierGroups) placed.add(g.id);
          return (
            <div key={tier.id} className="ex-nav__tier">
              <p className="ex-nav__tier-label">{tier.label}</p>
              {tierGroups.map(renderGroup)}
            </div>
          );
        })}
        {groups.filter((g) => !placed.has(g.id)).map(renderGroup)}
      </>
    );
  }

  return (
    <div className={`ex-cockpit${navOpen ? " ex-cockpit--nav-open" : ""}`}>
      <aside className="ex-sidebar" aria-label="Navegação do painel">
        <div className="ex-sidebar__brand-wrap">
          <Link href="/admin/#instalacao" className="ex-brand" onClick={() => setNavOpen(false)}>
            <span className="ex-brand__mark" aria-hidden />
            <span className="ex-brand__name">CodeHero</span>
          </Link>
          <span className={`ex-role${isPlatformAdmin ? " ex-role--admin" : ""}`}>
            {isPlatformAdmin ? "Admin plataforma" : "Workspace"}
          </span>
        </div>

        <nav className="ex-nav">{renderTier()}</nav>

        <div className="ex-sidebar__foot">
          <p className="ex-sidebar__user" title={user?.email ?? undefined}>
            {user?.displayName ?? user?.email ?? "Conta"}
          </p>
          <button
            type="button"
            className="ex-btn ex-btn--ghost"
            onClick={() => {
              setNavOpen(false);
              void signOut(auth);
            }}
          >
            Encerrar sessão
          </button>
        </div>
      </aside>

      {navOpen && (
        <button type="button" className="ex-backdrop" aria-label="Fechar menu" onClick={() => setNavOpen(false)} />
      )}

      <div className="ex-workspace">
        <header className="ex-topbar">
          <button
            type="button"
            className="ex-btn ex-btn--ghost ex-topbar__menu"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
          >
            Menu
          </button>
          <div className="ex-topbar__crumb">
            <span className="ex-topbar__tier">{currentGroup?.label}</span>
            <span className="ex-topbar__sep" aria-hidden>
              /
            </span>
            <span className="ex-topbar__page">{current?.label}</span>
          </div>
          <div className="ex-topbar__accent" aria-hidden />
        </header>

        <div className="ex-main">{children}</div>
      </div>
    </div>
  );
}
