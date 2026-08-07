"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, sendEmailVerification } from "firebase/auth";
import { auth } from "@/lib/firebaseCore";
import { useAuth } from "@/lib/useAuth";

/** Persistent nudge until the user confirms email — previews/scans require it (see previewScan.ts). */
function EmailVerifyBanner() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.emailVerified) return null;

  return (
    <div className="hero-verify-banner" role="status">
      <span>
        Confirme seu e-mail (<strong>{user.email}</strong>) para rodar prévias e scans.
      </span>
      <button
        type="button"
        className="hero-btn hero-btn-outline"
        style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}
        disabled={busy || sent}
        onClick={async () => {
          setBusy(true);
          try {
            await sendEmailVerification(user);
            setSent(true);
          } catch {
            /* best-effort — user can retry */
          } finally {
            setBusy(false);
          }
        }}
      >
        {sent ? "Link enviado ✓" : busy ? "Enviando…" : "Reenviar link"}
      </button>
    </div>
  );
}

/**
 * Chrome mínimo fora do /admin (Docs etc.). Em /admin o menu único vive no
 * AdminCockpitShell — aqui só brand + sair, sem segunda sidebar.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const onAdmin = Boolean(pathname?.startsWith("/admin"));
  const [navOpen, setNavOpen] = useState(false);

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

  if (onAdmin) {
    return (
      <div className="hero-app-shell hero-app-shell--cockpit-only">
        <EmailVerifyBanner />
        {children}
      </div>
    );
  }

  return (
    <div className="hero-app-shell">
      <header className="hero-mobile-bar">
        <Link href="/admin/#instalacao" className="hero-sidebar-brand" onClick={() => setNavOpen(false)}>
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
        <button type="button" className="hero-mobile-backdrop" aria-label="Fechar menu" onClick={() => setNavOpen(false)} />
      ) : null}

      <aside id="hero-mobile-drawer" className={`hero-sidebar${navOpen ? " is-open" : ""}`}>
        <Link href="/admin/#instalacao" className="hero-sidebar-brand hero-sidebar-brand-desktop" onClick={() => setNavOpen(false)}>
          <span className="hero-burst">⚡</span>
          <span className="hero-display">CodeHero</span>
        </Link>

        <p className="hero-sidebar-kicker">Navegação</p>
        <nav className="hero-sidebar-nav">
          <Link href="/admin/#instalacao" className="hero-sidebar-link" onClick={() => setNavOpen(false)}>
            <span aria-hidden>◆</span>
            Painel
          </Link>
          <Link
            href="/docs/"
            className={`hero-sidebar-link${pathname?.startsWith("/docs") ? " is-active" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <span aria-hidden>▤</span>
            Docs
          </Link>
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

      <div className="hero-main">
        <EmailVerifyBanner />
        {children}
      </div>

      <nav className="hero-bottom-nav" aria-label="Navegação principal">
        <Link href="/admin/#instalacao" className="hero-bottom-link">
          <span aria-hidden>◆</span>
          <span>Painel</span>
        </Link>
        <Link href="/docs/" className={`hero-bottom-link${pathname?.startsWith("/docs") ? " is-active" : ""}`}>
          <span aria-hidden>▤</span>
          <span>Docs</span>
        </Link>
      </nav>
    </div>
  );
}
