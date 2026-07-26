import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { SddSpecSchema } from "@codehero/contracts";
import { db, projectRef } from "./lib/firebase.ts";
import { buildSpecFromIssue, type IssueData } from "./lib/sddBuilder.ts";

interface GenerateSddInput {
  orgId: string;
  projectId: string;
  fingerprint: string;
}

/**
 * Web-facing callable: builds a verifiable SDD Spec for a single issue.
 * Membership is enforced via the caller's uid; the spec is validated with zod
 * before it is persisted or returned so a malformed spec never reaches an agent.
 */
export const generateSddSpec = onCall<GenerateSddInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId, fingerprint } = request.data ?? ({} as GenerateSddInput);
  if (!orgId || !projectId || !fingerprint) throw new HttpsError("invalid-argument", "orgId, projectId and fingerprint are required");

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!member.exists) throw new HttpsError("permission-denied", "not a member of this org");

  const issueSnap = await projectRef(orgId, projectId).collection("issues").doc(fingerprint).get();
  if (!issueSnap.exists) throw new HttpsError("not-found", "issue not found");

  const spec = SddSpecSchema.parse(buildSpecFromIssue(issueSnap.data() as IssueData, fingerprint));

  await projectRef(orgId, projectId).collection("sddSpecs").doc(spec.specId).set({
    ...spec,
    fingerprint,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  return spec;
});
