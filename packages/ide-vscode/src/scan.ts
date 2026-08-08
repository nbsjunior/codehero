import { spawn } from "node:child_process";
import { isAbsolute, join, normalize } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ScannerInvocation } from "./config";
import { computeRepoHealth, type RepoHealth } from "./metrics";

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
  remediationEffortMin?: number;
  sddTemplateId?: string;
  risk?: string;
  howToFix?: string;
  strategy?: string;
  constraints?: string[];
  /** Provenance — same fields as portal FindingsBrowser */
  findingSource?: "native" | "imported" | null;
  tool?: string | null;
  originalRuleId?: string | null;
  engine?: string | null;
  isDependency?: boolean;
  alsoRuleIds?: string[];
}

export interface RuleCatalogEntry {
  id: string;
  name: string;
  severity: string;
  type: string;
  /** core | sonar-port | stub | overlay */
  implementation?: string | null;
  sonarKey?: string | null;
  /** Included in the live IDE/CLI matcher. */
  scannable?: boolean;
}

export interface CatalogStats {
  catalogCount: number;
  liveCount: number;
  stubCount: number;
  scanRuleCount: number;
  overlayCount: number;
}

export interface ScanSummary {
  findings: ScanFinding[];
  bySeverity: Record<string, number>;
  fileCountHint: number;
  linesOfCode: number;
  health: RepoHealth;
  rulesVersion?: string;
  rulesSource?: string;
  catalogVersion?: string;
  catalogStats?: CatalogStats;
  /**
   * Full informational catalog (live + stubs). Compliance ring uses
   * scannable entries only; stubs are listed as catalog-only.
   */
  ruleCatalog: RuleCatalogEntry[];
  /** Raw SARIF for optional portal sync (workspace scans). */
  sarif?: unknown;
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
    remediationEffortMin?: number;
    sddTemplateId?: string;
    risk?: string;
    reason?: string;
    howToFix?: string;
    strategy?: string;
    constraints?: string[];
    source?: "imported";
    tool?: string;
    originalRuleId?: string;
    engine?: string;
    isDependency?: boolean;
    alsoRuleIds?: string[];
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
  scanProfile?: string;
  spotbugsClasses?: string;
  /** Single-file save scans stay native-fast even if profile is presence. */
  forceNativeProfile?: boolean;
  serverUrl?: string;
  token?: string;
  orgId?: string;
  projectId?: string;
}): Promise<ScanSummary> {
  const inv = opts.invocation;
  const auth = {
    serverUrl: opts.serverUrl,
    token: opts.token,
    orgId: opts.orgId,
    projectId: opts.projectId,
  };

  const [rulesMeta, catalogMeta] = await Promise.all([
    fetchLiveRulesForScan({ ...auth, cwd: opts.cwd }),
    fetchInformationalCatalog(auth),
  ]);

  const profile =
    opts.forceNativeProfile ? "native" : (opts.scanProfile || "native").toLowerCase();
  const args = [...inv.argsPrefix, opts.target, "--sarif", ...profileToScannerArgs(profile)];
  if (opts.spotbugsClasses && (profile === "java" || profile === "full")) {
    args.push("--spotbugs-classes", opts.spotbugsClasses);
  }
  if (rulesMeta.file) args.push("--rules-file", rulesMeta.file);
  else args.push("--no-fetch-rules");
  if (opts.enableCache) args.push("--cache");

  const stdout = await execCapture(inv.bin, args, opts.cwd, inv.shell);
  const sarif = JSON.parse(stdout) as {
    runs?: Array<{ results?: SarifResult[]; properties?: { linesOfCode?: number } }>;
  };
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
    const p = result.properties;
    findings.push({
      ruleId: result.ruleId ?? "rule",
      message: p?.reason ?? result.message?.text ?? "",
      severity: sev,
      file,
      absolutePath,
      line: loc?.region?.startLine ?? 1,
      column: loc?.region?.startColumn ?? 1,
      endColumn: loc?.region?.endColumn ?? (loc?.region?.startColumn ?? 1) + 1,
      snippet: p?.snippet ?? loc?.region?.snippet?.text ?? "",
      fingerprint: result.partialFingerprints?.["heroHash/v1"],
      issueType: p?.issueType,
      remediationEffortMin:
        typeof p?.remediationEffortMin === "number" ? p.remediationEffortMin : undefined,
      sddTemplateId: p?.sddTemplateId,
      risk: p?.risk,
      howToFix: p?.howToFix,
      strategy: p?.strategy,
      constraints: p?.constraints,
      findingSource: p?.source === "imported" ? "imported" : "native",
      tool: p?.tool ?? null,
      originalRuleId: p?.originalRuleId ?? null,
      engine: p?.engine ?? null,
      isDependency: p?.isDependency === true,
      alsoRuleIds: Array.isArray(p?.alsoRuleIds) ? p!.alsoRuleIds : [],
    });
  }

  findings.sort((a, b) => SEV_ORDER.indexOf(b.severity) - SEV_ORDER.indexOf(a.severity));

  const bySeverity: Record<string, number> = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  const uniqueFiles = new Set(findings.map((f) => f.absolutePath)).size;
  const linesOfCode = Math.max(
    1,
    Number(sarif.runs?.[0]?.properties?.linesOfCode) || uniqueFiles || 1,
  );
  const health = computeRepoHealth(findings, linesOfCode);

  // Prefer full catalog for the dashboard; fall back to live-only metadata.
  const ruleCatalog =
    catalogMeta.rules.length > 0
      ? catalogMeta.rules
      : rulesMeta.ruleCatalog.map((r) => ({ ...r, scannable: true, implementation: null }));

  return {
    findings,
    bySeverity,
    fileCountHint: uniqueFiles || findings.length,
    linesOfCode,
    health,
    rulesVersion: rulesMeta.version,
    rulesSource: rulesMeta.source,
    catalogVersion: catalogMeta.version || rulesMeta.version,
    catalogStats: catalogMeta.stats ?? {
      catalogCount: ruleCatalog.length,
      liveCount: ruleCatalog.filter((r) => r.scannable !== false).length,
      stubCount: ruleCatalog.filter((r) => r.implementation === "stub").length,
      scanRuleCount: rulesMeta.liveCount,
      overlayCount: 0,
    },
    ruleCatalog,
    sarif,
  };
}

