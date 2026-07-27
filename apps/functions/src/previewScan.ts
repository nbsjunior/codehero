import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { matchPattern, SDD_TEMPLATES, type HeroRule } from "@codehero/contracts";
import { loadActiveRules } from "./lib/activeRules.ts";

const require = createRequire(import.meta.url);

/**
 * One-click preview: GitHub público → zip → regras canônicas + dress rules → resumo.
 * Sem LLM no caminho de inspeção.
 */
export const previewRepoScan = onCall(
  { timeoutSeconds: 300, memory: "1GiB", cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Faça login para rodar a prévia.");

    const { repoUrl, orgId, projectId } = (request.data ?? {}) as {
      repoUrl?: string;
      orgId?: string;
      projectId?: string;
    };
    const parsed = parseGithubUrl((repoUrl ?? "").trim());
    if (!parsed) {
      throw new HttpsError(
        "invalid-argument",
        "Informe um repositório GitHub público (https://github.com/org/repo).",
      );
    }

    const work = join(tmpdir(), `codehero-preview-${uid.slice(0, 8)}-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    try {
      const zipPath = join(work, "repo.zip");
      await downloadGithubZip(parsed, zipPath);

      const extractDir = join(work, "src");
      mkdirSync(extractDir, { recursive: true });
      const AdmZip = loadAdmZip();
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

    const active = await loadActiveRules(orgId, projectId);
    const findings = scanTree(extractDir, active.rules);

    const bySev: Record<string, number> = {};
    for (const f of findings) {
      bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
    }

    return {
      repo: `${parsed.owner}/${parsed.repo}`,
      findingCount: findings.length,
      bySeverity: bySev,
      topFindings: findings.slice(0, 40),
      // Grouped, actionable remediation guidance per rule that fired — not
      // just a raw findings dump. Each group lists every affected file/line
      // (read "file by file") plus the deterministic fix strategy from the
      // SDD template catalog (same source the SDD Spec / MCP loop uses) —
      // no LLM call in this path, so this stays cheap regardless of repo size.
      recommendations: buildRecommendations(findings),
      overlayRuleCount: active.overlayCount,
      rulesVersion: active.version,
      scannedAt: new Date().toISOString(),
    };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("previewRepoScan failed", { uid, repoUrl, orgId, projectId, msg, err });
      // Avoid status "internal": Firebase strips those messages from the client.
      throw new HttpsError(
        "unavailable",
        `Falha ao analisar o repositório: ${msg.slice(0, 280)}`,
      );
    } finally {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  },
);

function loadAdmZip(): new (path: string) => { extractAllTo: (dir: string, overwrite: boolean) => void } {
  try {
    return require("adm-zip") as new (path: string) => {
      extractAllTo: (dir: string, overwrite: boolean) => void;
    };
  } catch (err) {
    console.error("adm-zip require failed", err);
    throw new HttpsError("failed-precondition", "Dependência adm-zip ausente no runtime da function.");
  }
}

async function downloadGithubZip(
  parsed: { owner: string; repo: string; branch: string },
  zipPath: string,
): Promise<void> {
  for (const branch of [parsed.branch, "main", "master"]) {
    const zipUrl = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/zip/refs/heads/${branch}`;
    const res = await fetch(zipUrl, {
      redirect: "follow",
      headers: { "User-Agent": "CodeHero-previewRepoScan" },
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

function parseGithubUrl(url: string): { owner: string; repo: string; branch: string } | null {
  const m = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/#?]+))?\/?$/i,
  );
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, ""), branch: m[3] ?? "main" };
}

interface PreviewFinding {
  ruleId: string;
  ruleName: string;
  sddTemplateId: string | null;
  severity: string;
  message: string;
  file: string;
  line: number;
  snippet: string;
}

export interface RecommendationGroup {
  ruleId: string;
  ruleName: string;
  severity: string;
  count: number;
  strategy: string;
  guidance: string;
  constraints: string[];
  files: Array<{ file: string; line: number }>;
}

const MAX_FILES_PER_GROUP = 25;

/**
 * Groups findings by rule and attaches the deterministic remediation
 * guidance (strategy/constraints) from SDD_TEMPLATES — the same catalog the
 * SDD Spec generator uses for the verified-fix MCP loop. Ordered worst
 * severity first, so the highest-impact fix to make is always group #1.
 */
function buildRecommendations(findings: PreviewFinding[]): RecommendationGroup[] {
  const byRule = new Map<
    string,
    { finding: PreviewFinding; count: number; files: Array<{ file: string; line: number }> }
  >();
  for (const f of findings) {
    const existing = byRule.get(f.ruleId);
    if (existing) {
      existing.count += 1;
      if (existing.files.length < MAX_FILES_PER_GROUP) existing.files.push({ file: f.file, line: f.line });
    } else {
      byRule.set(f.ruleId, { finding: f, count: 1, files: [{ file: f.file, line: f.line }] });
    }
  }

  const groups: RecommendationGroup[] = [];
  for (const { finding, count, files } of byRule.values()) {
    const template = finding.sddTemplateId ? SDD_TEMPLATES[finding.sddTemplateId] : undefined;
    groups.push({
      ruleId: finding.ruleId,
      ruleName: finding.ruleName,
      severity: finding.severity,
      count,
      strategy: template?.strategy ?? "manual_fix",
      guidance: template?.guidance ?? finding.message,
      constraints: template?.constraints ?? ["Preservar comportamento observável.", "Manter estilo do arquivo."],
      files,
    });
  }
  groups.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return groups;
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

function scanTree(root: string, rules: HeroRule[]): PreviewFinding[] {
  const findings: PreviewFinding[] = [];
  const files = listFiles(root, 400);
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (source.length > 1_500_000) continue;
    const rel = file.slice(root.length + 1).replace(/\\/g, "/");
    for (const rule of rules) {
      let matches;
      try {
        matches = matchPattern(rule.pattern, source);
      } catch {
        continue;
      }
      for (const m of matches) {
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          sddTemplateId: rule.sddTemplateId ?? null,
          severity: rule.severity,
          message: rule.message,
          file: rel,
          line: m.line,
          snippet: m.snippet.slice(0, 200),
        });
      }
    }
  }
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return findings;
}

function severityRank(s: string): number {
  return ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"].indexOf(s);
}

function listFiles(dir: string, budget: number, acc: string[] = []): string[] {
  if (acc.length >= budget || !existsSync(dir)) return acc;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (acc.length >= budget) break;
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".next") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(p, budget, acc);
    else {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (SCAN_EXTS.has(ext)) acc.push(p);
    }
  }
  return acc;
}
