import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export const storage = getStorage();

export function projectRef(orgId: string, projectId: string) {
  return db.doc(`orgs/${orgId}/projects/${projectId}`);
}
