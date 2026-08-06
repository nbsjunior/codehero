/**
 * Creates (or updates) the Firebase Auth user and grants platformAdmins.
 *
 *   node scripts/bootstrap-platform-admin.mjs <email> <password>
 *
 * Uses Application Default Credentials (gcloud auth application-default login).
 * Requires GCLOUD_PROJECT and optional FIRESTORE_DATABASE_ID.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error("uso: node scripts/bootstrap-platform-admin.mjs <email> <senha>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("a senha precisa ter pelo menos 6 caracteres");
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim();
if (!projectId) {
  console.error("Defina GCLOUD_PROJECT antes de rodar o bootstrap.");
  process.exit(1);
}

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || "codehero";
initializeApp({ projectId });
const db = DATABASE_ID !== "(default)" ? getFirestore(DATABASE_ID) : getFirestore();
const auth = getAuth();

let user;
try {
  user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password, emailVerified: true });
  console.log(`usuário existente atualizado: ${user.uid}`);
} catch (err) {
  const code = /** @type {{ code?: string }} */ (err).code;
  if (code !== "auth/user-not-found") throw err;
  user = await auth.createUser({
    email,
    password,
    emailVerified: true,
    displayName: "Platform Admin",
  });
  console.log(`usuário criado: ${user.uid}`);
}

await db.doc(`platformAdmins/${user.uid}`).set(
  {
    uid: user.uid,
    email,
    grantedAt: new Date().toISOString(),
    grantedBy: "bootstrap-platform-admin.mjs",
  },
  { merge: true },
);

console.log(`platformAdmins/${user.uid} OK (db=${DATABASE_ID}) — ${email} é admin da plataforma.`);