/** Same engines as contracts SCAN_PROFILES — expanded flags (no --profile) for older bundled CLIs. */
function profileToScannerArgs(profile: string): string[] {
  switch (profile) {
    case "presence":
      return ["--metrics", "--with-oxlint", "--with-opengrep", "--with-sca"];
    case "java":
      return ["--metrics", "--with-pmd", "--with-spotbugs"];
    case "full":
      return [
        "--metrics",
        "--with-oxlint",
        "--with-eslint",
        "--with-semgrep",
        "--with-opengrep",
        "--with-pmd",
        "--with-spotbugs",
        "--with-sca",
      ];
    default:
      return [];
  }
}

async function fetchLiveRulesForScan(opts: {
  serverUrl?: string;
  token?: string;
  orgId?: string;
  projectId?: string;
  cwd?: string;
}): Promise<{
  file: string;
  version: string;
  source: string;
  liveCount: number;
  ruleCatalog: RuleCatalogEntry[];
}> {
  const server = (opts.serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
  const url = new URL(`${server}/getActiveRules`);
  if (opts.orgId && opts.projectId) {
    url.searchParams.set("orgId", opts.orgId);
    url.searchParams.set("projectId", opts.projectId);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let body: {
    version?: string;
    liveCount?: number;
    rules?: Array<{ id: string; name: string; severity: string; type: string; implementation?: string }>;
  };
  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.error("CodeHero live rules fetch failed; using bundled scanner rules", err);
    return { file: "", version: "bundled", source: "bundled", liveCount: 0, ruleCatalog: [] };
  }
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    return { file: "", version: "bundled", source: "bundled", liveCount: 0, ruleCatalog: [] };
  }

  const dir = join(opts.cwd ?? tmpdir(), ".codehero-cache");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "active-rules.json");
  writeFileSync(file, JSON.stringify(body));
  const ruleCatalog = body.rules.map((r) => ({
    id: r.id,
    name: r.name,
    severity: r.severity,
    type: r.type,
    implementation: r.implementation ?? null,
    scannable: true,
  }));
  return {
    file,
    version: body.version ?? "unknown",
    source: "server",
    liveCount: body.liveCount ?? body.rules.length,
    ruleCatalog,
  };
}

async function fetchInformationalCatalog(opts: {
  serverUrl?: string;
  token?: string;
  orgId?: string;
  projectId?: string;
}): Promise<{
  version: string;
  rules: RuleCatalogEntry[];
  stats?: CatalogStats;
}> {
  const server = (opts.serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
  const url = new URL(`${server}/getRulesCatalog`);
  if (opts.orgId && opts.projectId) {
    url.searchParams.set("orgId", opts.orgId);
    url.searchParams.set("projectId", opts.projectId);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      version?: string;
      catalogCount?: number;
      liveCount?: number;
      stubCount?: number;
      scanRuleCount?: number;
      overlayCount?: number;
      rules?: Array<{
        id: string;
        name: string;
        severity: string;
        type: string;
        implementation?: string | null;
        sonarKey?: string | null;
        scannable?: boolean;
      }>;
    };
    const rules = (body.rules ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      severity: r.severity,
      type: r.type,
      implementation: r.implementation ?? null,
      sonarKey: r.sonarKey ?? null,
      scannable: r.scannable !== false && r.implementation !== "stub",
    }));
    return {
      version: body.version ?? "",
      rules,
      stats: {
        catalogCount: body.catalogCount ?? rules.length,
        liveCount: body.liveCount ?? rules.filter((r) => r.scannable).length,
        stubCount: body.stubCount ?? rules.filter((r) => r.implementation === "stub").length,
        scanRuleCount: body.scanRuleCount ?? body.liveCount ?? 0,
        overlayCount: body.overlayCount ?? 0,
      },
    };
  } catch (err) {
    console.error("CodeHero catalog fetch failed; compliance UI will use live rules only", err);
    return { version: "", rules: [] };
  }
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
