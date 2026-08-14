"use client";

const SEV_ORDER = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
const SEV_COLOR: Record<string, string> = {
  BLOCKER: "#dc2626",
  CRITICAL: "#ea580c",
  MAJOR: "#ca8a04",
  MINOR: "#65a30d",
  INFO: "#64748b",
};

const RATING_COLOR: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#ca8a04",
  D: "#ea580c",
  E: "#dc2626",
};

export function countByField(items: Array<Record<string, unknown>>, field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = String(item[field] ?? "—");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Horizontal stacked / bar chart for severity distribution. */
export function SeverityBars({
  counts,
  totalHint,
}: {
  counts: Record<string, number>;
  totalHint?: number;
}) {
  const total = totalHint ?? Object.values(counts).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return <p className="hero-caption">Sem apontamentos para graficar.</p>;
  }

  return (
    <div className="ch-chart">
      <div className="ch-chart-stack" role="img" aria-label="Distribuição por severidade">
        {SEV_ORDER.map((sev) => {
          const n = counts[sev] ?? 0;
          if (!n) return null;
          const pct = Math.max(2, (n / total) * 100);
          return (
            <div
              key={sev}
              className="ch-chart-stack-seg"
              style={{ width: `${pct}%`, background: SEV_COLOR[sev] }}
              title={`${sev}: ${n}`}
            />
          );
        })}
      </div>
      <ul className="ch-chart-legend">
        {SEV_ORDER.map((sev) => {
          const n = counts[sev] ?? 0;
          if (!n) return null;
          return (
            <li key={sev}>
              <span className="ch-dot" style={{ background: SEV_COLOR[sev] }} />
              <strong>{sev}</strong>
              <em>{n}</em>
              <span>{Math.round((n / total) * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Vertical bars for any labeled counts. */
export function VerticalBars({
  data,
  maxBars = 8,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  maxBars?: number;
}) {
  const rows = [...data].sort((a, b) => b.value - a.value).slice(0, maxBars);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return <p className="hero-caption">Sem dados.</p>;
  }
  return (
    <div className="ch-vbars" role="img" aria-label="Gráfico de barras">
      {rows.map((r) => (
        <div key={r.label} className="ch-vbar-row">
          <span className="ch-vbar-label" title={r.label}>
            {r.label}
          </span>
          <div className="ch-vbar-track">
            <div
              className="ch-vbar-fill"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: r.color ?? "var(--accent)",
              }}
            />
          </div>
          <span className="ch-vbar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const RATING_PCT: Record<string, number> = { A: 100, B: 80, C: 60, D: 40, E: 20 };

/** Circular rating gauge A–E, shown as a percentage. Optionally clickable to drill into detail. */
export function RatingRing({
  label,
  rating,
  onClick,
  active,
}: {
  label: string;
  rating: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const order = ["A", "B", "C", "D", "E"];
  const idx = Math.max(0, order.indexOf(rating));
  const pct = ((order.length - idx) / order.length) * 100;
  const color = RATING_COLOR[rating] ?? "var(--muted)";
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  const content = (
    <>
      <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--line)" strokeWidth="8" opacity="0.35" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="46" textAnchor="middle" className="ch-ring-pct" fill={color}>
          {RATING_PCT[rating] ?? Math.round(pct)}%
        </text>
        <text x="48" y="62" textAnchor="middle" className="ch-ring-letter" fill={color}>
          {rating || "—"}
        </text>
      </svg>
      <span className="ch-ring-label">{label}</span>
    </>
  );

  if (!onClick) {
    return <div className="ch-ring">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`ch-ring ch-ring-clickable${active ? " is-active" : ""}`}
      style={{ background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit", padding: 0 }}
    >
      {content}
    </button>
  );
}

/** Debt hours meter vs a soft target. */
export function DebtMeter({
  debtMinutes,
  openIssues,
}: {
  debtMinutes: number;
  openIssues: number;
}) {
  const hours = Math.round(debtMinutes / 60);
  const targetHours = Math.max(8, hours * 1.4);
  const pct = Math.min(100, (hours / targetHours) * 100);

  return (
    <div className="ch-debt">
      <div className="ch-debt-head">
        <strong>{hours}h</strong>
        <span>débito técnico · {openIssues} issues</span>
      </div>
      <div className="ch-debt-track" role="meter" aria-valuenow={hours} aria-valuemin={0} aria-valuemax={Math.round(targetHours)}>
        <div className="ch-debt-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="hero-caption" style={{ margin: "0.5rem 0 0" }}>
        Esforço estimado para zerar smells abertos
      </p>
    </div>
  );
}

export function GatePill({ status }: { status: string }) {
  const ok = status === "PASSED";
  return (
    <span className={`ch-gate-pill${ok ? " is-ok" : " is-bad"}`}>
      Quality Gate · {status || "—"}
    </span>
  );
}

export type TimeSeriesPoint = { t: number; label: string; values: Record<string, number> };

export type TimeSeriesLine = {
  key: string;
  label: string;
  color: string;
};

/**
 * Multi-series line chart for portfolio evolution (smells / complexity).
 * Expects points ordered by `t` ascending; missing series values are skipped in the path.
 */
export function TimeSeriesChart({
  points,
  series,
  height = 180,
  valueFormat,
}: {
  points: TimeSeriesPoint[];
  series: TimeSeriesLine[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const fmt = valueFormat ?? ((n: number) => n.toLocaleString("pt-BR"));
  if (points.length === 0) {
    return <p className="hero-caption">Sem histórico de análises ainda.</p>;
  }

  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const width = 560;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    for (const s of series) {
      const v = p.values[s.key];
      if (typeof v === "number" && Number.isFinite(v)) {
        minY = Math.min(minY, v);
        maxY = Math.max(maxY, v);
      }
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return <p className="hero-caption">Sem métricas numéricas neste período.</p>;
  }
  if (minY === maxY) {
    minY = Math.min(0, minY);
    maxY = maxY === 0 ? 1 : maxY * 1.15;
  }
  const ySpan = maxY - minY || 1;
  const xSpan = Math.max(1, points.length - 1);

  const xAt = (i: number) => pad.left + (i / xSpan) * innerW;
  const yAt = (v: number) => pad.top + innerH - ((v - minY) / ySpan) * innerH;

  const paths = series.map((s) => {
    const coords: Array<{ x: number; y: number; v: number }> = [];
    points.forEach((p, i) => {
      const v = p.values[s.key];
      if (typeof v === "number" && Number.isFinite(v)) {
        coords.push({ x: xAt(i), y: yAt(v), v });
      }
    });
    if (coords.length === 0) return { ...s, d: "", coords };
    const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    return { ...s, d, coords };
  });

  const yTicks = [minY, minY + ySpan / 2, maxY];
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="ch-ts">
      <svg
        className="ch-ts-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Série temporal"
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((tick, i) => {
          const y = yAt(tick);
          return (
            <g key={`yt-${i}`}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                className="ch-ts-grid"
              />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" className="ch-ts-axis">
                {fmt(Math.round(tick * 10) / 10)}
              </text>
            </g>
          );
        })}
        {paths.map((s) =>
          s.d ? (
            <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null,
        )}
        {paths.flatMap((s) =>
          s.coords.map((c, i) => (
            <circle key={`${s.key}-${i}`} cx={c.x} cy={c.y} r={3} fill={s.color}>
              <title>
                {s.label}: {fmt(c.v)}
              </title>
            </circle>
          )),
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={`xl-${i}`} x={xAt(i)} y={height - 8} textAnchor="middle" className="ch-ts-axis">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <ul className="ch-ts-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className="ch-dot" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
