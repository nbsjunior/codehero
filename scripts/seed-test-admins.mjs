/**
 * Cria (ou atualiza) duas contas fake para QA de papéis:
 *   - platform admin  → platformAdmins/{uid}
 *   - org gestor      → owner de uma org/projeto/repo, SEM platformAdmins
 *
 *   GCLOUD_PROJECT=apponti FIRESTORE_DATABASE_ID=codehero \
 *     node scripts/seed-test-admins.mjs
 *
 * Senhas padrão (só para QA local/prod controlada):
 *   CodeHeroQa!2026
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";

const cloudProject =
  process.env.GCLOUD_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim();
if (!cloudProject) {
  console.error("Defina GCLOUD_PROJECT antes de rodar.");
  process.exit(1);
}

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || "codehero";
const PASSWORD = process.env.CODEHERO_QA_PASSWORD?.trim() || "CodeHeroQa!2026";

const PLATFORM = {
  email: "qa.platform.admin@codehero.test",
  displayName: "QA Platform Admin",
};
const GESTOR = {
  email: "qa.repo.gestor@codehero.test",
  displayName: "QA Repo Gestor",
};

initializeApp({ projectId: cloudProject });
const db = DATABASE_ID !== "(default)" ? getFirestore(DATABASE_ID) : getFirestore();
const auth = getAuth();

async function ensureUser({ email, displayName }) {
  try {
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, {
      password: PASSWORD,
      emailVerified: true,
      displayName,
      disabled: false,
    });
    console.log(`atualizado: ${email} (${user.uid})`);
    return user;
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code !== "auth/user-not-found") throw err;
    const user = await auth.createUser({
      email,
      password: PASSWORD,
      emailVerified: true,
      displayName,
    });
    console.log(`criado: ${email} (${user.uid})`);
    return user;
  }
}

const platformUser = await ensureUser(PLATFORM);
const gestorUser = await ensureUser(GESTOR);

await db.doc(`platformAdmins/${platformUser.uid}`).set(
  {
    uid: platformUser.uid,
    email: PLATFORM.email,
    grantedAt: new Date().toISOString(),
    grantedBy: "seed-test-admins.mjs",
  },
  { merge: true },
);
console.log(`platformAdmins/${platformUser.uid} OK`);

// Gestor NÃO pode ter platformAdmins
const gestorAdminDoc = db.doc(`platformAdmins/${gestorUser.uid}`);
const existingAdmin = await gestorAdminDoc.get();
if (existingAdmin.exists) {
  await gestorAdminDoc.delete();
  console.log(`removido platformAdmins/${gestorUser.uid} (gestor deve ser só org)`);
}

// Org/projeto/repo dedicados ao gestor (idempotente por nome marcador)
const MARKER = "qa-repo-gestor";
const orgsSnap = await db.collection("orgs").where("qaMarker", "==", MARKER).limit(1).get();

let orgId;
let projectId;
let repoId;

if (!orgsSnap.empty) {
  orgId = orgsSnap.docs[0].id;
  await orgsSnap.docs[0].ref.set(
    {
      name: "QA Org Gestor",
      ownerUid: gestorUser.uid,
      qaMarker: MARKER,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.doc(`orgs/${orgId}/members/${gestorUser.uid}`).set(
    {
      uid: gestorUser.uid,
      role: "admin",
      email: GESTOR.email,
      joinedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  const projects = await db.collection(`orgs/${orgId}/projects`).limit(1).get();
  if (projects.empty) {
    const projectRef = db.collection(`orgs/${orgId}/projects`).doc();
    projectId = projectRef.id;
    await projectRef.set({
      name: "QA Projeto Gestor",
      slug: `qa-gestor-${randomBytes(2).toString("hex")}`,
      createdAt: FieldValue.serverTimestamp(),
      repoCount: 0,
      debtMinutes: 0,
      maintainabilityRating: "A",
      securityRating: "A",
      qualityGateStatus: "PASSED",
      openIssues: 0,
    });
  } else {
    projectId = projects.docs[0].id;
  }
  const repos = await db.collection(`orgs/${orgId}/projects/${projectId}/repos`).limit(1).get();
  if (repos.empty) {
    const repoRef = db.collection(`orgs/${orgId}/projects/${projectId}/repos`).doc();
    repoId = repoRef.id;
    await repoRef.set({
      name: "qa/demo-repo",
      repoUrl: "https://github.com/nbsjunior/codehero",
      mainBranch: "main",
      debtMinutes: 0,
      maintainabilityRating: "A",
      securityRating: "A",
      qualityGateStatus: "PASSED",
      openIssues: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    await db.doc(`orgs/${orgId}/projects/${projectId}`).set({ repoCount: 1 }, { merge: true });
  } else {
    repoId = repos.docs[0].id;
  }
  console.log(`org QA reutilizada: ${orgId}`);
} else {
  const orgRef = db.collection("orgs").doc();
  const projectRef = orgRef.collection("projects").doc();
  const repoRef = projectRef.collection("repos").doc();
  orgId = orgRef.id;
  projectId = projectRef.id;
  repoId = repoRef.id;
  const slug = `qa-gestor-${randomBytes(2).toString("hex")}`;
  const batch = db.batch();
  batch.set(orgRef, {
    name: "QA Org Gestor",
    ownerUid: gestorUser.uid,
    qaMarker: MARKER,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(orgRef.collection("members").doc(gestorUser.uid), {
    uid: gestorUser.uid,
    role: "admin",
    email: GESTOR.email,
    joinedAt: FieldValue.serverTimestamp(),
  });
  batch.set(projectRef, {
    name: "QA Projeto Gestor",
    slug,
    createdAt: FieldValue.serverTimestamp(),
    repoCount: 1,
    debtMinutes: 0,
    maintainabilityRating: "A",
    securityRating: "A",
    qualityGateStatus: "PASSED",
    openIssues: 0,
  });
  batch.set(db.doc(`projectSlugs/${slug}`), {
    orgId,
    projectId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(repoRef, {
    name: "qa/demo-repo",
    repoUrl: "https://github.com/nbsjunior/codehero",
    mainBranch: "main",
    debtMinutes: 0,
    maintainabilityRating: "A",
    securityRating: "A",
    qualityGateStatus: "PASSED",
    openIssues: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log(`org QA criada: ${orgId}`);
}

console.log("\n=== contas QA ===");
console.log(`platform: ${PLATFORM.email} / ${PASSWORD}`);
console.log(`gestor:   ${GESTOR.email} / ${PASSWORD}`);
console.log(`orgId=${orgId} projectId=${projectId} repoId=${repoId}`);
console.log(`db=${DATABASE_ID} cloudProject=${cloudProject}`);
