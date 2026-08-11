import * as vscode from "vscode";
import { FindingsTreeProvider, type FindingItem } from "./findingsView";
import { DashboardPanel } from "./dashboardView";
import { getConfig, resolveScannerInvocationSafe } from "./config";
import { runScan, type ScanFinding, type ScanSummary } from "./scan";
import { computeRepoHealth } from "./metrics";

let collection: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;
let findingsProvider: FindingsTreeProvider;
let lastFindings: ScanFinding[] = [];
let lastSummary: ScanSummary = emptySummary();
let extensionPath = "";

export function activate(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  collection = vscode.languages.createDiagnosticCollection("codehero");
  findingsProvider = new FindingsTreeProvider();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "codehero.scanWorkspace";
  statusBar.tooltip = "CodeHero: rodar scan determinístico no workspace";
  setStatusIdle(0);
  statusBar.show();

  context.subscriptions.push(
    collection,
    statusBar,
    vscode.window.registerTreeDataProvider("codehero.findings", findingsProvider),
    vscode.commands.registerCommand("codehero.scanWorkspace", () => void scanWorkspace()),
    vscode.commands.registerCommand("codehero.scanFile", () => void scanCurrentFile()),
    vscode.commands.registerCommand("codehero.clearFindings", () => clearFindings()),
    vscode.commands.registerCommand("codehero.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "codehero"),
    ),
    vscode.commands.registerCommand("codehero.showHowTo", () => void showHowTo()),
    vscode.commands.registerCommand("codehero.showDashboard", () => DashboardPanel.reveal(lastSummary)),
    vscode.commands.registerCommand("codehero.openFinding", (item: FindingItem) => void openFinding(item)),
    vscode.commands.registerCommand("codehero.showFindingFicha", (item: FindingItem) => void showFindingFicha(item)),
    vscode.commands.registerCommand("codehero.copyFinding", async (item: FindingItem) => {
      const text = formatFichaPlain(item.finding);
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage("CodeHero: ficha do apontamento copiada.");
    }),
    vscode.languages.registerHoverProvider({ scheme: "file" }, {
      provideHover(document, position) {
        const diags = collection.get(document.uri) ?? [];
        const hit = diags.find((d) => d.range.contains(position) && d.source === "codehero");
        if (!hit) return undefined;
        const ruleId =
          typeof hit.code === "string"
            ? hit.code
            : hit.code && typeof hit.code === "object" && "value" in hit.code
              ? String(hit.code.value)
              : undefined;
        const finding = lastFindings.find(
          (f) =>
            f.absolutePath === document.uri.fsPath &&
            f.line === hit.range.start.line + 1 &&
            (!ruleId || f.ruleId === ruleId),
        );
        if (!finding) return undefined;
        return new vscode.Hover(new vscode.MarkdownString(formatFichaMarkdown(finding)));
      },
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== "file") return;
      if (getConfig().scanOnSave) void scanPath(doc.uri.fsPath, { singleFile: true, uri: doc.uri });
    }),
  );

  const welcomeKey = "codehero.welcomeShown";
  if (!context.globalState.get(welcomeKey)) {
    void context.globalState.update(welcomeKey, true);
    void vscode.window
      .showInformationMessage(
        "CodeHero instalado. Abra a barra lateral CodeHero e clique em “Rodar scan”, ou use o botão na barra de status.",
        "Como usar",
        "Rodar scan agora",
      )
      .then((choice) => {
        if (choice === "Como usar") void showHowTo();
        if (choice === "Rodar scan agora") void scanWorkspace();
      });
  }
}

export function deactivate(): void {
  collection?.dispose();
  statusBar?.dispose();
}

async function scanWorkspace(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage("CodeHero: abra uma pasta (File → Open Folder) antes de escanear.");
    return;
  }
  await scanPath(folder, { singleFile: false });
}

async function scanCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    void vscode.window.showWarningMessage("CodeHero: abra um arquivo do workspace para escanear.");
    return;
  }
  await scanPath(editor.document.uri.fsPath, { singleFile: true, uri: editor.document.uri });
}

