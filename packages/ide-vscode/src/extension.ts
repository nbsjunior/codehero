import { execFileSync } from "node:child_process";
import * as vscode from "vscode";

const collection = vscode.languages.createDiagnosticCollection("codehero");

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(collection);
  context.subscriptions.push(
    vscode.commands.registerCommand("codehero.scanFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) scanPath(editor.document.uri.fsPath, editor.document.uri);
    }),
    vscode.commands.registerCommand("codehero.scanWorkspace", () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        void vscode.window.showWarningMessage("CodeHero: open a workspace folder first.");
        return;
      }
      scanPath(folder);
    }),
    vscode.commands.registerCommand("codehero.copySddHint", async () => {
      const hint =
        "MCP: get_issues → get_sdd_spec(fingerprint) → apply unified_diff → run_scan → submit_fix_result.";
      await vscode.env.clipboard.writeText(hint);
      void vscode.window.showInformationMessage("CodeHero: MCP fix hint copied.");
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== "file") return;
      if (vscode.workspace.getConfiguration("codehero").get("scanOnSave", true)) {
        scanPath(doc.uri.fsPath, doc.uri);
      }
    }),
  );
}

export function deactivate(): void {
  collection.dispose();
}

function scanPath(target: string, singleUri?: vscode.Uri): void {
  const cmd = vscode.workspace.getConfiguration("codehero").get<string>("scannerCommand") ?? "npx hero-scan";
  const parts = cmd.split(/\s+/).filter(Boolean);
  const bin = parts[0] ?? "npx";
  const args = [...parts.slice(1), target, "--sarif"];
  try {
    const stdout = execFileSync(bin, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      shell: process.platform === "win32",
    });
    const sarif = JSON.parse(stdout) as {
      runs?: Array<{
        results?: Array<{
          ruleId?: string;
          message?: { text?: string };
          locations?: Array<{
            physicalLocation?: {
              artifactLocation?: { uri?: string };
              region?: { startLine?: number; startColumn?: number; endColumn?: number };
            };
          }>;
        }>;
      }>;
    };
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const result of sarif.runs?.[0]?.results ?? []) {
      const loc = result.locations?.[0]?.physicalLocation;
      const uriPath = loc?.artifactLocation?.uri ?? target;
      const line = Math.max(0, (loc?.region?.startLine ?? 1) - 1);
      const startCol = Math.max(0, (loc?.region?.startColumn ?? 1) - 1);
      const endCol = Math.max(startCol + 1, (loc?.region?.endColumn ?? startCol + 2) - 1);
      const range = new vscode.Range(line, startCol, line, endCol);
      const diag = new vscode.Diagnostic(
        range,
        `${result.ruleId ?? "rule"}: ${result.message?.text ?? ""}`,
        vscode.DiagnosticSeverity.Warning,
      );
      diag.source = "codehero";
      const key = uriPath;
      const list = byFile.get(key) ?? [];
      list.push(diag);
      byFile.set(key, list);
    }
    if (singleUri) {
      collection.set(singleUri, byFile.values().next().value ?? []);
    } else {
      collection.clear();
      for (const [path, diags] of byFile) {
        collection.set(vscode.Uri.file(path), diags);
      }
    }
  } catch (err) {
    void vscode.window.showErrorMessage(`CodeHero scan failed: ${String(err)}`);
  }
}
