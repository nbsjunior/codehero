import * as vscode from "vscode";
import { FindingsTreeProvider, type FindingItem } from "./findingsView";
import { DashboardPanel } from "./dashboardView";
import { getConfig, resolveScannerInvocationSafe } from "./config";
import { runScan, type ScanFinding, type ScanSummary } from "./scan";

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
    vscode.commands.registerCommand("codehero.copyFinding", async (item: FindingItem) => {
      const text = `${item.finding.ruleId}: ${item.finding.message}\n${item.finding.file}:${item.finding.line}`;
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage("CodeHero: finding copiado.");
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
          serverUrl: cfg.serverUrl || undefined,
          token: cfg.token || undefined,
          orgId: cfg.orgId || undefined,
          projectId: cfg.projectId || undefined,
        });
      },
    );

    applyResults(summary, opts);
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
      `${f.ruleId}: ${f.message}`,
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
  const blockers = summary.bySeverity.BLOCKER ?? 0;
  const criticals = summary.bySeverity.CRITICAL ?? 0;
  const rulesInfo = summary.rulesVersion
    ? ` · regras ${summary.rulesSource ?? "server"} ${summary.rulesVersion.slice(0, 8)}`
    : "";
  void vscode.window.showInformationMessage(
    `CodeHero: ${summary.findings.length} finding(s) · BLOCKER ${blockers} · CRITICAL ${criticals}${rulesInfo}`,
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

## Configuração

Abra Settings e busque \`CodeHero\`, ou rode o comando **CodeHero: Abrir configurações**.

| Setting | Para quê |
|---|---|
| \`codehero.scanOnSave\` | Escaneia o arquivo ao salvar |
| \`codehero.enableCache\` | Cache incremental (mais rápido) |
| \`codehero.minSeverity\` | Filtra findings abaixo deste nível no painel |
| \`codehero.scannerCommand\` | Vazio = scanner embutido (recomendado). Só mude se souber o que faz. |

## Portal (opcional)

No https://codehero.web.app você pode:
1. Baixar este plugin
2. Escrever o dress code do time
3. Rodar uma prévia de repo GitHub público no Firebase

Scan local no plugin **não depende** do portal — funciona offline com as regras canônicas.
`,
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function emptySummary(): ScanSummary {
  return { findings: [], bySeverity: {}, fileCountHint: 0, ruleCatalog: [] };
}

// silence unused in case tree uses lastFindings later
void lastFindings;