async function scanPath(
  target: string,
  opts: { singleFile: boolean; uri?: vscode.Uri },
): Promise<void> {
  const cfg = getConfig();
  const invocation = resolveScannerInvocationSafe(extensionPath, cfg.scannerCommand);
  statusBar.text = "$(sync~spin) CodeHero: analisando…";
  statusBar.backgroundColor = undefined;

  try {
    const summary = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "CodeHero",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Rodando regras determinísticas (padrão + AST + taint)…" });
        return runScan({
          target,
          invocation,
          enableCache: cfg.enableCache,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          minSeverity: cfg.minSeverity,
          scanProfile: cfg.scanProfile,
          spotbugsClasses: cfg.spotbugsClasses || undefined,
          forceNativeProfile: opts.singleFile,
          serverUrl: cfg.serverUrl || undefined,
          token: cfg.token || undefined,
          orgId: cfg.orgId || undefined,
          projectId: cfg.projectId || undefined,
        });
      },
    );

    applyResults(summary, opts);

    if (!opts.singleFile && cfg.syncToPortal) {
      const syncMsg = await syncSarifToPortal(summary, cfg);
      if (syncMsg) void vscode.window.showInformationMessage(syncMsg);
    }

    void vscode.commands.executeCommand("codehero.findings.focus");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusBar.text = "$(error) CodeHero: falhou";
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    void vscode.window
      .showErrorMessage(`CodeHero: ${msg}`, "Abrir configurações", "Como usar")
      .then((choice) => {
        if (choice === "Abrir configurações") void vscode.commands.executeCommand("codehero.openSettings");
        if (choice === "Como usar") void showHowTo();
      });
  }
}

function applyResults(summary: ScanSummary, opts: { singleFile: boolean; uri?: vscode.Uri }): void {
  lastFindings = summary.findings;
  lastSummary = summary;
  findingsProvider.setFindings(summary.findings, summary);
  DashboardPanel.refreshIfOpen(summary);

  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const f of summary.findings) {
    const uri = vscode.Uri.file(f.absolutePath);
    const line = Math.max(0, f.line - 1);
    const startCol = Math.max(0, f.column - 1);
    const endCol = Math.max(startCol + 1, f.endColumn - 1);
    const diag = new vscode.Diagnostic(
      new vscode.Range(line, startCol, line, endCol),
      f.howToFix
        ? `${f.ruleId}: ${f.message}\nComo corrigir: ${f.howToFix}`
        : `${f.ruleId}: ${f.message}`,
      severityToDiagnostic(f.severity),
    );
    diag.source = "codehero";
    diag.code = f.ruleId;
    const list = byFile.get(uri.toString()) ?? [];
    list.push(diag);
    byFile.set(uri.toString(), list);
  }

  if (opts.singleFile && opts.uri) {
    const key = opts.uri.toString();
    collection.set(opts.uri, byFile.get(key) ?? []);
  } else {
    collection.clear();
    for (const [key, diags] of byFile) {
      collection.set(vscode.Uri.parse(key), diags);
    }
  }

  setStatusIdle(summary.findings.length);
  const rulesInfo = summary.rulesVersion
    ? ` · scan ${summary.rulesSource ?? "server"} ${summary.catalogStats?.liveCount ?? "?"} · catálogo ${summary.catalogStats?.catalogCount ?? "?"}`
    : "";
  void vscode.window.showInformationMessage(
    `CodeHero: ${summary.findings.length} finding(s) · Sec ${summary.health.securityRating} · Maint ${summary.health.maintainabilityRating} · Gate ${summary.health.qualityGateStatus}${rulesInfo}`,
  );
}

function clearFindings(): void {
  lastFindings = [];
  lastSummary = emptySummary();
  collection.clear();
  findingsProvider.setFindings([], lastSummary);
  DashboardPanel.refreshIfOpen(lastSummary);
  setStatusIdle(0);
}

function setStatusIdle(count: number): void {
  statusBar.text = count > 0 ? `$(shield) CodeHero: ${count}` : "$(shield) CodeHero";
  statusBar.backgroundColor =
    count > 0 ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
}

function severityToDiagnostic(sev: string): vscode.DiagnosticSeverity {
  switch (sev) {
    case "BLOCKER":
    case "CRITICAL":
      return vscode.DiagnosticSeverity.Error;
    case "MAJOR":
      return vscode.DiagnosticSeverity.Warning;
    case "MINOR":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

async function openFinding(item: FindingItem): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.finding.absolutePath));
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const line = Math.max(0, item.finding.line - 1);
  const col = Math.max(0, item.finding.column - 1);
  const pos = new vscode.Position(line, col);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  await showFindingFicha(item);
}

async function showFindingFicha(item: FindingItem): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: formatFichaMarkdown(item.finding),
  });
  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
  });
}

