import * as vscode from "vscode";
import type { ScanSummary } from "./scan";

const SEVERITY_ORDER = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
const SEVERITY_COLOR: Record<string, string> = {
  BLOCKER: "var(--vscode-testing-iconFailed, #f14c4c)",
  CRITICAL: "var(--vscode-editorError-foreground, #f14c4c)",
  MAJOR: "var(--vscode-editorWarning-foreground, #cca700)",
  MINOR: "var(--vscode-editorInfo-foreground, #3794ff)",
  INFO: "var(--vscode-descriptionForeground, #8a8a8a)",
};

/**
 * Persistent editor-area panel: the "graphs + compliance/non-compliance"
 * view the sidebar TreeView (findingsView.ts) doesn't provide. Read-only —
 * no message-passing back to the extension needed for the MVP, so the whole
 * thing re-renders as static HTML on every scan.
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
      "CodeHero: Compliance",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, retainContextWhenHidden: true },
    );
    const instance = new DashboardPanel(panel);
    DashboardPanel.current = instance;
    instance.update(summary);
  }

  /** Refresh content silently if the panel is already open — does not steal focus. */
  static refreshIfOpen(summary: ScanSummary): void {
    if (DashboardPanel.current && !DashboardPanel.current.disposed) {
      DashboardPanel.current.update(summary);
    }
  }

  private update(summary: ScanSummary): void {
    this.panel.webview.html = renderHtml(summary);
  }
}

function renderHtml(summary: ScanSummary): string {
  const total = summary.findings.length;
  const bySeverity = summary.bySeverity;
  const maxCount = Math.max(1, ...SEVERITY_ORDER.map((s) => bySeverity[s] ?? 0));

  const nonCompliantIds = new Set(summary.findings.map((f) => f.ruleId));
  const catalog = summary.ruleCatalog;
  const compliantCount = catalog.length ? catalog.filter((r) => !nonCompliantIds.has(r.id)).length : 0;
  const compliancePct = catalog.length ? Math.round((compliantCount / catalog.length) * 100) : null;

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

  const complianceRowsHtml = catalog.length
    ? [...catalog]
        .sort((a, b) => {
          const aBad = nonCompliantIds.has(a.id) ? 1 : 0;
          const bBad = nonCompliantIds.has(b.id) ? 1 : 0;
          if (aBad !== bBad) return bBad - aBad;
          return SEVERITY_ORDER.indexOf(a.severity as (typeof SEVERITY_ORDER)[number]) -
            SEVERITY_ORDER.indexOf(b.severity as (typeof SEVERITY_ORDER)[number]);
        })
        .map((rule) => {
          const count = summary.findings.filter((f) => f.ruleId === rule.id).length;
          const compliant = count === 0;
          return `
            <tr class="${compliant ? "row-ok" : "row-bad"}">
              <td>${compliant ? "✅ Conforme" : `❌ ${count} ocorrência(s)`}</td>
              <td><code>${escapeHtml(rule.id)}</code></td>
              <td>${escapeHtml(rule.name)}</td>
              <td>${escapeHtml(rule.severity)}</td>
              <td>${escapeHtml(rule.type)}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">Catálogo de regras indisponível (offline/bundled) — rode um scan com o servidor acessível para ver a lista completa de conformidade.</td></tr>`;

  const ringHtml =
    compliancePct === null
      ? ""
      : `<div class="ring" style="--pct:${compliancePct}">
           <div class="ring-value">${compliancePct}%</div>
         </div>
         <p class="ring-caption">${compliantCount} de ${catalog.length} regra(s) conformes</p>`;

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
  .subtitle { color: var(--vscode-descriptionForeground); margin: 0 0 1.5rem; font-size: 0.85rem; }
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
  .bar-track { flex: 1; height: 14px; background: var(--vscode-editorWidget-border, #333); border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-count { width: 28px; text-align: right; font-size: 0.78rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--vscode-editorWidget-border, #333); }
  th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
  tr.row-bad td:first-child { color: var(--vscode-editorError-foreground, #f14c4c); font-weight: 600; }
  tr.row-ok td:first-child { color: var(--vscode-testing-iconPassed, #3fb950); }
  .muted { color: var(--vscode-descriptionForeground); text-align: center; padding: 1rem; }
  code { font-family: var(--vscode-editor-font-family); }
</style>
</head>
<body>
  <h1>CodeHero — Compliance do workspace</h1>
  <p class="subtitle">${total} finding(s) · regras ${escapeHtml(summary.rulesSource ?? "?")} ${escapeHtml((summary.rulesVersion ?? "").slice(0, 12))}</p>

  <div class="top-grid">
    ${ringHtml ? `<div>${ringHtml}</div>` : ""}
    <div class="bars">${barsHtml}</div>
  </div>

  <table>
    <thead>
      <tr><th>Status</th><th>Regra</th><th>Nome</th><th>Severidade</th><th>Tipo</th></tr>
    </thead>
    <tbody>${complianceRowsHtml}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
