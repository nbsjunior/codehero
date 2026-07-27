import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, repoRef } from "./lib/firebase.ts";

interface RotateTokenInput {
  orgId: string;
  projectId: string;
  repoId: string;
}

/**
 * Rotates a repo's ingestToken — the single credential used by that repo's CI
 * pipeline (GitHub Action), the local scanner/IDE config, and the MCP server.
 * Each repo in a project has its own token (independent CI pipelines), so
 * rotating one never affects a sibling repo in the same project. Invalidates
 * the old token immediately (CI/MCP clients holding the stale value start
 * getting 401s from ingestAnalysis/listIssues/sddSpec/submitFixResult until
 * reconfigured). Any org member may rotate — not owner-restricted, so a
 * developer can recover from a leaked token without waiting on an admin.
 */
export const rotateIngestToken = onCall<RotateTokenInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId, repoId } = request.data ?? ({} as RotateTokenInput);
  if (!orgId || !projectId || !repoId) {
    throw new HttpsError("invalid-argument", "orgId, projectId and repoId are required");
  }

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!member.exists) throw new HttpsError("permission-denied", "not a member of this org");

  const rRef = repoRef(orgId, projectId, repoId);
  const rSnap = await rRef.get();
  if (!rSnap.exists) throw new HttpsError("not-found", "repo not found");

  const ingestToken = `chp_${randomBytes(24).toString("hex")}`;
  await rRef.update({ ingestToken, tokenRotatedAt: FieldValue.serverTimestamp(), tokenRotatedBy: uid });

  return { ingestToken };
});
