import { spawn } from "node:child_process";
import { isAbsolute, join, normalize } from "node:path";
import { resolveScannerInvocationSafe, type ScannerInvocation } from "./config";

export interface ScanFinding {
  ruleId: string;
  message: string;
  severity: string;
  file: string;
  absolutePath: string;
  line: number;
  column: number;
  endColumn: number;
  snippet: string;
  fingerprint?: string;
}

export interface ScanSummary {
  findings: ScanFinding[];
  bySeverity: Record<string, number>;
  fileCountHint: number;
}

interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: {
        startLine?: number;
        startColumn?: number;
        endColumn?: number;
        snippet?: { text?: string };
      };
    };
  }>;
  partialFingerprints?: Record<string, string>;
  properties?: {
    severity?: string;
    snippet?: string;
  };
}

const SEV_ORDER = ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"];

export async function runScan(opts: {
  target: string;
  invocation: ScannerInvocation;
  enableCache: boolean;
  cwd?: string;
  minSeverity?: string;
}): Promise<ScanSummary> {
  // Prefer PATH `node` for bundled scanner
  const inv =
    opts.invocation.label === "bundled hero-scan"
      ? { ...opts.invocation, bin: "node" }
      : opts.invocation;

  const args = [...inv.argsPrefix, opts.target, "--sarif"];
  if (opts.enableCache) args.push("--cache");

  const stdout = await execCapture(inv.bin, args, opts.cwd);
  const sarif = JSON.parse(stdout) as { runs?: Array<{ results?: SarifResult[] }> };
  const cwd = opts.cwd ?? process.cwd();
  const minIdx = SEV_ORDER.indexOf(opts.minSeverity ?? "INFO");

  const findings: ScanFinding[] = [];
  for (const result of sarif.runs?.[0]?.results ?? []) {
    const sev = (result.properties?.severity ?? levelToSeverity(result.level)).toUpperCase();
    if (SEV_ORDER.indexOf(sev) < minIdx) continue;

    const loc = result.locations?.[0]?.physicalLocation;
    const uriPath = loc?.artifactLocation?.uri ?? opts.target;
    const absolutePath = toAbsolute(uriPath, cwd);
    const file = toRelative(absolutePath, cwd);
    findings.push({
      ruleId: result.ruleId ?? "rule",
      message: result.message?.text ?? "",
      severity: sev,
      file,
      absolutePath,
      line: loc?.region?.startLine ?? 1,
      column: loc?.region?.startColumn ?? 1,
      endColumn: loc?.region?.endColumn ?? (loc?.region?.startColumn ?? 1) + 1,
      snippet: result.properties?.snippet ?? loc?.region?.snippet?.text ?? "",
      fingerprint: result.partialFingerprints?.["heroHash/v1"],
    });
  }

  findings.sort((a, b) => SEV_ORDER.indexOf(b.severity) - SEV_ORDER.indexOf(a.severity));

  const bySeverity: Record<string, number> = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  return { findings, bySeverity, fileCountHint: findings.length };
}

function levelToSeverity(level?: string): string {
  switch (level) {
    case "error":
      return "CRITICAL";
    case "warning":
      return "MAJOR";
    case "note":
      return "MINOR";
    default:
      return "INFO";
  }
}

function toAbsolute(uriPath: string, cwd: string): string {
  const cleaned = uriPath.replace(/^file:\/\//, "").replace(/^\//, process.platform === "win32" ? "" : "/");
  if (isAbsolute(cleaned) || /^[A-Za-z]:[\\/]/.test(cleaned)) return normalize(cleaned);
  return normalize(join(cwd, cleaned));
}

function toRelative(absolutePath: string, cwd: string): string {
  const normCwd = normalize(cwd).replace(/\\/g, "/");
  const normAbs = normalize(absolutePath).replace(/\\/g, "/");
  if (normAbs.toLowerCase().startsWith(normCwd.toLowerCase() + "/")) {
    return normAbs.slice(normCwd.length + 1);
  }
  return normAbs;
}

function execCapture(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `Não foi possível iniciar o scanner (${bin}). ${err.message}. Verifique se o Node.js está no PATH ou defina codehero.scannerCommand.`,
        ),
      );
    });
    child.on("close", (code) => {
      // hero-scan may exit 1 with --fail-on; SARIF still on stdout
      if (stdout.trim().startsWith("{")) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `Scanner encerrou com código ${code ?? "?"}. ${stderr.trim() || stdout.trim() || "Sem saída SARIF."}`,
        ),
      );
    });
  });
}

// re-export helper used by extension
export { resolveScannerInvocationSafe };
