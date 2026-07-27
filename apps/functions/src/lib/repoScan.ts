import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  matchPattern,
  buildFindingFicha,
  severityToSarifLevel,
  HERO_FINGERPRINT_ALGO,
  type HeroRule,
  type SarifResult,
} from "@codehero/contracts";

const require = createRequire(import.meta.url);

/**
 * Shared "download a public GitHub repo and run the active rules against it"
 * logic — used by both the one-click portal preview (previewScan.ts) and the
 * weekly auto-scan job (autoScan.ts), so a repo's findings mean the same
 * thing regardless of which caller triggered the scan.
 */

export interface RepoScanFinding {
  ruleId: string;
  ruleName: string;
  issueType: string;
  sddTemplateId: string | null;
  severity: string;
  message: string;
  file: string;
  line: number;
  snippet: string;
  ficha: {
    risk: string;
    reason: string;
    howToFix: string;
    strategy: string;
    constraints: string[];
    referenceExample?: { before: string; after: string };
    cwe: string[];
    effortMin?: number;
  };
}

export function parseGithubUrl(url: string): { owner: string; repo: string; branch: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/#?]+))?\/?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, ""), branch: m[3] ?? "main" };
}

export interface AdmZipEntry {
  entryName: string;
  isDirectory: boolean;
}

export interface AdmZipInstance {
  extractAllTo: (dir: string, overwrite: boolean) => void;
  getEntries: () => AdmZipEntry[];
  extractEntryTo: (entry: AdmZipEntry, targetPath: string, maintainEntryPath: boolean, overwrite: boolean) => boolean;
}

export function loadAdmZip(): new (path: string) => AdmZipInstance {
  try {
    return require("adm-zip") as new (path: string) => AdmZipInstance;
  } catch (err) {
    console.error("adm-zip require failed", err);
    throw new HttpsError("failed-precondition", "Dependência adm-zip ausente no runtime da function.");
  }
}

