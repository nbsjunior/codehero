// Grants platform-admin privileges to an ALREADY-EXISTING user. Run
// out-of-band with Admin SDK credentials (never exposed as a client-callable
// function, so a regular user can never self-promote). This script never
// creates accounts or touches passwords — the user must sign up themselves
// through the site first. Usage:
//
//   node scripts/seed-admin.mjs <uid-or-email>
//
// Against the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-admin.mjs <uid-or-email>
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const identifier = process.argv[2];
if (!identifier) {
  console.error("uso: node scripts/seed-admin.mjs <uid-ou-email>");
  console.error("O usuário precisa já ter criado a própria conta pelo site antes de rodar isto.");
  process.exit(1);
}

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || "codehero";

if (!process.env.GCLOUD_PROJECT?.trim() && !process.env.GOOGLE_CLOUD_PROJECT?.trim()) {
  console.error("Defina GCLOUD_PROJECT (ou GOOGLE_CLOUD_PROJECT) antes de rodar o seed.");
  process.exit(1);
}
initializeApp();
const db = DATABASE_ID !== "(default)" ? getFirestore(DATABASE_ID) : getFirestore();
const auth = getAuth();

const uid = identifier.includes("@") ? (await auth.getUserByEmail(identifier)).uid : identifier;

await db.doc(`platformAdmins/${uid}`).set({
  uid,
  grantedAt: new Date().toISOString(),
  grantedBy: "seed-admin.mjs",
});

console.log(`platformAdmins/${uid} criado no banco "${DATABASE_ID}" — usuário agora é platform admin.`);
