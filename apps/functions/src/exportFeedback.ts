import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./lib/firebase.ts";
import { extractFeatures, type FindingFeatureInput } from "@codehero/fp-ranker";

/**
 * Exporta rótulos de feedback (confirmado / FP) para treino do ranqueador.
 * Formato: array JSON pronto para `hero-fp-ranker train`.
 */
export const exportRuleforgeFeedback = onCall<{
  orgId: string;
  limit?: number;
  onlyUnmerged?: boolean;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const { orgId, limit = 500, onlyUnmerged = true } = request.data ?? {};
  if (!orgId) throw new HttpsError("invalid-argument", "orgId required");

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  const isAdmin = (await db.doc(`platformAdmins/${uid}`).get()).exists;
  if (!member.exists && !isAdmin) throw new HttpsError("permission-denied", "not a member");

  let q = db.collection("orgs").doc(orgId).collection("ruleforgeFeedback").orderBy("createdAt", "desc").limit(Math.min(limit, 2000));
  // Firestore inequality on merged flag: filter client-side for simplicity.
  const snap = await q.get();
  const examples = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (onlyUnmerged && data.mergedIntoCorpus === true) continue;
    const label = data.expectedLabel === "match" ? 1 : 0;
    const finding: FindingFeatureInput = {
      ruleId: String(data.ruleId ?? ""),
      file: String(data.file ?? data.fingerprint ?? ""),
      severity: data.severity,
      engine: data.engine,
      findingSource: data.findingSource,
      ruleRepoFpRate: data.ruleRepoFpRate,
      cyclomatic: data.cyclomatic,
      cognitive: data.cognitive,
      nesting: data.nesting,
      taintPathLength: data.taintPathLength,
    };
    examples.push({
      id: d.id,
      label,
      ruleId: data.ruleId,
      repoId: data.repoId,
      features: data.features ?? extractFeatures(finding),
      finding,
      note: data.note ?? null,
    });
  }

  return { orgId, count: examples.length, examples };
});
