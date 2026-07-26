import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, projectRef } from "./lib/firebase.ts";

interface RotateTokenInput {
  orgId: string;
  projectId: string;
}

/**
 * Rotates a project's ingestToken — the single credential used by the CI
 * pipeline (GitHub Action), the local scanner/IDE config, and the MCP server.
 * Invalidates the old token immediately (CI/MCP clients holding the stale
 * value start getting 401s from ingestAnalysis/listIssues/sddSpec/
 * submitFixResult until reconfigured). Any org member may rotate — it is a
 * project-level credential, not owner-restricted, so a developer can recover
 * from a leaked token without waiting on an admin.
 */
export const rotateIngestToken = onCall<RotateTokenInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId } = request.data ?? ({} as RotateTokenInput);
  if (!orgId || !projectId) throw new HttpsError("invalid-argument", "orgId and projectId are required");

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!member.exists) throw new HttpsError("permission-denied", "not a member of this org");

  const pRef = projectRef(orgId, projectId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) throw new HttpsError("not-found", "project not found");

  const ingestToken = `chp_${randomBytes(24).toString("hex")}`;
  await pRef.update({ ingestToken, tokenRotatedAt: FieldValue.serverTimestamp(), tokenRotatedBy: uid });

  return { ingestToken };
});
