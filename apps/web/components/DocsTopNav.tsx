"use client";
import { useState } from "react";
import Link from "next/link";

export default function DocsTopNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="cr-docs-nav">
      <Link href="/" className="cr-docs-nav-brand" onClick={() => setOpen(false)}>
        <span className="cr-nav-mark" aria-hidden>
          H
        </span>
        <strong>CodeHero</strong>
      </Link>

      <button
        type="button"
        className="cr-docs-nav-toggle"
        aria-expanded={open}
        aria-controls="cr-docs-nav-links"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cr-sr-only">Menu</span>
        <span aria-hidden>{open ? "✕" : "☰"}</span>
      </button>

      <div id="cr-docs-nav-links" className={`cr-docs-nav-links${open ? " is-open" : ""}`}>
        <a href="https://produtech.web.app" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
          Estimativa Build
        </a>
        <a href="https://github.com/nbsjunior/codehero" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
          GitHub
        </a>
        <a
          href="https://github.com/nbsjunior/codehero/wiki"
          target="_blank"
          rel="noreferrer"
          onClick={() => setOpen(false)}
        >
          Wiki
        </a>
        <Link
          href="/"
          className="cr-btn cr-btn-primary"
          style={{ textDecoration: "none", padding: "0.5rem 1rem" }}
          onClick={() => setOpen(false)}
        >
          Entrar
        </Link>
      </div>
    </nav>
  );
}