function formatFichaMarkdown(f: ScanFinding): string {
  const provenance = provenanceBits(f);
  const lines = [
    `# Ficha do apontamento`,
    ``,
    `**\`${f.ruleId}\`** · ${f.severity}${f.issueType ? ` · ${f.issueType}` : ""}`,
    `Local: \`${f.file}:${f.line}\``,
  ];
  if (provenance) {
    lines.push(`Procedência: ${provenance}`);
  }
  lines.push(
    ``,
    `## Risco`,
    f.risk || `${f.severity}${f.issueType ? ` · ${f.issueType}` : ""}`,
    ``,
    `## Motivo do apontamento`,
    f.message || "_sem mensagem_",
  );
  if (f.snippet) {
    lines.push(``, "```", f.snippet, "```");
  }
  lines.push(``, `## Como corrigir`, f.howToFix || "_Orientação não disponível neste scan — atualize o scanner/VSIX._");
  if (f.constraints?.length) {
    lines.push(``, `### Restrições`);
    for (const c of f.constraints) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}

function provenanceBits(f: ScanFinding): string | null {
  const bits: string[] = [];
  if (f.findingSource === "imported" || f.ruleId.startsWith("EXT:")) {
    bits.push(f.tool ? `via ${f.tool}` : "importado");
    if (f.originalRuleId) bits.push(f.originalRuleId);
    if (f.isDependency) bits.push("dependência");
  } else if (f.engine) {
    bits.push(f.engine);
  } else if (f.tool) {
    bits.push(f.tool);
  }
  if (f.alsoRuleIds?.length) {
    bits.push(`também ${f.alsoRuleIds.slice(0, 3).join(", ")}`);
  }
  return bits.length ? bits.join(" · ") : null;
}

function formatFichaPlain(f: ScanFinding): string {
  return [
    `Regra: ${f.ruleId}`,
    `Local: ${f.file}:${f.line}`,
    `Procedência: ${provenanceBits(f) || "nativo"}`,
    `Risco: ${f.risk || f.severity}`,
    `Motivo: ${f.message}`,
    `Como corrigir: ${f.howToFix || "(n/d)"}`,
  ].join("\n");
}

async function syncSarifToPortal(
  summary: ScanSummary,
  cfg: ReturnType<typeof getConfig>,
): Promise<string | null> {
  if (!cfg.token || !cfg.orgId || !cfg.projectId || !cfg.repoId) {
    return "CodeHero: syncToPortal ligado, mas faltam token / orgId / projectId / repoId nas settings.";
  }
  if (!summary.sarif) return "CodeHero: SARIF ausente — sync pulado.";
  const server = (cfg.serverUrl || "https://codehero.web.app/api").replace(/\/$/, "");
  try {
    const r = await fetch(`${server}/ingestAnalysis`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orgId: cfg.orgId,
        projectId: cfg.projectId,
        repoId: cfg.repoId,
        branch: "ide",
        linesOfCode: summary.linesOfCode,
        newCodeFingerprints: [],
        sarif: summary.sarif,
      }),
    });
    const body = await r.text();
    if (!r.ok) return `CodeHero: sync ao portal falhou (HTTP ${r.status}): ${body.slice(0, 200)}`;
    try {
      const j = JSON.parse(body) as { analysisId?: string; summary?: { qualityGate?: { status?: string } } };
      return `CodeHero: sync ok · analysis ${j.analysisId ?? "?"} · gate ${j.summary?.qualityGate?.status ?? "?"}`;
    } catch {
      return "CodeHero: sync ao portal ok.";
    }
  } catch (e) {
    return `CodeHero: sync erro — ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function showHowTo(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: `# Como usar o CodeHero

## Em 3 passos

1. **Abra a pasta do seu projeto** (File → Open Folder).
2. Clique no ícone **CodeHero** na barra lateral esquerda (ou no botão \`CodeHero\` na barra de status).
3. Clique em **Rodar scan no workspace**.

O scanner embutido aplica regras **determinísticas** (padrão + AST + taint) — sem IA por arquivo.

## Onde ver o resultado

- **Painel CodeHero** (barra lateral): avaliação com contagem por severidade e lista de findings.
- **Problems** (Ctrl+Shift+M): sublinhados no editor.
- **Dashboard** (ícone de gráfico): anéis de **segurança** e **manutenibilidade**, débito técnico, compliance por regra.

## Configuração

Abra Settings e busque \`CodeHero\`, ou rode o comando **CodeHero: Abrir configurações**.

| Setting | Para quê |
|---|---|
| \`codehero.scanOnSave\` | Escaneia o arquivo ao salvar (sempre perfil nativo) |
| \`codehero.scanProfile\` | native / presence / java / full — **mesmo contrato** CLI, Action e MCP |
| \`codehero.syncToPortal\` | Após scan do workspace, envia SARIF ao portal (paridade CI) |
| \`codehero.enableCache\` | Cache incremental (mais rápido) |
| \`codehero.minSeverity\` | Filtra findings abaixo deste nível no painel |
| \`codehero.scannerCommand\` | Vazio = scanner embutido (recomendado). Só mude se souber o que faz. |

## Portal (opcional)

No https://codehero.web.app você pode:
1. Baixar este plugin
2. Escrever o dress code do time
3. Rodar uma prévia de repo GitHub público na Cloud

Scan local no plugin **não depende** do portal — funciona offline com as regras canônicas.
`,
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function emptySummary(): ScanSummary {
  return {
    findings: [],
    bySeverity: {},
    fileCountHint: 0,
    linesOfCode: 1,
    health: computeRepoHealth([], 1),
    ruleCatalog: [],
    codeGraph: null,
  };
}
