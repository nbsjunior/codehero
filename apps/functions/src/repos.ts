import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, projectRef } from "./lib/firebase.ts";
import { deriveRepoName } from "./lib/repoName.ts";
import { recomputeProjectAggregate } from "./lib/projectAggregate.ts";
import { assertRepoQuota } from "./lib/quotas.ts";
import { generateIngestToken, storeIngestToken } from "./lib/ingestToken.ts";
import { requireVerifiedEmail } from "./lib/authz.ts";
import { parseGithubUrl } from "./lib/repoScan.ts";

interface AddRepoInput {
  orgId: string;
  projectId: string;
  repoUrl: string;
  name?: string;
}

/**
 * Adds another repo to an existing project — a project consolidates
 * quality/security across one or more repos (e.g. a product's backend +
 * frontend + infra repos, all reported as one consolidated result). Any org
 * member may add a repo; each gets its own ingestToken so its CI pipeline is
 * independent of siblings in the same project.
 */
export const addRepoToProject = onCall<AddRepoInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);

  const { orgId, projectId, repoUrl, name } = request.data ?? ({} as AddRepoInput);
  if (!orgId || !projectId || !repoUrl) {
    throw new HttpsError("invalid-argument", "orgId, projectId and repoUrl are required");
  }
  if (!parseGithubUrl(repoUrl)) {
    throw new HttpsError("invalid-argument", "repoUrl must be a github.com HTTPS URL");
  }

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (!member.exists && !admin.exists) {
    throw new HttpsError("permission-denied", "not a member of this org");
  }

  const pRef = projectRef(orgId, projectId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) throw new HttpsError("not-found", "project not found");

  const existing = await pRef.collection("repos").where("repoUrl", "==", repoUrl).limit(1).get();
  if (!existing.empty) {
    throw new HttpsError("already-exists", "this repo is already part of the project");
  }

  const orgProjects = await db.collection(`orgs/${orgId}/projects`).get();
  let orgRepoCount = 0;
  for (const p of orgProjects.docs) {
    const countSnap = await p.ref.collection("repos").count().get();
    orgRepoCount += countSnap.data().count;
  }
  await assertRepoQuota(orgId, orgRepoCount);

  const repoDocRef = pRef.collection("repos").doc();
  const ingestToken = generateIngestToken();
  await repoDocRef.set({
    name: name?.trim() || deriveRepoName(repoUrl),
    repoUrl,
    mainBranch: "main",
    debtMinutes: 0,
    maintainabilityRating: "A",
    securityRating: "A",
    qualityGateStatus: "PASSED",
    openIssues: 0,
    createdAt: FieldValue.serverTimestamp(),
    addedBy: uid,
  });

  await storeIngestToken(repoDocRef, ingestToken);
  await recomputeProjectAggregate(orgId, projectId);

  return { repoId: repoDocRef.id, ingestToken };
});

/** Lists a project's repos (id + summary metrics) — used by the consolidation views. */
export const listProjectRepos = onCall<{ orgId: string; projectId: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId } = request.data ?? ({} as { orgId: string; projectId: string });
  if (!orgId || !projectId) throw new HttpsError("invalid-argument", "orgId and projectId are required");

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (!member.exists && !admin.exists) throw new HttpsError("permission-denied", "not a member of this org");

  const reposSnap = await projectRef(orgId, projectId).collection("repos").orderBy("createdAt", "asc").get();
  return {
    repos: reposSnap.docs.map((d) => {
      const data = d.data();
      return {
        repoId: d.id,
        name: data.name ?? d.id,
        repoUrl: data.repoUrl ?? null,
        debtMinutes: data.debtMinutes ?? 0,
        maintainabilityRating: data.maintainabilityRating ?? "A",
        securityRating: data.securityRating ?? "A",
        qualityGateStatus: data.qualityGateStatus ?? "PASSED",
        openIssues: data.openIssues ?? 0,
        lastAnalyzedAt: data.lastAnalyzedAt?.toDate?.().toISOString() ?? null,
        autoScan: data.autoScan
          ? {
              enabled: !!data.autoScan.enabled,
              periodicityDays: data.autoScan.periodicityDays ?? 7,
              nextRunAt: data.autoScan.nextRunAt?.toDate?.().toISOString() ?? null,
              lastRunAt: data.autoScan.lastRunAt?.toDate?.().toISOString() ?? null,
            }
          : undefined,
      };
    }),
  };
});
