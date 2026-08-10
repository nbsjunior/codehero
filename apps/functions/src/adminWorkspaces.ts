import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { slugifyProjectName } from "@codehero/contracts";
import { db } from "./lib/firebase.ts";
import { deriveRepoName } from "./lib/repoName.ts";
import { recomputeProjectAggregate } from "./lib/projectAggregate.ts";
import { getOrgQuotas } from "./lib/quotas.ts";
import { generateIngestToken, storeIngestToken } from "./lib/ingestToken.ts";
import { requireVerifiedEmail, requireOrgRole, consumeRateLimit } from "./lib/authz.ts";
import { parseGithubUrl } from "./lib/repoScan.ts";
import { portalCallableOpts } from "./lib/httpSecurity.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "platform admin required");
}

async function isPlatformAdmin(uid: string): Promise<boolean> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  return snap.exists;
}

function normalizeRepoUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const u = String(item ?? "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

interface AdminCreateProjectInput {
  orgId?: string;
  orgName?: string;
  projectName: string;
  repoUrls?: string[];
}

/**
 * Workspace wizard: create (or reuse) an org, create a project, attach zero or
 * more repos in one shot, return ingest tokens once.
 *
 * Authz:
 * - new org → any verified user (caller becomes owner)
 * - existing org → platform admin, or org owner/admin
 */
export const adminCreateProject = onCall<AdminCreateProjectInput>(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);

  const data = request.data ?? ({} as AdminCreateProjectInput);
  const projectName = String(data.projectName ?? "").trim();
  if (!projectName) throw new HttpsError("invalid-argument", "projectName is required");

  const repoUrls = normalizeRepoUrls(data.repoUrls);
  for (const u of repoUrls) {
    if (!parseGithubUrl(u)) {
      throw new HttpsError("invalid-argument", "repoUrls must be github.com HTTPS URLs");
    }
  }

  let orgId = String(data.orgId ?? "").trim();
  const orgName = String(data.orgName ?? "").trim();
  const platformAdmin = await isPlatformAdmin(uid);

  if (!orgId) {
    if (!orgName) throw new HttpsError("invalid-argument", "orgName is required when creating a new org");
    if (!platformAdmin) await consumeRateLimit(`provision:${uid}`, 10);
    const orgRef = db.collection("orgs").doc();
    orgId = orgRef.id;
    await orgRef.set({
      name: orgName,
      ownerUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await orgRef.collection("members").doc(uid).set({
      uid,
      role: "owner",
      joinedAt: FieldValue.serverTimestamp(),
    });
  } else {
    const orgSnap = await db.doc(`orgs/${orgId}`).get();
    if (!orgSnap.exists) throw new HttpsError("not-found", "org not found");
    if (!platformAdmin) {
      await requireOrgRole(orgId, uid, ["owner", "admin"]);
      await consumeRateLimit(`createProject:${uid}:${orgId}`, 20);
    }
  }

  const orgProjects = await db.collection(`orgs/${orgId}/projects`).get();
  let orgRepoCount = 0;
  for (const p of orgProjects.docs) {
    const countSnap = await p.ref.collection("repos").count().get();
    orgRepoCount += countSnap.data().count;
  }

  const q = await getOrgQuotas(orgId);
  if (orgRepoCount + repoUrls.length > q.maxRepos) {
    throw new HttpsError(
      "resource-exhausted",
      `Cota de repositórios seria excedida (${orgRepoCount + repoUrls.length} > ${q.maxRepos}).`,
    );
  }

  const projectDoc = db.collection(`orgs/${orgId}/projects`).doc();
  const baseSlug = slugifyProjectName(projectName);
  let slug = baseSlug;
  for (let i = 0; i < 8; i++) {
    const slugSnap = await db.doc(`projectSlugs/${slug}`).get();
    if (!slugSnap.exists) break;
    slug = `${baseSlug}-${randomBytes(2).toString("hex")}`;
  }

  const batch = db.batch();
  batch.set(projectDoc, {
    name: projectName,
    slug,
    createdAt: FieldValue.serverTimestamp(),
    repoCount: repoUrls.length,
    debtMinutes: 0,
    maintainabilityRating: "A",
    securityRating: "A",
    qualityGateStatus: "PASSED",
    openIssues: 0,
    createdBy: uid,
  });
  batch.set(db.doc(`projectSlugs/${slug}`), {
    orgId,
    projectId: projectDoc.id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const repos: Array<{ repoId: string; name: string; repoUrl: string; ingestToken: string }> = [];
  for (const repoUrl of repoUrls) {
    const repoDocRef = projectDoc.collection("repos").doc();
    const ingestToken = generateIngestToken();
    const name = deriveRepoName(repoUrl);
    batch.set(repoDocRef, {
      name,
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
    repos.push({ repoId: repoDocRef.id, name, repoUrl, ingestToken });
  }

  await batch.commit();
  for (const r of repos) {
    await storeIngestToken(projectDoc.collection("repos").doc(r.repoId), r.ingestToken);
  }
  if (repos.length > 0) {
    await recomputeProjectAggregate(orgId, projectDoc.id);
  }

  return {
    orgId,
    projectId: projectDoc.id,
    slug,
    repos,
  };
});

export const getOrgQuotasCallable = onCall<{ orgId: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);
  const orgId = String(request.data?.orgId ?? "").trim();
  if (!orgId) throw new HttpsError("invalid-argument", "orgId is required");
  const orgSnap = await db.doc(`orgs/${orgId}`).get();
  if (!orgSnap.exists) throw new HttpsError("not-found", "org not found");
  const quotas = await getOrgQuotas(orgId);
  return {
    orgId,
    orgName: (orgSnap.get("name") as string) ?? orgId,
    quotas,
  };
});

export const setOrgQuotas = onCall<{
  orgId: string;
  maxRepos?: number;
  maxBuildsPerMonth?: number;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const orgId = String(request.data?.orgId ?? "").trim();
  if (!orgId) throw new HttpsError("invalid-argument", "orgId is required");
  const orgSnap = await db.doc(`orgs/${orgId}`).get();
  if (!orgSnap.exists) throw new HttpsError("not-found", "org not found");

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  };
  if (request.data?.maxRepos !== undefined) {
    const n = Math.round(Number(request.data.maxRepos));
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) {
      throw new HttpsError("invalid-argument", "maxRepos must be 1..1000000");
    }
    patch.maxRepos = n;
  }
  if (request.data?.maxBuildsPerMonth !== undefined) {
    const n = Math.round(Number(request.data.maxBuildsPerMonth));
    if (!Number.isFinite(n) || n < 1 || n > 10_000_000) {
      throw new HttpsError("invalid-argument", "maxBuildsPerMonth must be 1..10000000");
    }
    patch.maxBuildsPerMonth = n;
  }
  if (Object.keys(patch).length <= 2) {
    throw new HttpsError("invalid-argument", "no quota fields provided");
  }

  await db.doc(`orgs/${orgId}/settings/quotas`).set(patch, { merge: true });
  return { orgId, quotas: await getOrgQuotas(orgId) };
});
