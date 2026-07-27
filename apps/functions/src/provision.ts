import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { slugifyProjectName } from "@codehero/contracts";
import { db } from "./lib/firebase.ts";
import { deriveRepoName } from "./lib/repoName.ts";

interface ProvisionInput {
  orgName: string;
  projectName: string;
  repoUrl?: string;
}

/**
 * Onboarding: creates an org (with the caller as owner) and a first project.
 * A project is a consolidation container — quality/security rolled up across
 * one or more repos (orgs/{orgId}/projects/{projectId}/repos/{repoId}), each
 * with its own ingestToken/CI pipeline. If a repoUrl is given here, it
 * becomes the project's first repo; more can be added later via
 * `addRepoToProject`.
 */
export const provisionProject = onCall<ProvisionInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgName, projectName, repoUrl } = request.data ?? ({} as ProvisionInput);
  if (!orgName || !projectName) throw new HttpsError("invalid-argument", "orgName and projectName are required");

  const orgRef = db.collection("orgs").doc();
  const projectRef = orgRef.collection("projects").doc();

  const baseSlug = slugifyProjectName(projectName);
  let slug = baseSlug;
  for (let i = 0; i < 8; i++) {
    const slugSnap = await db.doc(`projectSlugs/${slug}`).get();
    if (!slugSnap.exists) break;
    slug = `${baseSlug}-${randomBytes(2).toString("hex")}`;
  }

  const batch = db.batch();
  batch.set(orgRef, {
    name: orgName,
    ownerUid: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(orgRef.collection("members").doc(uid), {
    uid,
    role: "owner",
    joinedAt: FieldValue.serverTimestamp(),
  });
  batch.set(projectRef, {
    name: projectName,
    slug,
    createdAt: FieldValue.serverTimestamp(),
    // Rolled-up metrics — starts at zero repos; recomputed by
    // recomputeProjectAggregate() the moment a repo is added or analyzed.
    repoCount: 0,
    debtMinutes: 0,
    maintainabilityRating: "A",
    securityRating: "A",
    qualityGateStatus: "PASSED",
    openIssues: 0,
  });
  batch.set(db.doc(`projectSlugs/${slug}`), {
    orgId: orgRef.id,
    projectId: projectRef.id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  let repoId: string | null = null;
  let ingestToken: string | null = null;
  if (repoUrl) {
    const repoDocRef = projectRef.collection("repos").doc();
    repoId = repoDocRef.id;
    ingestToken = `chp_${randomBytes(24).toString("hex")}`;
    batch.set(repoDocRef, {
      name: deriveRepoName(repoUrl),
      repoUrl,
      mainBranch: "main",
      ingestToken,
      debtMinutes: 0,
      maintainabilityRating: "A",
      securityRating: "A",
      qualityGateStatus: "PASSED",
      openIssues: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(projectRef, { repoCount: 1 });
  }

  await batch.commit();

  return {
    orgId: orgRef.id,
    projectId: projectRef.id,
    slug,
    repoId,
    ingestToken, // shown once — stored as a CI secret by the caller (null if no repoUrl given yet)
  };
});
