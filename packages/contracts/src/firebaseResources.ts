/**
 * Logical Firebase resource IDs for CodeHero.
 *
 * When sharing a GCP/Firebase project with other apps, keep these segregated:
 * named Firestore database, dedicated Storage bucket, distinct Hosting site,
 * and non-colliding Cloud Function export names. Auth remains project-scoped.
 *
 * Override via env in Functions / web client; do not put secrets here.
 */
export const CODEHERO_FIREBASE = {
  projectId: "apponti",
  hostingSite: "codehero",
  firestoreDatabaseId: "codehero",
  storageBucket: "apponti-codehero",
} as const;
