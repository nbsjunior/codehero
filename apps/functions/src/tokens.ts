import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, repoRef } from "./lib/firebase.ts";
import { generateIngestToken, storeIngestToken, ingestTokenHint } from "./lib/ingestToken.ts";
import { requireOrgRole, requireVerifiedEmail } from "./lib/authz.ts";
import { portalCallableOpts } from "./lib/httpSecurity.ts";

interface RotateTokenInput {
  orgId: string;
  projectId: string;
  repoId: string;
}

async function assertCanRotateToken(orgId: string, uid: string): Promise<void> {
  const platformAdmin = (await db.doc(`platformAdmins/${uid}`).get()).exists;
  if (platformAdmin) return;
  await requireOrgRole(orgId, uid, ["owner", "admin"]);
}

/**
 * Rotates a repo's ingestToken — the single credential used by that repo's CI
 * pipeline (GitHub Action), the local scanner/IDE config, and the MCP server.
 * Each repo in a project has its own token (independent CI pipelines), so
 * rotating one never affects a sibling repo in the same project. Invalidates
 * the old token immediately (CI/MCP clients holding the stale value start
 * getting 401s from ingestAnalysis/listIssues/sddSpec/submitFixResult until
 * reconfigured). Restricted to org owner/admin **or** platform admin.
 */
export const rotateIngestToken = onCall<RotateTokenInput>(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para rotacionar o token.");

  const { orgId, projectId, repoId } = request.data ?? ({} as RotateTokenInput);
  if (!orgId || !projectId || !repoId) {
    throw new HttpsError("invalid-argument", "orgId, projectId e repoId são obrigatórios.");
  }

  await requireVerifiedEmail(uid);
  try {
    await assertCanRotateToken(orgId, uid);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "permission-denied") {
      throw new HttpsError(
        "permission-denied",
        "Só owner/admin da organização (ou admin da plataforma) pode rotacionar o HERO_TOKEN.",
      );
    }
    throw err;
  }

  const rRef = repoRef(orgId, projectId, repoId);
  const rSnap = await rRef.get();
  if (!rSnap.exists) throw new HttpsError("not-found", "Repositório não encontrado neste projeto.");

  const ingestToken = generateIngestToken();
  await storeIngestToken(rRef, ingestToken);
  await rRef.update({ tokenRotatedAt: FieldValue.serverTimestamp(), tokenRotatedBy: uid });

  return { ingestToken, ingestTokenHint: ingestTokenHint(ingestToken) };
});
