import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, repoRef } from "./lib/firebase.ts";

/**
 * Aplica relatório code-embed (famílias AST) aos issues — offline / batch.
 * Não falha o gate sozinho; alimenta UI + features do fp-ranker no próximo ingest.
 */
export const applyCodeEmbedClusters = onCall<{
  orgId: string;
  projectId: string;
  repoId: string;
  report: {
    version?: string;
    functions: Array<{
      file: string;
      startLine: number;
      endLine: number;
      name?: string;
      clusterId: string;
      familySize: number;
      outlierScore: number;
    }>;
  };
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const { orgId, projectId, repoId, report } = request.data ?? {};
  if (!orgId || !projectId || !repoId || !report?.functions?.length) {
    throw new HttpsError("invalid-argument", "orgId, projectId, repoId e report.functions[] obrigatórios");
  }

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  const isAdmin = (await db.doc(`platformAdmins/${uid}`).get()).exists;
  if (!member.exists && !isAdmin) throw new HttpsError("permission-denied", "not a member");

  const issuesSnap = await repoRef(orgId, projectId, repoId)
    .collection("issues")
    .where("status", "==", "open")
    .limit(500)
    .get();

  const fns = report.functions.map((f) => ({
    ...f,
    file: f.file.replace(/\\/g, "/"),
  }));

  let updated = 0;
  const batch = db.batch();
  for (const doc of issuesSnap.docs) {
    const data = doc.data();
    const file = String(data.file ?? "").replace(/\\/g, "/");
    const line = Number(data.line) || 0;
    const fam = fns.find((f) => f.file === file && line >= f.startLine && line <= f.endLine);
    if (!fam) continue;
    batch.set(
      doc.ref,
      {
        clusterId: fam.clusterId,
        familySize: fam.familySize,
        outlierScore: Math.round(fam.outlierScore * 1000) / 1000,
        functionName: fam.name ?? null,
        embedModel: report.version ?? "code-embed-v1",
        embedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    updated++;
  }
  await batch.commit();
  return { ok: true, updated, functions: fns.length };
});
