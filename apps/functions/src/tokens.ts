import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, repoRef } from "./lib/firebase.ts";
import { generateIngestToken, storeIngestToken } from "./lib/ingestToken.ts";
import { requireOrgRole, requireVerifiedEmail } from "./lib/authz.ts";
import { portalCallableOpts } from "./lib/httpSecurity.ts";

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
 * reconfigured). Restricted to owner/admin so a leaked-token rotate is an intentional privilege.
 */
export const rotateIngestToken = onCall<RotateTokenInput>(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId, repoId } = request.data ?? ({} as RotateTokenInput);
  if (!orgId || !projectId || !repoId) {
    throw new HttpsError("invalid-argument", "orgId, projectId and repoId are required");
  }

  await requireVerifiedEmail(uid);
  await requireOrgRole(orgId, uid, ["owner", "admin"]);

  const rRef = repoRef(orgId, projectId, repoId);
  const rSnap = await rRef.get();
  if (!rSnap.exists) throw new HttpsError("not-found", "repo not found");

  const ingestToken = generateIngestToken();
  await storeIngestToken(rRef, ingestToken);
  await rRef.update({ tokenRotatedAt: FieldValue.serverTimestamp(), tokenRotatedBy: uid });

  return { ingestToken };
});
