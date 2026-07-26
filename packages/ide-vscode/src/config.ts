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
}

function resolveScannerInvocation(extensionPath: string, scannerCommand: string): ScannerInvocation {
  if (scannerCommand) {
    const parts = scannerCommand.split(/\s+/).filter(Boolean);
    return {
      bin: parts[0] ?? "node",
      argsPrefix: parts.slice(1),
      label: scannerCommand,
    };
  }

  const bundled = join(extensionPath, "bundled", "hero-scan.cjs");
  if (!existsSync(bundled)) {
    throw new Error(
      "Scanner embutido não encontrado neste VSIX. Reinstale o plugin pelo portal ou defina codehero.scannerCommand.",
    );
  }
  return {
    bin: "node",
    argsPrefix: [bundled],
    label: "bundled hero-scan",
  };
}

/** @deprecated alias — always uses PATH `node` for the bundled scanner */
export function resolveScannerInvocationSafe(extensionPath: string, scannerCommand: string): ScannerInvocation {
  return resolveScannerInvocation(extensionPath, scannerCommand);
}
