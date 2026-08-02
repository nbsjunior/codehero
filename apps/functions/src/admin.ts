import { onCall, HttpsError } from "firebase-functions/v2/https";
import { AggregateField, FieldPath, type DocumentReference } from "firebase-admin/firestore";
import { db } from "./lib/firebase.ts";
import { getPlatformSummaryBuckets } from "./lib/platformSummary.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "not a platform admin");
}

const ORGS_PAGE_SIZE = 25;

/**
 * Paginated admin view: one page of orgs (each with its projects and their
 * repos) at a time. Fanning out to EVERY org/project/repo in one call breaks
 * down well before 20k repos (thousands of queries, single invocation, no
 * memory/timeout override) — this bounds each call to a fixed page of orgs
 * regardless of platform size. Access gated by platformAdmins/{uid}, granted
 * only out-of-band (never client-writable).
 */
export const adminListAllProjects = onCall(
  { memory: "1GiB", timeoutSeconds: 540 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
    await requirePlatformAdmin(uid);

    const { cursor, limit } = (request.data ?? {}) as { cursor?: string; limit?: number };
    const pageSize = Math.min(100, Math.max(1, limit ?? ORGS_PAGE_SIZE));

    let orgsQuery = db.collection("orgs").orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) orgsQuery = orgsQuery.startAfter(cursor);
    const orgsSnap = await orgsQuery.get();

    const projects: Array<Record<string, unknown>> = [];
    await Promise.all(
      orgsSnap.docs.map(async (orgDoc) => {
        const org = orgDoc.data();
        const projectsSnap = await orgDoc.ref.collection("projects").get();
        await Promise.all(
          projectsSnap.docs.map(async (p) => {
            const data = p.data();
            const reposSnap = await p.ref.collection("repos").get();
            const repos = reposSnap.docs.map((r) => {
              const rd = r.data();
              return {
                repoId: r.id,
                name: rd.name ?? r.id,
                repoUrl: rd.repoUrl ?? null,
                debtMinutes: rd.debtMinutes ?? 0,
                maintainabilityRating: rd.maintainabilityRating ?? "A",
                securityRating: rd.securityRating ?? "A",
                qualityGateStatus: rd.qualityGateStatus ?? "PASSED",
                openIssues: rd.openIssues ?? 0,
                lastAnalyzedAt: rd.lastAnalyzedAt?.toDate?.().toISOString() ?? null,
                autoScan: rd.autoScan
                  ? {
                      enabled: !!rd.autoScan.enabled,
                      periodicityDays: rd.autoScan.periodicityDays ?? 7,
                      nextRunAt: rd.autoScan.nextRunAt?.toDate?.().toISOString() ?? null,
                      lastRunAt: rd.autoScan.lastRunAt?.toDate?.().toISOString() ?? null,
                    }
                  : undefined,
              };
            });
            projects.push({
              orgId: orgDoc.id,
              orgName: org.name ?? orgDoc.id,
              projectId: p.id,
              name: data.name ?? p.id,
              repoCount: repos.length,
              debtMinutes: data.debtMinutes ?? 0,
              maintainabilityRating: data.maintainabilityRating ?? "A",
              securityRating: data.securityRating ?? "A",
              qualityGateStatus: data.qualityGateStatus ?? "PASSED",
              openIssues: data.openIssues ?? 0,
              lastAnalyzedAt: data.lastAnalyzedAt?.toDate?.().toISOString() ?? null,
              repos,
            });
          }),
        );
      }),
    );

    const nextCursor = orgsSnap.docs.length === pageSize ? orgsSnap.docs[orgsSnap.docs.length - 1]!.id : null;
    return { orgCount: orgsSnap.size, projects, nextCursor };
  },
);

/**
 * O(1)-ish platform KPIs: unfiltered count()/sum() aggregation queries
 * (safe — no composite index needed, unlike a filtered collectionGroup
 * query) for the additive numbers, plus the incrementally-maintained
 * rating/gate buckets (see platformSummary.ts) for the two values that
 * would otherwise need a filtered query to answer.
 */
