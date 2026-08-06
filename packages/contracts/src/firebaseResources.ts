/**
 * Logical resource IDs for a self-hosted or cloud deployment.
 *
 * Never commit a real cloud project id or bucket name here.
 * Operators set these via environment variables at runtime.
 */
function env(name: string, fallback = ""): string {
  try {
    return (typeof process !== "undefined" ? process.env?.[name]?.trim() : undefined) || fallback;
  } catch {
    return fallback;
  }
}

export const CODEHERO_FIREBASE = {
  /** Cloud project id — required in production (`GCLOUD_PROJECT` or `FIREBASE_PROJECT_ID`). */
  projectId: env("GCLOUD_PROJECT") || env("FIREBASE_PROJECT_ID"),
  hostingSite: env("CODEHERO_HOSTING_SITE", "codehero"),
  firestoreDatabaseId: env("FIRESTORE_DATABASE_ID", "codehero"),
  /** Object-storage bucket — required in production (`FIREBASE_STORAGE_BUCKET`). */
  storageBucket: env("FIREBASE_STORAGE_BUCKET"),
} as const;
