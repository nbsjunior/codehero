import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { dbClient } from "@/lib/firebaseDb";
import type {
  AdminIssueRow,
  AdminIssuesResult,
  AdminProjectRow,
  AdminRepoFindingCount,
  AdminRuleCause,
  PlatformSummary,
} from "@/lib/api";

const MAX_ISSUES = 800;
const PER_REPO_LIMIT = 120;

function worseRating(a: string, b: string): string {
  const order = ["A", "B", "C", "D", "E"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/** KPIs e buckets A–E a partir dos projetos já carregados do membro. */
export function summaryFromProjects(projects: AdminProjectRow[]): PlatformSummary {
  const bySecurityRating: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const byMaintainabilityRating: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const byQualityGate: Record<string, number> = {};
  const orgIds = new Set<string>();
  let repoCount = 0;
  let debtMinutes = 0;
  let openIssues = 0;
  let failingGates = 0;
  let worstSecurityRating = "A";
  let worstMaintainabilityRating = "A";

  for (const p of projects) {
    orgIds.add(p.orgId);
    repoCount += p.repoCount || p.repos.length;
    debtMinutes += p.debtMinutes || 0;
    openIssues += p.openIssues || 0;
    if (p.qualityGateStatus !== "PASSED") failingGates += 1;
    byQualityGate[p.qualityGateStatus || "PASSED"] =
      (byQualityGate[p.qualityGateStatus || "PASSED"] ?? 0) + 1;

    const sec = (p.securityRating || "A").toUpperCase();
    const maint = (p.maintainabilityRating || "A").toUpperCase();
    if (sec in bySecurityRating) bySecurityRating[sec]! += 1;
    else bySecurityRating.A! += 1;
    if (maint in byMaintainabilityRating) byMaintainabilityRating[maint]! += 1;
    else byMaintainabilityRating.A! += 1;

    worstSecurityRating = worseRating(worstSecurityRating, sec);
    worstMaintainabilityRating = worseRating(worstMaintainabilityRating, maint);
  }

  return {
    orgCount: orgIds.size,
    projectCount: projects.length,
    repoCount,
    debtMinutes,
    openIssues,
    failingGates,
    worstSecurityRating,
    worstMaintainabilityRating,
    bySecurityRating,
    byMaintainabilityRating,
    byQualityGate,
  };
}

/**
 * Achados abertos nos repos dos projetos do membro (leitura Firestore client).
 * Mesmo formato de `adminListAllIssues` para reutilizar Apontamentos / Relatório.
 */
export async function loadWorkspaceIssues(projects: AdminProjectRow[]): Promise<AdminIssuesResult> {
  const bySeverity: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const items: AdminIssueRow[] = [];
  const byRuleId = new Map<string, AdminRuleCause>();
  const byRepoId = new Map<string, AdminRepoFindingCount>();

  for (const p of projects) {
    for (const r of p.repos) {
      byRepoId.set(r.repoId, {
        repoId: r.repoId,
        repoName: r.name,
        projectId: p.projectId,
        projectName: p.name,
        orgId: p.orgId,
        orgName: p.orgName,
        count: 0,
      });
    }
  }

  const repoJobs = projects.flatMap((p) =>
    p.repos.map((r) => ({
      orgId: p.orgId,
      orgName: p.orgName,
      projectId: p.projectId,
      projectName: p.name,
      repoId: r.repoId,
      repoName: r.name,
    })),
  );

  const CONCURRENCY = 12;
  for (let i = 0; i < repoJobs.length && items.length < MAX_ISSUES; i += CONCURRENCY) {
    const chunk = repoJobs.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      chunk.map((meta) =>
        getDocs(
          query(
            collection(
              dbClient,
              "orgs",
              meta.orgId,
              "projects",
              meta.projectId,
              "repos",
              meta.repoId,
              "issues",
            ),
            where("status", "==", "open"),
            limit(PER_REPO_LIMIT),
          ),
        ).then((snap) => ({ meta, snap })),
      ),
    );

    for (const { meta, snap } of snaps) {
      const repoAgg = byRepoId.get(meta.repoId);
      if (repoAgg) repoAgg.count += snap.size;

      for (const d of snap.docs) {
        if (items.length >= MAX_ISSUES) break;
        const data = d.data();
        const severity = (data.severity as string | undefined) ?? "INFO";
        const source = (data.source as string | undefined) ?? "github-action";
        const ruleId = (data.ruleId as string | undefined) ?? "";
        bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
        bySource[source] = (bySource[source] ?? 0) + 1;

        const ruleAgg = byRuleId.get(ruleId) ?? {
          ruleId,
          message: (data.message as string | undefined) ?? "",
          severity,
          count: 0,
        };
        ruleAgg.count += 1;
        byRuleId.set(ruleId, ruleAgg);

        const lastSeen = data.lastSeen?.toDate?.()?.toISOString?.() ?? null;
        items.push({
          issueId: d.id,
          repoId: meta.repoId,
          repoName: meta.repoName,
          projectId: meta.projectId,
          projectName: meta.projectName,
          orgId: meta.orgId,
          orgName: meta.orgName,
          ruleId,
          severity,
          issueType: (data.issueType as string | undefined) ?? "CODE_SMELL",
          message: (data.message as string | undefined) ?? "",
          file: (data.file as string | undefined) ?? "",
          line: (data.line as number | undefined) ?? 0,
          source: source as AdminIssueRow["source"],
          lastSeen,
        });
      }
    }
  }

  const topCauses = [...byRuleId.values()].sort((a, b) => b.count - a.count).slice(0, 25);
  const ranked = [...byRepoId.values()].sort((a, b) => b.count - a.count);
  return {
    total: items.length,
    bySeverity,
    bySource,
    items,
    topCauses,
    mostFindings: ranked.slice(0, 15),
    leastFindings: [...ranked].reverse().slice(0, 15),
    nextCursor: null,
    truncated: items.length >= MAX_ISSUES,
  };
}
