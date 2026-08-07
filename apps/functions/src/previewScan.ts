import { onCall, HttpsError } from "firebase-functions/v2/https";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadActiveRules } from "./lib/activeRules.ts";
import { downloadAndScanRepo, severityRank, type RepoScanFinding } from "./lib/repoScan.ts";
import {
  assertBuildQuota,
  assertPreviewQuota,
  incrementBuildQuota,
  incrementPreviewQuota,
  requireVerifiedEmail,
} from "./lib/quotas.ts";
import { portalCallableOpts } from "./lib/httpSecurity.ts";

/**
 * One-click preview: GitHub público → zip → regras canônicas + dress rules → resumo.
 * Sem LLM no caminho de inspeção.
 */
export const previewRepoScan = onCall(
  { ...portalCallableOpts, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Faça login para rodar a prévia.");
    await requireVerifiedEmail(uid);

    const { repoUrl, orgId, projectId } = (request.data ?? {}) as {
      repoUrl?: string;
      orgId?: string;
      projectId?: string;
    };

    await assertPreviewQuota(uid);
    if (orgId) await assertBuildQuota(orgId);

    const work = join(tmpdir(), `codehero-preview-${uid.slice(0, 8)}-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    try {
      const active = await loadActiveRules(orgId, projectId);
      const { owner, repo, findings, filesScanned, truncated } = await downloadAndScanRepo(
        repoUrl ?? "",
        active.rules,
        work,
      );
      await incrementPreviewQuota(uid);
      if (orgId) await incrementBuildQuota(orgId).catch(() => {});

      const bySev: Record<string, number> = {};
      for (const f of findings) {
        bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
      }

      return {
        repo: `${owner}/${repo}`,
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
        filesScanned,
        // True when the file budget was hit — there may be more matching
        // files in the repo than this preview actually scanned.
        truncated,
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

export interface RecommendationGroup {
  ruleId: string;
  ruleName: string;
  severity: string;
  count: number;
  risk: string;
  reason: string;
  strategy: string;
  guidance: string;
  constraints: string[];
  referenceExample?: { before: string; after: string };
  files: Array<{ file: string; line: number }>;
}

const MAX_FILES_PER_GROUP = 25;

/**
 * Groups findings by rule and attaches the deterministic remediation
 * guidance (strategy/constraints) from SDD_TEMPLATES — the same catalog the
 * SDD Spec generator uses for the verified-fix MCP loop. Ordered worst
 * severity first, so the highest-impact fix to make is always group #1.
 */
function buildRecommendations(findings: RepoScanFinding[]): RecommendationGroup[] {
  const byRule = new Map<
    string,
    { finding: RepoScanFinding; count: number; files: Array<{ file: string; line: number }> }
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
    const ficha = finding.ficha;
    groups.push({
      ruleId: finding.ruleId,
      ruleName: finding.ruleName,
      severity: finding.severity,
      count,
      risk: ficha.risk,
      reason: ficha.reason,
      strategy: ficha.strategy,
      guidance: ficha.howToFix,
      constraints: ficha.constraints,
      referenceExample: ficha.referenceExample,
      files,
    });
  }
  groups.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return groups;
}
