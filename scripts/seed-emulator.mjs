// Seeds a demo org/project directly into the Firestore emulator so we can
// exercise the ingest endpoint. Run with FIRESTORE_EMULATOR_HOST set.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? "codehero-dev";
initializeApp({ projectId: "codehero-dev" });
// Emulator uses (default); production CodeHero uses named DB `codehero`.
const db = getFirestore();

const orgId = "demo-org";
const projectId = "demo-project";
const ingestToken = "chp_demo_token_123";

await db.doc(`orgs/${orgId}`).set({ name: "Demo Org", ownerUid: "seed" });
await db.doc(`orgs/${orgId}/members/seed`).set({ uid: "seed", role: "owner" });
await db.doc(`orgs/${orgId}/projects/${projectId}`).set({
  name: "Demo Project",
  ingestToken,
  mainBranch: "main",
});

console.log(JSON.stringify({ orgId, projectId, ingestToken }));
