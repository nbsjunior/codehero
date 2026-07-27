import { spawn } from "node:child_process";
import { isAbsolute, join, normalize } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ScannerInvocation } from "./config";

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
  issueType?: string;
  sddTemplateId?: string;
  risk?: string;
  howToFix?: string;
  strategy?: string;
  constraints?: string[];
}

export interface RuleCatalogEntry {
  id: string;
  name: string;
  severity: string;
  type: string;
}

export interface ScanSummary {
  findings: ScanFinding[];
  bySeverity: Record<string, number>;
  fileCountHint: number;
  rulesVersion?: string;
  rulesSource?: string;
  /** Full active rule catalog fetched alongside the scan — lets the
   *  dashboard show which rules are COMPLIANT (zero findings), not just
   *  which findings exist. Empty when rules came from the bundled offline
   *  fallback (no catalog metadata attached to that path yet). */
  ruleCatalog: RuleCatalogEntry[];
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
    issueType?: string;
    sddTemplateId?: string;
    risk?: string;
    reason?: string;
    howToFix?: string;
    strategy?: string;
    constraints?: string[];
  };
}

const SEV_ORDER = ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"];
const DEFAULT_SERVER = "https://codehero.web.app/api";

export async function runScan(opts: {
  target: string;
  invocation: ScannerInvocation;
  enableCache: boolean;
  cwd?: string;
  minSeverity?: string;
  serverUrl?: string;
  token?: string;
  orgId?: string;
  projectId?: string;
}): Promise<ScanSummary> {
  const inv = opts.invocation;
  const rulesMeta = await fetchRulesForScan({
    serverUrl: opts.serverUrl,
    token: opts.token,
    orgId: opts.orgId,
    projectId: opts.projectId,
    cwd: opts.cwd,
  });

  const args = [...inv.argsPrefix, opts.target, "--sarif"];
  if (rulesMeta.file) args.push("--rules-file", rulesMeta.file);
  else args.push("--no-fetch-rules");
  if (opts.enableCache) args.push("--cache");

  const stdout = await execCapture(inv.bin, args, opts.cwd, inv.shell);
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
      message: result.properties?.reason ?? result.message?.text ?? "",
      severity: sev,
      file,
      absolutePath,
      line: loc?.region?.startLine ?? 1,
      column: loc?.region?.startColumn ?? 1,
      endColumn: loc?.region?.endColumn ?? (loc?.region?.startColumn ?? 1) + 1,
      snippet: result.properties?.snippet ?? loc?.region?.snippet?.text ?? "",
      fingerprint: result.partialFingerprints?.["heroHash/v1"],
      issueType: result.properties?.issueType,
      sddTemplateId: result.properties?.sddTemplateId,
      risk: result.properties?.risk,
      howToFix: result.properties?.howToFix,
      strategy: result.properties?.strategy,
      constraints: result.properties?.constraints,
    });
  }

  findings.sort((a, b) => SEV_ORDER.indexOf(b.severity) - SEV_ORDER.indexOf(a.severity));

  const bySeverity: Record<string, number> = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  return {
    findings,
    bySeverity,
    fileCountHint: findings.length,
    rulesVersion: rulesMeta.version,
    rulesSource: rulesMeta.source,
    ruleCatalog: rulesMeta.ruleCatalog,
  };
}

async function fetchRulesForScan(opts: {
  serverUrl?: string;
  token?: string;
  orgId?: string;
  projectId?: string;
  cwd?: string;
}): Promise<{ file: string; version: string; source: string; ruleCatalog: RuleCatalogEntry[] }> {
  const server = (opts.serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
  const url = new URL(`${server}/getActiveRules`);
  if (opts.orgId && opts.projectId) {
    url.searchParams.set("orgId", opts.orgId);
    url.searchParams.set("projectId", opts.projectId);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let body: { version?: string; rules?: Array<{ id: string; name: string; severity: string; type: string }> };
  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    // Offline / first-run: scan with rules baked into the VSIX. No catalog
    // metadata available for the compliance dashboard on this path.
    console.error("CodeHero rules fetch failed; using bundled scanner rules", err);
    return { file: "", version: "bundled", source: "bundled", ruleCatalog: [] };
  }
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    return { file: "", version: "bundled", source: "bundled", ruleCatalog: [] };
  }

  const dir = join(opts.cwd ?? tmpdir(), ".codehero-cache");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "active-rules.json");
  writeFileSync(file, JSON.stringify(body));
  const ruleCatalog = body.rules.map((r) => ({ id: r.id, name: r.name, severity: r.severity, type: r.type }));
  return { file, version: body.version ?? "unknown", source: "server", ruleCatalog };
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

function execCapture(bin: string, args: string[], cwd?: string, shell = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      shell,
      windowsHide: true,
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
          `Não foi possível iniciar o scanner (${bin}). ${err.message}. Verifique se o Node.js está no PATH.`,
        ),
      );
    });
    child.on("close", (code) => {
      if (stdout.trim().startsWith("{")) {
        resolve(stdout);
        return;
      }
      const detail = (stderr.trim() || stdout.trim() || "Sem saída do relatório de análise.").slice(0, 800);
      reject(new Error(`Scanner encerrou com código ${code ?? "?"}. ${detail}`));
    });
  });
}
