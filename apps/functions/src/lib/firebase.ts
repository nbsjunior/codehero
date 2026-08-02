import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { CODEHERO_FIREBASE } from "@codehero/contracts";

// Segregated resources: named Firestore DB + dedicated Storage bucket
// (never another app's default database/bucket in a shared GCP project).
export const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID?.trim() || CODEHERO_FIREBASE.firestoreDatabaseId;
export const STORAGE_BUCKET_NAME =
  process.env.FIREBASE_STORAGE_BUCKET?.trim() || CODEHERO_FIREBASE.storageBucket;

if (getApps().length === 0) {
  initializeApp({
    storageBucket: STORAGE_BUCKET_NAME,
  });
}

export const db: Firestore =
  FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== "(default)"
    ? getFirestore(FIRESTORE_DATABASE_ID)
    : getFirestore();

// Dress-code / Genkit drafts often leave optional fields as `undefined`.
db.settings({ ignoreUndefinedProperties: true });

export const storage = getStorage();

export function projectRef(orgId: string, projectId: string) {
  return db.doc(`orgs/${orgId}/projects/${projectId}`);
}

/** A project consolidates one or more repos — each repo has its own
 *  ingestToken, CI pipeline, and metrics; the project rolls them up. */
export function repoRef(orgId: string, projectId: string, repoId: string) {
  return projectRef(orgId, projectId).collection("repos").doc(repoId);
}
