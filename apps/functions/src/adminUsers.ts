import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { db } from "./lib/firebase.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "platform admin required");
}

export interface PlatformUserRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  isPlatformAdmin: boolean;
}

/**
 * Lists Auth users (paginated) with platform-admin flag. Only platform admins.
 */
export const adminListUsers = onCall<{ pageToken?: string; pageSize?: number }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const pageSize = Math.min(100, Math.max(1, Number(request.data?.pageSize ?? 50) || 50));
  const pageToken = String(request.data?.pageToken ?? "").trim() || undefined;

  const auth = getAuth();
  const listed = await auth.listUsers(pageSize, pageToken);
  const adminSnap = await db.collection("platformAdmins").get();
  const adminUids = new Set(adminSnap.docs.map((d) => d.id));

  const users: PlatformUserRow[] = listed.users.map((u) => ({
    uid: u.uid,
    email: u.email ?? null,
    displayName: u.displayName ?? null,
    disabled: !!u.disabled,
    emailVerified: !!u.emailVerified,
    createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
    lastSignInAt: u.metadata.lastSignInTime
      ? new Date(u.metadata.lastSignInTime).toISOString()
      : null,
    isPlatformAdmin: adminUids.has(u.uid),
  }));

  users.sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));

  return {
    users,
    pageToken: listed.pageToken ?? null,
  };
});

/**
 * Grant or revoke platform admin. Cannot revoke yourself (avoids lock-out).
 */
export const adminSetPlatformAdmin = onCall<{
  targetUid: string;
  isAdmin: boolean;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const targetUid = String(request.data?.targetUid ?? "").trim();
  const isAdmin = !!request.data?.isAdmin;
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid is required");

  if (!isAdmin && targetUid === uid) {
    throw new HttpsError("failed-precondition", "Você não pode remover o próprio perfil de admin.");
  }

  const auth = getAuth();
  try {
    await auth.getUser(targetUid);
  } catch {
    throw new HttpsError("not-found", "Usuário não encontrado.");
  }

  const ref = db.doc(`platformAdmins/${targetUid}`);
  if (isAdmin) {
    await ref.set(
      {
        uid: targetUid,
        grantedAt: new Date().toISOString(),
        grantedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } else {
    await ref.delete();
  }

  return { targetUid, isPlatformAdmin: isAdmin };
});

/**
 * Update display name / email / disabled flag via Admin SDK.
 */
export const adminUpdateUser = onCall<{
  targetUid: string;
  displayName?: string;
  email?: string;
  disabled?: boolean;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const targetUid = String(request.data?.targetUid ?? "").trim();
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid is required");

  const patch: { displayName?: string; email?: string; disabled?: boolean } = {};
  if (typeof request.data?.displayName === "string") {
    const name = request.data.displayName.trim();
    patch.displayName = name || undefined;
  }
  if (typeof request.data?.email === "string") {
    const email = request.data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "Email inválido.");
    }
    patch.email = email;
  }
  if (typeof request.data?.disabled === "boolean") {
    if (request.data.disabled && targetUid === uid) {
      throw new HttpsError("failed-precondition", "Você não pode desativar a própria conta.");
    }
    patch.disabled = request.data.disabled;
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpsError("invalid-argument", "Nada para atualizar.");
  }

  const auth = getAuth();
  try {
    const updated = await auth.updateUser(targetUid, patch);
    return {
      uid: updated.uid,
      email: updated.email ?? null,
      displayName: updated.displayName ?? null,
      disabled: !!updated.disabled,
    };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Já existe uma conta com esse email.");
    }
    if (code === "auth/user-not-found") {
      throw new HttpsError("not-found", "Usuário não encontrado.");
    }
    throw new HttpsError("internal", err instanceof Error ? err.message.slice(0, 200) : "Falha ao atualizar.");
  }
});

/**
 * Set a new password and/or return a password-reset link for the admin to share.
 */
export const adminResetUserPassword = onCall<{
  targetUid: string;
  newPassword?: string;
  generateResetLink?: boolean;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const targetUid = String(request.data?.targetUid ?? "").trim();
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid is required");

  const newPassword = typeof request.data?.newPassword === "string" ? request.data.newPassword : "";
  const generateResetLink = !!request.data?.generateResetLink;

  if (!newPassword && !generateResetLink) {
    throw new HttpsError("invalid-argument", "Informe uma nova senha ou peça o link de redefinição.");
  }
  if (newPassword && (newPassword.length < 6 || newPassword.length > 128)) {
    throw new HttpsError("invalid-argument", "A senha precisa ter entre 6 e 128 caracteres.");
  }

  const auth = getAuth();
  let email: string | null = null;
  try {
    const user = await auth.getUser(targetUid);
    email = user.email ?? null;
    if (newPassword) {
      await auth.updateUser(targetUid, { password: newPassword });
    }
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/user-not-found") {
      throw new HttpsError("not-found", "Usuário não encontrado.");
    }
    throw new HttpsError("internal", err instanceof Error ? err.message.slice(0, 200) : "Falha ao redefinir senha.");
  }

  let resetLink: string | null = null;
  if (generateResetLink) {
    if (!email) throw new HttpsError("failed-precondition", "Usuário sem email — não dá para gerar link.");
    resetLink = await auth.generatePasswordResetLink(email);
  }

  return {
    targetUid,
    passwordUpdated: Boolean(newPassword),
    resetLink,
  };
});
