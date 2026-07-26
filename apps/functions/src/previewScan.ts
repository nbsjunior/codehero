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
import { RULES, matchPattern, type HeroRule } from "@codehero/contracts";
import { db } from "./lib/firebase.ts";

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

      const overlay = await loadOverlayRules(orgId, projectId);
      const rules: HeroRule[] = [...RULES, ...overlay];
      const findings = scanTree(extractDir, rules);

      const bySev: Record<string, number> = {};
      for (const f of findings) {
        bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
      }

      return {
        repo: `${parsed.owner}/${parsed.repo}`,
        findingCount: findings.length,
        bySeverity: bySev,
        topFindings: findings.slice(0, 40),
        overlayRuleCount: overlay.length,
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

async function loadOverlayRules(orgId?: string, projectId?: string): Promise<HeroRule[]> {
  const out: HeroRule[] = [];
  try {
    const globalSnap = await db.collection("platformDressRules").where("active", "==", true).limit(200).get();
    for (const d of globalSnap.docs) {
      const rule = normalizeOverlayRule(d.data());
      if (rule) out.push(rule);
    }

    if (orgId && projectId) {
      const projSnap = await db
        .collection(`orgs/${orgId}/projects/${projectId}/dressRules`)
        .where("active", "==", true)
        .limit(200)
        .get();
      for (const d of projSnap.docs) {
        const rule = normalizeOverlayRule(d.data());
        if (rule) out.push(rule);
      }
    }
  } catch (err) {
    console.error("loadOverlayRules failed (continuing with canonical rules only)", err);
  }
  return out;
}

function normalizeOverlayRule(raw: Record<string, unknown>): HeroRule | null {
  const pattern = raw.pattern as HeroRule["pattern"] | undefined;
  if (!pattern?.regex || typeof pattern.regex !== "string") return null;
  try {
    matchPattern(pattern, "smoke");
  } catch {
    console.warn("skipping overlay rule with invalid regex", raw.id);
    return null;
  }
  return raw as unknown as HeroRule;
}

interface PreviewFinding {
  ruleId: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  snippet: string;
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