export const adminGetPlatformSummary = onCall({ memory: "512MiB", timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const emptyBuckets = {
    byQualityGate: {} as Record<string, number>,
    bySecurityRating: {} as Record<string, number>,
    byMaintainabilityRating: {} as Record<string, number>,
  };

  let orgCount = 0;
  let projectCount = 0;
  let repoCount = 0;
  let debtMinutes = 0;
  let openIssues = 0;
  let buckets = emptyBuckets;

  try {
    const [orgCountSnap, projectCountSnap, repoAggSnap, bucketSnap] = await Promise.all([
      db.collection("orgs").count().get(),
      db.collectionGroup("projects").count().get(),
      db
        .collectionGroup("repos")
        .aggregate({
          count: AggregateField.count(),
          debtMinutes: AggregateField.sum("debtMinutes"),
          openIssues: AggregateField.sum("openIssues"),
        })
        .get(),
      getPlatformSummaryBuckets(),
    ]);
    orgCount = orgCountSnap.data().count;
    projectCount = projectCountSnap.data().count;
    repoCount = repoAggSnap.data().count;
    debtMinutes = repoAggSnap.data().debtMinutes ?? 0;
    openIssues = repoAggSnap.data().openIssues ?? 0;
    buckets = bucketSnap;
  } catch (err) {
    console.error("adminGetPlatformSummary aggregation failed", err);
    // Fall back to counting orgs only — client will fill rating bars from loaded projects.
    try {
      const orgSnap = await db.collection("orgs").count().get();
      orgCount = orgSnap.data().count;
    } catch {
      /* ignore */
    }
  }

  // If incremental rating buckets are empty, derive from project docs (paginated sample).
  if (
    Object.values(buckets.bySecurityRating).every((n) => !n) &&
    Object.values(buckets.byMaintainabilityRating).every((n) => !n)
  ) {
    try {
      const derived = await deriveRatingBucketsFromProjects();
      buckets = { ...buckets, ...derived };
    } catch (err) {
      console.error("deriveRatingBucketsFromProjects failed", err);
    }
  }

  const ratingOrder = ["E", "D", "C", "B", "A"];
  const worstSecurityRating =
    ratingOrder.find((r) => (buckets.bySecurityRating[r] ?? 0) > 0) ?? "A";
  const worstMaintainabilityRating =
    ratingOrder.find((r) => (buckets.byMaintainabilityRating[r] ?? 0) > 0) ?? "A";
  const failingGates = buckets.byQualityGate.FAILED ?? 0;

  return {
    orgCount,
    projectCount,
    repoCount,
    debtMinutes,
    openIssues,
    failingGates,
    worstSecurityRating,
    worstMaintainabilityRating,
    bySecurityRating: buckets.bySecurityRating,
    byMaintainabilityRating: buckets.byMaintainabilityRating,
    byQualityGate: buckets.byQualityGate,
  };
});

async function deriveRatingBucketsFromProjects(): Promise<{
  bySecurityRating: Record<string, number>;
  byMaintainabilityRating: Record<string, number>;
  byQualityGate: Record<string, number>;
}> {
  const bySecurityRating: Record<string, number> = {};
  const byMaintainabilityRating: Record<string, number> = {};
  const byQualityGate: Record<string, number> = {};
  const orgsSnap = await db.collection("orgs").limit(100).get();
  await Promise.all(
    orgsSnap.docs.map(async (orgDoc) => {
      const projectsSnap = await orgDoc.ref.collection("projects").get();
      for (const p of projectsSnap.docs) {
        const data = p.data();
        const sec = String(data.securityRating ?? "A");
        const maint = String(data.maintainabilityRating ?? "A");
        const gate = String(data.qualityGateStatus ?? "PASSED");
        bySecurityRating[sec] = (bySecurityRating[sec] ?? 0) + 1;
        byMaintainabilityRating[maint] = (byMaintainabilityRating[maint] ?? 0) + 1;
        byQualityGate[gate] = (byQualityGate[gate] ?? 0) + 1;
      }
    }),
  );
  return { bySecurityRating, byMaintainabilityRating, byQualityGate };
}

/** Lets the web app show/hide the "Admin" nav entry without a Firestore read. */
export const checkPlatformAdmin = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  return { isAdmin: snap.exists };
});

const MAX_ISSUES = 2000;

