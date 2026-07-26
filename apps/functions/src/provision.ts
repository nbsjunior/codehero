import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase.ts";

interface ProvisionInput {
  orgName: string;
  projectName: string;
  repoUrl?: string;
}

/**
 * Onboarding: creates an org (with the caller as owner) and a first project
 * with a freshly minted ingest token used by CI to push SARIF reports.
 */
export const provisionProject = onCall<ProvisionInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgName, projectName, repoUrl } = request.data ?? ({} as ProvisionInput);
  if (!orgName || !projectName) throw new HttpsError("invalid-argument", "orgName and projectName are required");

  const orgRef = db.collection("orgs").doc();
  const projectRef = orgRef.collection("projects").doc();
  const ingestToken = `chp_${randomBytes(24).toString("hex")}`;

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
    repoUrl: repoUrl ?? null,
    mainBranch: "main",
    ingestToken,
    debtMinutes: 0,
    maintainabilityRating: "A",
    securityRating: "A",
    qualityGateStatus: "PASSED",
    openIssues: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return {
    orgId: orgRef.id,
    projectId: projectRef.id,
    ingestToken, // shown once — stored as a CI secret by the caller
  };
});
