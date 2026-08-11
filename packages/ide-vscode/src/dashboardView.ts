import * as vscode from "vscode";
import type { ScanSummary } from "./scan";
import { formatDebt, type Rating } from "./metrics";

const SEVERITY_ORDER = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
const SEVERITY_COLOR: Record<string, string> = {
  BLOCKER: "var(--vscode-testing-iconFailed, #f14c4c)",
  CRITICAL: "var(--vscode-editorError-foreground, #f14c4c)",
  MAJOR: "var(--vscode-editorWarning-foreground, #cca700)",
  MINOR: "var(--vscode-editorInfo-foreground, #3794ff)",
  INFO: "var(--vscode-descriptionForeground, #8a8a8a)",
};
const RATING_COLOR: Record<string, string> = {
  A: "#3fb950",
  B: "#7ee787",
  C: "#d29922",
  D: "#db6d28",
  E: "#f85149",
};
const RATING_PCT: Record<string, number> = { A: 100, B: 80, C: 60, D: 40, E: 20 };
const TYPE_LABEL: Record<string, string> = {
  VULNERABILITY: "Vulnerabilidade",
  CODE_SMELL: "Code smell",
  BUG: "Bug",
  SECURITY_HOTSPOT: "Hotspot",
};
const TYPE_COLOR: Record<string, string> = {
  VULNERABILITY: "#f85149",
  CODE_SMELL: "#d29922",
  BUG: "#db6d28",
  SECURITY_HOTSPOT: "#a371f7",
};

/**
 * Persistent editor-area panel: health ratings + compliance.
 * Compliance % uses scannable (live) rules only; stubs are catalog-only.
 */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (DashboardPanel.current === this) DashboardPanel.current = undefined;
    });
  }

  static reveal(summary: ScanSummary): void {
    if (DashboardPanel.current && !DashboardPanel.current.disposed) {
      DashboardPanel.current.update(summary);
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "codeheroDashboard",
      "CodeHero: Saúde e grafo",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, retainContextWhenHidden: true },
    );
    const instance = new DashboardPanel(panel);
    DashboardPanel.current = instance;
    instance.update(summary);
  }

  static refreshIfOpen(summary: ScanSummary): void {
    if (DashboardPanel.current && !DashboardPanel.current.disposed) {
      DashboardPanel.current.update(summary);
    }
  }

  private update(summary: ScanSummary): void {
    this.panel.title = "CodeHero: Saúde e grafo";
    this.panel.webview.html = renderHtml(summary);
  }
}

