import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./lib/firebase.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "not a platform admin");
}

/**
 * Global admin view: every project across every org, each with its repos —
 * for the platform admin's consolidation dashboard. Uses the Admin SDK
 * (bypasses per-org Firestore rules) — access is gated by membership in
 * platformAdmins/{uid}, which is only ever granted out-of-band
 * (scripts/seed-admin.mjs), never through a client-callable function, so a
 * regular user can never escalate themselves into this view.
 */
export const adminListAllProjects = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const orgsSnap = await db.collection("orgs").get();
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

  return { orgCount: orgsSnap.size, projects };
});

/** Lets the web app show/hide the "Admin" nav entry without a Firestore read. */
export const checkPlatformAdmin = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  return { isAdmin: snap.exists };
});

const MAX_ISSUES = 2000;

/**
 * Every open finding across every repo/org — "todos os apontamentos da
 * esteira" for the admin's consolidated graphs. Uses a single-field
 * collectionGroup query (`status == "open"`, no composite index needed) via
 * the Admin SDK, then joins in repo/project/org names from one pass over the
 * hierarchy. Findings carry `source` ("github-action" | "auto-scan" | "cli")
 * so the admin view can show which pipeline produced each one.
 */
export const adminListAllIssues = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const repoMeta = new Map<
    string,
    { orgId: string; orgName: string; projectId: string; projectName: string; repoName: string }
  >();
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
            repoMeta.set(r.id, {
              orgId: orgDoc.id,
              orgName,
              projectId: p.id,
              projectName,
              repoName: (r.data().name as string | undefined) ?? r.id,
            });
          }
        }),
      );
    }),
  );

  const issuesSnap = await db.collectionGroup("issues").where("status", "==", "open").limit(MAX_ISSUES).get();

  const bySeverity: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const items: Array<Record<string, unknown>> = [];

  for (const d of issuesSnap.docs) {
    const data = d.data();
    const repoId = d.ref.path.split("/")[5] ?? "";
    const meta = repoMeta.get(repoId);
    const severity = (data.severity as string | undefined) ?? "INFO";
    const source = (data.source as string | undefined) ?? "github-action";
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    bySource[source] = (bySource[source] ?? 0) + 1;
    items.push({
      issueId: d.id,
      repoId,
      repoName: meta?.repoName ?? repoId,
      projectId: meta?.projectId ?? null,
      projectName: meta?.projectName ?? "—",
      orgId: meta?.orgId ?? null,
      orgName: meta?.orgName ?? "—",
      ruleId: data.ruleId ?? "",
      severity,
      issueType: data.issueType ?? "CODE_SMELL",
      message: data.message ?? "",
      file: data.file ?? "",
      line: data.line ?? 0,
      source,
      lastSeen: data.lastSeen?.toDate?.().toISOString() ?? null,
    });
  }

  items.sort((a, b) => new Date((b.lastSeen as string) ?? 0).getTime() - new Date((a.lastSeen as string) ?? 0).getTime());

  return {
    total: items.length,
    bySeverity,
    bySource,
    items: items.slice(0, 500),
  };
});