export async function downloadGithubZip(
  parsed: { owner: string; repo: string; branch: string },
  zipPath: string,
): Promise<void> {
  for (const branch of [parsed.branch, "main", "master"]) {
    const zipUrl = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/zip/refs/heads/${branch}`;
    const res = await fetch(zipUrl, {
      redirect: "follow",
      headers: { "User-Agent": "CodeHero-repoScan" },
    });
    if (res.ok && res.body) {
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
      return;
    }
  }
  throw new HttpsError(
    "not-found",
    `Não foi possível baixar ${parsed.owner}/${parsed.repo}. Confirme que o repo é público.`,
  );
}

const SCAN_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".cs",
  ".sql",
  ".yml",
  ".yaml",
  ".sh",
  ".bash",
  ".tf",
  ".hcl",
]);

const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "dist", ".next"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Extracts only zip entries this scanner will actually read (matching
 * SCAN_EXTS, outside excluded dirs) instead of adm-zip's `extractAllTo`,
 * which writes every entry to disk — including node_modules, .git, images,
 * binaries — before any of it is examined. For a large real-world repo this
 * is most of the zip's bytes; skipping it cuts disk/time cost substantially
 * with no change in what actually gets scanned.
 */
export function extractScannableEntries(zip: AdmZipInstance, extractDir: string, budget: number): number {
  let extracted = 0;
  for (const entry of zip.getEntries()) {
    if (extracted >= budget) break;
    if (entry.isDirectory) continue;
    const parts = entry.entryName.split("/");
    if (parts.some((p) => EXCLUDED_DIR_NAMES.has(p))) continue;
    if (!SCAN_EXTS.has(extOf(entry.entryName))) continue;
    zip.extractEntryTo(entry, extractDir, true, true);
    extracted += 1;
  }
  return extracted;
}

export function listFiles(dir: string, budget: number, acc: string[] = []): string[] {
  if (acc.length >= budget || !existsSync(dir)) return acc;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (acc.length >= budget) break;
    if (EXCLUDED_DIR_NAMES.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(p, budget, acc);
    else if (SCAN_EXTS.has(extOf(name))) acc.push(p);
  }
  return acc;
}

export function severityRank(s: string): number {
  return ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"].indexOf(s);
}

export interface ScanTreeResult {
  findings: RepoScanFinding[];
  linesOfCode: number;
  filesScanned: number;
  /** True when the file budget was hit — coverage may be partial; there could be more matching files than were scanned. */
  truncated: boolean;
}

/** Default file cap per repo scan — raised from an earlier, much tighter 400
 *  now that extraction is selective (see extractScannableEntries), so the
 *  cost of a bigger budget is mostly read+regex time, not disk I/O. */
export const DEFAULT_FILE_BUDGET = 3000;
/** Files larger than this are skipped entirely (not read, not counted in LOC) — guards against pathological single-file cost (minified bundles, generated code, data dumps). */
const MAX_FILE_SIZE_BYTES = 3_000_000;

export function scanTree(root: string, rules: HeroRule[], fileBudget = DEFAULT_FILE_BUDGET): ScanTreeResult {
  const findings: RepoScanFinding[] = [];
  const files = listFiles(root, fileBudget);
  let linesOfCode = 0;
  let filesScanned = 0;
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (source.length > MAX_FILE_SIZE_BYTES) continue;
    filesScanned += 1;
    linesOfCode += source.length ? source.split("\n").length : 0;
    const rel = file.slice(root.length + 1).replace(/\\/g, "/");
    for (const rule of rules) {
      let matches;
      try {
        matches = matchPattern(rule.pattern, source);
      } catch {
        continue;
      }
      for (const m of matches) {
        const ficha = buildFindingFicha({
          ruleId: rule.id,
          ruleName: rule.name,
          message: rule.message,
          severity: rule.severity,
          issueType: rule.type,
          sddTemplateId: rule.sddTemplateId,
          cwe: rule.cwe,
          owasp: rule.owasp,
          remediationEffortMin: rule.remediationEffortMin,
          file: rel,
          line: m.line,
          snippet: m.snippet.slice(0, 200),
        });
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          issueType: rule.type,
          sddTemplateId: rule.sddTemplateId ?? null,
          severity: rule.severity,
          message: rule.message,
          file: rel,
          line: m.line,
          snippet: m.snippet.slice(0, 200),
          ficha: {
            risk: ficha.risk,
            reason: ficha.reason,
            howToFix: ficha.howToFix,
            strategy: ficha.strategy,
            constraints: ficha.constraints,
            referenceExample: ficha.referenceExample,
            cwe: ficha.cwe,
            effortMin: ficha.effortMin,
          },
        });
      }
    }
  }
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return { findings, linesOfCode, filesScanned, truncated: files.length >= fileBudget };
}

/** Clone (zip download) a public repo into a temp dir and scan it. Caller must clean up `extractDir`'s parent. */
export async function downloadAndScanRepo(
  repoUrl: string,
  rules: HeroRule[],
  workDir: string,
  fileBudget = DEFAULT_FILE_BUDGET,
): Promise<{
  owner: string;
  repo: string;
  findings: RepoScanFinding[];
  linesOfCode: number;
  filesScanned: number;
  truncated: boolean;
}> {
  const parsed = parseGithubUrl(repoUrl.trim());
  if (!parsed) {
    throw new HttpsError("invalid-argument", "Informe um repositório GitHub público (https://github.com/org/repo).");
  }
  mkdirSync(workDir, { recursive: true });
  const zipPath = join(workDir, "repo.zip");
  await downloadGithubZip(parsed, zipPath);

  const extractDir = join(workDir, "src");
  mkdirSync(extractDir, { recursive: true });
  const AdmZip = loadAdmZip();
  extractScannableEntries(new AdmZip(zipPath), extractDir, fileBudget);

  const { findings, linesOfCode, filesScanned, truncated } = scanTree(extractDir, rules, fileBudget);
  return { owner: parsed.owner, repo: parsed.repo, findings, linesOfCode, filesScanned, truncated };
}

/**
 * Converts scan-tree findings into the SARIF `results` shape that
 * `persistAnalysisResults` (used by both CI ingest and auto-scan) expects —
 * so an auto-scan's persisted issues are indistinguishable in structure from
 * ones ingested from the GitHub Action.
 */
export function toSarifResults(findings: RepoScanFinding[]): SarifResult[] {
  return findings.map((f) => {
    const normalized = f.snippet.trim().replace(/\s+/g, " ");
    const fp = createHash("sha256").update(`${f.ruleId}::${f.file}::${normalized}`).digest("hex").slice(0, 16);
    return {
      ruleId: f.ruleId,
      level: severityToSarifLevel(f.severity as never),
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: { startLine: f.line, snippet: { text: f.snippet } },
          },
        },
      ],
      partialFingerprints: { [HERO_FINGERPRINT_ALGO]: fp },
      properties: {
        severity: f.severity,
        issueType: f.issueType,
        remediationEffortMin: f.ficha.effortMin,
        sddTemplateId: f.sddTemplateId ?? undefined,
        snippet: f.snippet,
        risk: f.ficha.risk,
        reason: f.ficha.reason,
        howToFix: f.ficha.howToFix,
        strategy: f.ficha.strategy,
        constraints: f.ficha.constraints,
        referenceExample: f.ficha.referenceExample,
        cwe: f.ficha.cwe,
      },
    };
  });
}