function renderHtml(summary: ScanSummary): string {
  const total = summary.findings.length;
  const bySeverity = summary.bySeverity;
  const maxCount = Math.max(1, ...SEVERITY_ORDER.map((s) => bySeverity[s] ?? 0));
  const health = summary.health;

  const nonCompliantIds = new Set(summary.findings.map((f) => f.ruleId));
  const catalog = summary.ruleCatalog;
  const liveCatalog = catalog.filter((r) => r.scannable !== false && r.implementation !== "stub");
  const stubCount =
    summary.catalogStats?.stubCount ?? catalog.filter((r) => r.implementation === "stub").length;
  const catalogCount = summary.catalogStats?.catalogCount ?? catalog.length;
  const liveCount = summary.catalogStats?.liveCount ?? liveCatalog.length;

  const compliantCount = liveCatalog.length
    ? liveCatalog.filter((r) => !nonCompliantIds.has(r.id)).length
    : 0;
  const compliancePct = liveCatalog.length
    ? Math.round((compliantCount / liveCatalog.length) * 100)
    : null;

  const barsHtml = SEVERITY_ORDER.map((sev) => {
    const count = bySeverity[sev] ?? 0;
    const widthPct = Math.round((count / maxCount) * 100);
    return `
      <div class="bar-row">
        <span class="bar-label">${sev}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${widthPct}%; background:${SEVERITY_COLOR[sev]}"></div>
        </div>
        <span class="bar-count">${count}</span>
      </div>`;
  }).join("");

  const typeEntries = Object.entries(health.byIssueType).sort((a, b) => b[1] - a[1]);
  const typeMax = Math.max(1, ...typeEntries.map(([, n]) => n));
  const typeBarsHtml =
    typeEntries.length === 0
      ? `<p class="muted-inline">Sem apontamentos neste scan.</p>`
      : typeEntries
          .map(([type, n]) => {
            const label = TYPE_LABEL[type] ?? type;
            const color = TYPE_COLOR[type] ?? "var(--vscode-editorInfo-foreground, #3794ff)";
            const pct = Math.round((n / typeMax) * 100);
            return `
              <div class="bar-row">
                <span class="bar-label type">${escapeHtml(label)}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${pct}%; background:${color}"></div>
                </div>
                <span class="bar-count">${n}</span>
              </div>`;
          })
          .join("");

  const complianceRowsHtml = liveCatalog.length
    ? [...liveCatalog]
        .sort((a, b) => {
          const aBad = nonCompliantIds.has(a.id) ? 1 : 0;
          const bBad = nonCompliantIds.has(b.id) ? 1 : 0;
          if (aBad !== bBad) return bBad - aBad;
          return (
            SEVERITY_ORDER.indexOf(a.severity as (typeof SEVERITY_ORDER)[number]) -
            SEVERITY_ORDER.indexOf(b.severity as (typeof SEVERITY_ORDER)[number])
          );
        })
        .map((rule) => {
          const count = summary.findings.filter((f) => f.ruleId === rule.id).length;
          const compliant = count === 0;
          const impl =
            rule.implementation === "sonar-port"
              ? "Sonar L0"
              : rule.implementation === "overlay"
                ? "Dress"
                : rule.implementation === "core"
                  ? "Core"
                  : "";
          return `
            <tr class="${compliant ? "row-ok" : "row-bad"}">
              <td>${compliant ? "✅ Conforme" : `❌ ${count} ocorrência(s)`}</td>
              <td><code>${escapeHtml(rule.id)}</code></td>
              <td>${escapeHtml(rule.name)}</td>
              <td>${escapeHtml(rule.severity)}</td>
              <td>${escapeHtml(rule.type)}</td>
              <td>${escapeHtml(impl)}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">Catálogo de regras indisponível (offline/bundled) — rode um scan com o servidor acessível.</td></tr>`;

  const ringHtml =
    compliancePct === null
      ? ""
      : `<div class="ring" style="--pct:${compliancePct}">
           <div class="ring-value">${compliancePct}%</div>
         </div>
         <p class="ring-caption">${compliantCount} de ${liveCount} regra(s) <strong>scannable</strong> conformes</p>`;

  const gateOk = health.qualityGateStatus === "PASSED";
  const debtHours = Math.round(health.debtMinutes / 60);
  const debtTarget = Math.max(8, debtHours * 1.4);
  const debtPct = Math.min(100, (debtHours / debtTarget) * 100);
  const tdrPct = (health.debtRatio * 100).toFixed(2);

  const healthHtml = `
    <section class="card">
      <div class="card-head">
        <h2>Saúde do workspace</h2>
        <span class="gate ${gateOk ? "ok" : "bad"}">Quality Gate · ${health.qualityGateStatus}</span>
      </div>
      <p class="note" style="margin-top:0">
        Mesmas fórmulas do portal (SQALE): manutenibilidade pelo débito técnico / LOC;
        segurança pela pior vulnerabilidade. ${health.linesOfCode.toLocaleString("pt-BR")} linha(s) analisada(s).
      </p>
      <div class="health-grid">
        <div class="health-block">
          <h3>Ratings</h3>
          <div class="rings-row">
            ${ratingRingSvg("Segurança", health.securityRating)}
            ${ratingRingSvg("Manutenib.", health.maintainabilityRating)}
          </div>
        </div>
        <div class="health-block">
          <h3>Débito técnico</h3>
          <div class="debt-head">
            <strong>${escapeHtml(formatDebt(health.debtMinutes))}</strong>
            <span>${health.openIssues} apontamento(s) · TDR ${tdrPct}%</span>
          </div>
          <div class="debt-track" role="meter" aria-valuenow="${debtHours}" aria-valuemin="0" aria-valuemax="${Math.round(debtTarget)}">
            <div class="debt-fill" style="width:${debtPct}%"></div>
          </div>
          <p class="note" style="margin:0.45rem 0 0">Esforço estimado para zerar code smells</p>
        </div>
        <div class="health-block">
          <h3>Por tipo</h3>
          ${typeBarsHtml}
        </div>
      </div>
      ${
        health.qualityGateFailed.length
          ? `<ul class="gate-fail">${health.qualityGateFailed.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
          : ""
      }
    </section>`;

  const statsHtml = `
    <div class="stats">
      <div class="stat"><strong>${liveCount}</strong><span>scan (IDE)</span></div>
      <div class="stat"><strong>${stubCount}</strong><span>catálogo stub</span></div>
      <div class="stat"><strong>${catalogCount}</strong><span>catálogo total</span></div>
      <div class="stat"><strong>${summary.fileCountHint}</strong><span>arquivo(s)</span></div>
    </div>
    <p class="note">Stubs Sonar way entram no catálogo informativo (e via SARIF no portal); o matcher do plugin usa só as regras scannable.</p>`;

  const graphHtml = renderCodeGraphHtml(summary);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 1.25rem 1.5rem 2.5rem;
  }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1rem; margin: 0; }
  h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 0 0 0.65rem; font-weight: 600; }
  .subtitle { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: 0.85rem; }
  .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  .stat {
    background: var(--vscode-editorWidget-background, #2a2a2a);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    border-radius: 6px; padding: 0.55rem 0.85rem; min-width: 7rem;
  }
  .stat strong { display: block; font-size: 1.15rem; }
  .stat span { font-size: 0.72rem; color: var(--vscode-descriptionForeground); }
  .note { font-size: 0.78rem; color: var(--vscode-descriptionForeground); margin: 0 0 1.25rem; max-width: 52rem; }
  .card {
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, #252526);
    padding: 1rem 1.1rem 1.15rem;
    margin-bottom: 1.5rem;
  }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
  .gate {
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.03em;
    padding: 0.28rem 0.55rem; border-radius: 999px;
  }
  .gate.ok { background: color-mix(in srgb, #3fb950 22%, transparent); color: #3fb950; }
  .gate.bad { background: color-mix(in srgb, #f85149 22%, transparent); color: #f85149; }
  .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.25rem; margin-top: 0.85rem; }
  .health-block { min-width: 0; }
  .rings-row { display: flex; gap: 1.25rem; flex-wrap: wrap; }
  .rating-ring { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; }
  .rating-ring svg { display: block; }
  .rating-label { font-size: 0.78rem; color: var(--vscode-descriptionForeground); }
  .debt-head { display: flex; flex-direction: column; gap: 0.15rem; margin-bottom: 0.45rem; }
  .debt-head strong { font-size: 1.35rem; }
  .debt-head span { font-size: 0.75rem; color: var(--vscode-descriptionForeground); }
  .debt-track { height: 10px; border-radius: 999px; background: var(--vscode-editorWidget-border, #333); overflow: hidden; }
  .debt-fill { height: 100%; background: linear-gradient(90deg, #d29922, #f85149); border-radius: 999px; }
  .gate-fail { margin: 0.85rem 0 0; padding-left: 1.1rem; color: var(--vscode-editorError-foreground, #f85149); font-size: 0.8rem; }
  .top-grid { display: flex; gap: 2.5rem; align-items: flex-start; flex-wrap: wrap; margin-bottom: 2rem; }
  .ring {
    --size: 110px;
    width: var(--size); height: var(--size); border-radius: 50%;
    background: conic-gradient(var(--vscode-testing-iconPassed, #3fb950) calc(var(--pct) * 1%), var(--vscode-editorWidget-border, #454545) 0);
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .ring::before {
    content: ""; position: absolute; width: 78%; height: 78%; border-radius: 50%;
    background: var(--vscode-editor-background);
  }
  .ring-value { position: relative; font-size: 1.4rem; font-weight: 700; }
  .ring-caption { margin: 0.5rem 0 0; font-size: 0.78rem; color: var(--vscode-descriptionForeground); text-align: center; }
  .bars { flex: 1; min-width: 260px; }
  .bar-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.4rem; }
  .bar-label { width: 70px; font-size: 0.75rem; font-weight: 600; }
  .bar-label.type { width: 110px; }
  .bar-track { flex: 1; height: 14px; background: var(--vscode-editorWidget-border, #333); border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-count { width: 28px; text-align: right; font-size: 0.78rem; }
  .muted-inline { color: var(--vscode-descriptionForeground); font-size: 0.8rem; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--vscode-editorWidget-border, #333); }
  th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
  tr.row-bad td:first-child { color: var(--vscode-editorError-foreground, #f14c4c); font-weight: 600; }
  tr.row-ok td:first-child { color: var(--vscode-testing-iconPassed, #3fb950); }
  .muted { color: var(--vscode-descriptionForeground); text-align: center; padding: 1rem; }
  .muted-inline { color: var(--vscode-descriptionForeground); font-size: 0.75rem; }
  .g-kpis { display: flex; gap: 0.65rem; flex-wrap: wrap; margin: 0.65rem 0 0.85rem; }
  .g-svg {
    width: 100%; height: auto; max-height: 320px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    border-radius: 6px;
  }
  .g-edge { stroke: #6e7681; stroke-width: 1.2; }
  .g-node { fill: #388bfd; stroke: #79c0ff; stroke-width: 1.4; }
  .g-node.entry { fill: #238636; stroke: #3fb950; }
  .g-label { fill: var(--vscode-descriptionForeground); font-size: 10px; text-anchor: middle; }
  .g-hot { list-style: none; margin: 0.75rem 0 0; padding: 0; font-size: 0.8rem; }
  .g-hot li { display: flex; gap: 0.65rem; flex-wrap: wrap; padding: 0.2rem 0; border-bottom: 1px solid var(--vscode-editorWidget-border, #333); }
  .g-hot span { color: var(--vscode-descriptionForeground); }
  code { font-family: var(--vscode-editor-font-family); }
</style>
</head>
<body>
  <h1>CodeHero — Saúde e grafo</h1>
  <p class="subtitle">${total} finding(s) · ${summary.linesOfCode.toLocaleString("pt-BR")} LOC · scan ${escapeHtml(summary.rulesSource ?? "?")} ${escapeHtml((summary.rulesVersion ?? "").slice(0, 12))} · catálogo ${escapeHtml((summary.catalogVersion ?? "").slice(0, 12))}</p>

  ${statsHtml}
  ${healthHtml}
  ${graphHtml}

  <div class="top-grid">
    ${ringHtml ? `<div>${ringHtml}</div>` : ""}
    <div class="bars">
      <h3 style="margin-top:0">Severidade</h3>
      ${barsHtml}
    </div>
  </div>

  <h2 style="font-size:1rem;margin:0 0 0.5rem">Regras scannable (IDE)</h2>
  <table>
    <thead>
      <tr><th>Status</th><th>Regra</th><th>Nome</th><th>Severidade</th><th>Tipo</th><th>Origem</th></tr>
    </thead>
    <tbody>${complianceRowsHtml}</tbody>
  </table>
</body>
</html>`;
}

function renderCodeGraphHtml(summary: ScanSummary): string {
  const g = summary.codeGraph;
  if (!g || (!g.functions && !(g.hotspots?.length))) {
    return `<section class="card">
      <div class="card-head"><h2>Grafo do código avaliado</h2></div>
      <p class="note" style="margin:0">Sem code-graph neste scan. A avaliação de workspace usa --metrics --code-graph automaticamente.</p>
    </section>`;
  }

  const hotspots = g.hotspots ?? [];
  const W = 640;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.38;
  const n = Math.max(1, hotspots.length);
  const pos = new Map<string, { x: number; y: number }>();
  hotspots.forEach((h, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    pos.set(h.id, { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  });
  const maxFan = Math.max(1, ...hotspots.map((h) => h.fanIn));

  const edges = (g.links ?? [])
    .map((l, i) => {
      const a = pos.get(l.from);
      const b = pos.get(l.to);
      if (!a || !b) return "";
      return `<line key="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="g-edge" />`;
    })
    .join("");

  const nodes = hotspots
    .map((h) => {
      const p = pos.get(h.id);
      if (!p) return "";
      const r = 8 + (h.fanIn / maxFan) * 12;
      const entry = h.hopsToEntry === 0 ? " entry" : "";
      const label = h.name.length > 16 ? `${h.name.slice(0, 15)}…` : h.name;
      return `<g transform="translate(${p.x},${p.y})">
        <circle r="${r}" class="g-node${entry}">
          <title>${escapeHtml(h.name)} · fan-in ${h.fanIn}</title>
        </circle>
        <text y="${r + 11}" class="g-label">${escapeHtml(label)}</text>
      </g>`;
    })
    .join("");

  const hotList = hotspots
    .slice(0, 8)
    .map(
      (h) =>
        `<li><code>${escapeHtml(h.name)}</code> <span>fan-in ${h.fanIn}</span>${
          h.hopsToEntry != null ? ` <span>hops ${h.hopsToEntry}</span>` : ""
        }</li>`,
    )
    .join("");

  return `<section class="card">
    <div class="card-head"><h2>Grafo do código avaliado</h2><span class="muted-inline">determinístico</span></div>
    <div class="g-kpis">
      <div class="stat"><strong>${g.functions}</strong><span>funções</span></div>
      <div class="stat"><strong>${g.calls}</strong><span>calls</span></div>
      <div class="stat"><strong>${g.imports}</strong><span>imports</span></div>
      <div class="stat"><strong>${g.entries}</strong><span>entries</span></div>
      <div class="stat"><strong>${g.nodes}</strong><span>nós</span></div>
      <div class="stat"><strong>${g.edges}</strong><span>arestas</span></div>
    </div>
    <svg class="g-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafo de chamadas">
      ${edges}${nodes}
    </svg>
    <ul class="g-hot">${hotList}</ul>
  </section>`;
}

function ratingRingSvg(label: string, rating: Rating | string): string {
  const order = ["A", "B", "C", "D", "E"];
  const idx = Math.max(0, order.indexOf(rating));
  const pct = ((order.length - idx) / order.length) * 100;
  const color = RATING_COLOR[rating] ?? "var(--vscode-descriptionForeground)";
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const pctLabel = RATING_PCT[rating] ?? Math.round(pct);
  return `
    <div class="rating-ring" title="${escapeHtml(label)}: ${escapeHtml(rating)}">
      <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
        <circle cx="48" cy="48" r="${r}" fill="none" stroke="var(--vscode-editorWidget-border, #454545)" stroke-width="8" opacity="0.45" />
        <circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 48 48)" />
        <text x="48" y="46" text-anchor="middle" fill="${color}" font-size="14" font-weight="700">${pctLabel}%</text>
        <text x="48" y="64" text-anchor="middle" fill="${color}" font-size="16" font-weight="800">${escapeHtml(rating || "—")}</text>
      </svg>
      <span class="rating-label">${escapeHtml(label)}</span>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
