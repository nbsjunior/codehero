import * as vscode from "vscode";
import type { ScanFinding, ScanSummary } from "./scan";

class DetailItem extends vscode.TreeItem {
  constructor(label: string, detail: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = detail.length > 80 ? `${detail.slice(0, 77)}…` : detail;
    this.tooltip = detail;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class FindingItem extends vscode.TreeItem {
  children: DetailItem[];

  constructor(readonly finding: ScanFinding) {
    super(`${finding.severity} · ${finding.ruleId}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${finding.file}:${finding.line}`;
    this.tooltip = [
      finding.risk ? `Risco: ${finding.risk}` : "",
      `Motivo: ${finding.message}`,
      finding.howToFix ? `Como corrigir: ${finding.howToFix}` : "",
      finding.snippet,
    ]
      .filter(Boolean)
      .join("\n\n");
    this.iconPath = new vscode.ThemeIcon(iconForSeverity(finding.severity));
    this.contextValue = "codeheroFinding";
    this.command = {
      command: "codehero.openFinding",
      title: "Abrir",
      arguments: [this],
    };
    this.children = [
      new DetailItem("Risco", finding.risk || finding.severity, "warning"),
      new DetailItem("Motivo", finding.message, "info"),
      new DetailItem("Como corrigir", finding.howToFix || "Ver ficha completa", "lightbulb"),
    ];
  }
}

class SummaryItem extends vscode.TreeItem {
  constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

class SeverityGroup extends vscode.TreeItem {
  children: FindingItem[];
  constructor(severity: string, findings: ScanFinding[]) {
    super(`${severity} (${findings.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(iconForSeverity(severity));
    this.children = findings.map((f) => new FindingItem(f));
  }
}

export class FindingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private summary: ScanSummary = { findings: [], bySeverity: {}, fileCountHint: 0, ruleCatalog: [] };
  private roots: vscode.TreeItem[] = [new SummaryItem("Nenhum scan ainda", "Clique em ↻ Rodar scan")];

  setFindings(findings: ScanFinding[], summary: ScanSummary): void {
    this.summary = summary;
    if (findings.length === 0) {
      this.roots = [
        new SummaryItem("Nenhum apontamento", "QG limpo — nenhuma violação nas regras ativas"),
      ];
    } else {
      const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
      const groups: SeverityGroup[] = [];
      for (const sev of order) {
        const list = findings.filter((f) => f.severity === sev);
        if (list.length) groups.push(new SeverityGroup(sev, list));
      }
      const header = new SummaryItem(
        `Avaliação: ${findings.length} apontamento(s)`,
        Object.entries(summary.bySeverity)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · "),
      );
      this.roots = [header, ...groups];
    }
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) return this.roots;
    if (element instanceof SeverityGroup) return element.children;
    if (element instanceof FindingItem) return element.children;
    return [];
  }
}

function iconForSeverity(sev: string): string {
  switch (sev) {
    case "BLOCKER":
    case "CRITICAL":
      return "error";
    case "MAJOR":
      return "warning";
    case "MINOR":
      return "info";
    default:
      return "circle-outline";
  }
}