/**
 * Every open finding across every repo/org — consolidated admin view.
 * Queries each repo's issues subcollection (COLLECTION scope — auto-indexed)
 * rather than collectionGroup+status, which needs a single-field exemption
 * that firebase-tools often fails to deploy against the codehero database.
 */
export const adminListAllIssues = onCall({ memory: "1GiB", timeoutSeconds: 540 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  type RepoMeta = {
    orgId: string;
    orgName: string;
    projectId: string;
    projectName: string;
    repoName: string;
    ref: DocumentReference;
  };

  const repos: RepoMeta[] = [];
  const orgsSnap = await db.collection("orgs").get();
  await Promise.all(
    orgsSnap.docs.map(async (orgDoc) => {
      const orgName = (orgDoc.data().name as string | undefined) ?? orgDoc.id;
      const projectsSnap = await orgDoc.ref.collection("projects").get();
      await Promise.all(
        projectsSnap.docs.map(async (p) => {
          const projectName = (p.data().name as string | undefined) ?? p.id;
          const reposSnap = await p.ref.collection("repos").get();
          for (const r of reposSnap.docs) {
            repos.push({
              orgId: orgDoc.id,
              orgName,
              projectId: p.id,
              projectName,
              repoName: (r.data().name as string | undefined) ?? r.id,
              ref: r.ref,
            });
          }
        }),
      );
    }),
  );

  const bySeverity: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const items: Array<Record<string, unknown>> = [];

  type RuleAgg = { ruleId: string; message: string; severity: string; count: number };
  const byRuleId = new Map<string, RuleAgg>();
  type RepoAgg = {
    repoId: string;
    repoName: string;
    projectId: string;
    projectName: string;
    orgId: string;
    orgName: string;
    count: number;
  };
  // Seed every known repo at 0 so repos with no open issues correctly show
  // up as "least findings" (rather than being absent from the ranking).
  const byRepoId = new Map<string, RepoAgg>(
    repos.map((r) => [
      r.ref.id,
      {
        repoId: r.ref.id,
        repoName: r.repoName,
        projectId: r.projectId,
        projectName: r.projectName,
        orgId: r.orgId,
        orgName: r.orgName,
        count: 0,
      },
    ]),
  );

  const CONCURRENCY = 20;
  for (let i = 0; i < repos.length && items.length < MAX_ISSUES; i += CONCURRENCY) {
    const chunk = repos.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      chunk.map((r) =>
        r.ref.collection("issues").where("status", "==", "open").limit(Math.min(200, MAX_ISSUES - items.length)).get(),
      ),
    );
    for (let j = 0; j < chunk.length; j++) {
      const meta = chunk[j]!;
      const issuesSnap = snaps[j]!;

      // Repo-level counts reflect every open issue for the repo (not capped
      // by the MAX_ISSUES-limited `items` list below), so "most/least
      // findings" ranking stays accurate even once the global item cap hits.
      const repoAgg = byRepoId.get(meta.ref.id);
      if (repoAgg) repoAgg.count += issuesSnap.size;

      for (const d of issuesSnap.docs) {
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

        items.push({
          issueId: d.id,
          repoId: meta.ref.id,
          repoName: meta.repoName,
          projectId: meta.projectId,
          projectName: meta.projectName,
          orgId: meta.orgId,
          orgName: meta.orgName,
          ruleId,
          severity,
          issueType: data.issueType ?? "CODE_SMELL",
          message: data.message ?? "",
          file: data.file ?? "",
          line: data.line ?? 0,
          source,
          lastSeen: data.lastSeen?.toDate?.().toISOString() ?? null,
        });
      }
    }
  }

  items.sort((a, b) => new Date((b.lastSeen as string) ?? 0).getTime() - new Date((a.lastSeen as string) ?? 0).getTime());

  const topCauses = [...byRuleId.values()].sort((a, b) => b.count - a.count).slice(0, 15);
  const repoRanking = [...byRepoId.values()].sort((a, b) => b.count - a.count);
  const mostFindings = repoRanking.slice(0, 10);
  const leastFindings = repoRanking.slice(-10).reverse();

  return {
    total: items.length,
    bySeverity,
    bySource,
    items: items.slice(0, 500),
    topCauses,
    mostFindings,
    leastFindings,
  };
});
