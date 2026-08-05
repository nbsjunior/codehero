import type { ReactNode } from "react";

/** Peças de UI compartilhadas do cockpit de admin (hierarquia executiva, estilo CodeHero). */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="hero-page-header ex-page-header">
      <div className="hero-page-header__text">
        {eyebrow && <p className="hero-page-header__eyebrow">{eyebrow}</p>}
        <h1 className="hero-page-header__title">{title}</h1>
        {description && <p className="hero-page-header__desc">{description}</p>}
      </div>
      {actions ? <div className="hero-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function DataSection({
  title,
  description,
  actions,
  children,
  flush = false,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={`hero-data-section${flush ? " hero-data-section--flush" : ""}`}>
      {(title || actions) && (
        <div className="hero-data-section__head">
          <div>
            {title && <h2 className="hero-data-section__title">{title}</h2>}
            {description && <p className="hero-data-section__desc">{description}</p>}
          </div>
          {actions ? <div className="hero-data-section__actions">{actions}</div> : null}
        </div>
      )}
      <div className="hero-data-section__body">{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className={`hero-kpi${tone ? ` hero-kpi--${tone}` : ""}`}>
      <span className="hero-kpi__label">{label}</span>
      <strong className="hero-kpi__value">{value}</strong>
      {sub != null && sub !== "" && <span className="hero-kpi__sub">{sub}</span>}
    </div>
  );
}

export function KpiGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="hero-kpi-group">
      {title && <h3 className="hero-kpi-group__title">{title}</h3>}
      <div className="hero-kpi-group__grid">{children}</div>
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className={`hero-callout hero-callout--${tone}`} role="note">
      {title && <strong className="hero-callout__title">{title}</strong>}
      <div className="hero-callout__body">{children}</div>
    </aside>
  );
}
