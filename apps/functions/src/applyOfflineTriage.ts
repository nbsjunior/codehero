import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, repoRef } from "./lib/firebase.ts";

/**
 * Presence Fase 4 — aplica scores de triagem offline (Foundation-Sec / heuristic)
 * aos issues do repo. Nunca roda no hot path do PR; o cliente sobe o JSON gerado por
 * `npm run triage:offline`.
 *
 * Input shape (mesmo do scripts/foundation-sec-triage.mjs):
 *   { findings: [{ id|fingerprint, triageScore, likelyTruePositive, triageReason?, triageMode? }] }
 */
export const applyOfflineTriage = onCall<{
  orgId: string;
  projectId: string;
  repoId: string;
  triage: {
    generatedAt?: string;
    findings: Array<{
      id?: string;
      fingerprint?: string;
      triageScore: number;
      likelyTruePositive?: boolean;
      triageReason?: string;
      triageMode?: string;
    }>;
  };
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId, repoId, triage } = request.data ?? {};
  if (!orgId || !projectId || !repoId || !triage?.findings?.length) {
    throw new HttpsError(
      "invalid-argument",
      "orgId, projectId, repoId e triage.findings[] são obrigatórios",
    );
  }

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  const isAdmin = (await db.doc(`platformAdmins/${uid}`).get()).exists;
  if (!member.exists && !isAdmin) throw new HttpsError("permission-denied", "not a member");

  const issues = repoRef(orgId, projectId, repoId).collection("issues");
  const now = FieldValue.serverTimestamp();
  let updated = 0;
  let skipped = 0;

  // Firestore batch limit 500; chunk.
  const chunks: (typeof triage.findings)[] = [];
  for (let i = 0; i < triage.findings.length; i += 400) {
    chunks.push(triage.findings.slice(i, i + 400));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    for (const f of chunk) {
      const fp = String(f.fingerprint ?? f.id ?? "").trim();
      if (!fp) {
        skipped++;
        continue;
      }
      const score = Math.max(0, Math.min(1, Number(f.triageScore)));
      if (Number.isNaN(score)) {
        skipped++;
        continue;
      }
      const ref = issues.doc(fp);
      batch.set(
        ref,
        {
          triageScore: Math.round(score * 1000) / 1000,
          likelyTruePositive: f.likelyTruePositive ?? score >= 0.55,
          triageReason: f.triageReason ?? null,
          triageMode: f.triageMode ?? "offline",
          triageAt: now,
          triageBy: uid,
        },
        { merge: true },
      );
      updated++;
    }
    await batch.commit();
  }

  return {
    ok: true,
    updated,
    skipped,
    generatedAt: triage.generatedAt ?? null,
  };
});
