import * as vscode from "vscode";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface CodeHeroConfig {
  scanOnSave: boolean;
  enableCache: boolean;
  minSeverity: string;
  scannerCommand: string;
  orgId: string;
  projectId: string;
  serverUrl: string;
  token: string;
}

export function getConfig(): CodeHeroConfig {
  const c = vscode.workspace.getConfiguration("codehero");
  return {
    scanOnSave: c.get<boolean>("scanOnSave", true),
    enableCache: c.get<boolean>("enableCache", true),
    minSeverity: c.get<string>("minSeverity", "INFO"),
    scannerCommand: (c.get<string>("scannerCommand", "") ?? "").trim(),
    orgId: (c.get<string>("orgId", "") ?? "").trim(),
    projectId: (c.get<string>("projectId", "") ?? "").trim(),
    serverUrl: (c.get<string>("serverUrl", "") ?? "").trim(),
    token: (c.get<string>("token", "") ?? "").trim(),
  };
}

export interface ScannerInvocation {
  bin: string;
  argsPrefix: string[];
  label: string;
  /** Prefer false — shell:true on Windows breaks paths and can invoke npx accidentally. */
  shell: boolean;
}

/** Old docs / MCP examples used `npx hero-scan` — that package is not on npm. */
function isLegacyNpmScannerCommand(cmd: string): boolean {
  const c = cmd.toLowerCase().replace(/\s+/g, " ").trim();
  if (!c) return false;
  if (c === "hero-scan" || c === "@codehero/scanner") return true;
  if (/(?:^|\s)(?:npx|npm\s+exec)\b/.test(c) && /hero-scan|@codehero\/scanner/.test(c)) return true;
  return false;
}

function bundledInvocation(extensionPath: string): ScannerInvocation {
  const bundled = join(extensionPath, "bundled", "hero-scan.cjs");
  if (!existsSync(bundled)) {
    throw new Error(
      "Scanner embutido não encontrado neste VSIX. Reinstale o plugin pelo portal (Baixar .vsix) ou limpe codehero.scannerCommand.",
    );
  }
  return {
    // Extension Host's Node — more reliable than PATH `node` on Windows.
    bin: process.execPath,
    argsPrefix: [bundled],
    label: "bundled hero-scan",
    shell: false,
  };
}

function resolveScannerInvocation(extensionPath: string, scannerCommand: string): ScannerInvocation {
  if (scannerCommand && !isLegacyNpmScannerCommand(scannerCommand)) {
    const parts = scannerCommand.split(/\s+/).filter(Boolean);
    const bin = parts[0] ?? process.execPath;
    const rest = parts.slice(1);
    // `node script.js …` → use execPath so we don't depend on PATH.
    if (bin === "node" || bin === "node.exe") {
      return {
        bin: process.execPath,
        argsPrefix: rest,
        label: scannerCommand,
        shell: false,
      };
    }
    return {
      bin,
      argsPrefix: rest,
      label: scannerCommand,
      shell: process.platform === "win32",
    };
  }

  return bundledInvocation(extensionPath);
}

export function resolveScannerInvocationSafe(extensionPath: string, scannerCommand: string): ScannerInvocation {
  return resolveScannerInvocation(extensionPath, scannerCommand);
}
