import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./lib/firebase.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "not a platform admin");
}

/**
 * Global admin view: every project across every org, for the platform admin
 * dashboard. Uses the Admin SDK (bypasses per-org Firestore rules) — access
 * is gated by membership in platformAdmins/{uid}, which is only ever granted
 * out-of-band (scripts/seed-admin.mjs), never through a client-callable
 * function, so a regular user can never escalate themselves into this view.
 */
export const adminListAllProjects = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const orgsSnap = await db.collection("orgs").get();
  const projects: Array<Record<string, unknown>> = [];

  await Promise.all(
    orgsSnap.docs.map(async (orgDoc) => {
      const org = orgDoc.data();
      const projectsSnap = await orgDoc.ref.collection("projects").get();
      for (const p of projectsSnap.docs) {
        const data = p.data();
        projects.push({
          orgId: orgDoc.id,
          orgName: org.name ?? orgDoc.id,
          projectId: p.id,
          name: data.name ?? p.id,
          repoUrl: data.repoUrl ?? null,
          debtMinutes: data.debtMinutes ?? 0,
          maintainabilityRating: data.maintainabilityRating ?? "A",
          securityRating: data.securityRating ?? "A",
          qualityGateStatus: data.qualityGateStatus ?? "PASSED",
          openIssues: data.openIssues ?? 0,
          lastAnalyzedAt: data.lastAnalyzedAt?.toDate?.().toISOString() ?? null,
        });
      }
    }),
  );

  return { orgCount: orgsSnap.size, projects };
});

/** Lets the web app show/hide the "Admin" nav entry without a Firestore read. */
export const checkPlatformAdmin = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  return { isAdmin: snap.exists };
});
