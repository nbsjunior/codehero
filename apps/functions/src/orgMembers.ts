import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { db } from "./lib/firebase.ts";
import { requireOrgRole, requireVerifiedEmail, consumeRateLimit } from "./lib/authz.ts";
import { portalCallableOpts } from "./lib/httpSecurity.ts";

type MemberRole = "owner" | "admin" | "member";

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const listOrgMembers = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const { orgId } = (request.data ?? {}) as { orgId?: string };
  if (!orgId) throw new HttpsError("invalid-argument", "orgId required");
  await requireOrgRole(orgId, uid, ["owner", "admin", "member"]);

  const snap = await db.collection(`orgs/${orgId}/members`).limit(200).get();
  const members = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      let email: string | null = null;
      let displayName: string | null = null;
      try {
        const user = await getAuth().getUser(d.id);
        email = user.email ?? null;
        displayName = user.displayName ?? null;
      } catch {
        /* user may have been deleted */
      }
      return {
        uid: d.id,
        role: (data.role as MemberRole) ?? "member",
        email,
        displayName,
        joinedAt: data.joinedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    }),
  );

  const invitesSnap = await db
    .collection(`orgs/${orgId}/invites`)
    .where("status", "==", "pending")
    .limit(50)
    .get();
  const invites = invitesSnap.docs.map((d) => {
    const data = d.data();
    return {
      inviteId: d.id,
      email: data.email as string,
      role: data.role as MemberRole,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() ?? null,
    };
  });

  return { members, invites };
});

export const inviteOrgMember = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);
  const { orgId, email: rawEmail, role: rawRole } = (request.data ?? {}) as {
    orgId?: string;
    email?: string;
    role?: string;
  };
  if (!orgId) throw new HttpsError("invalid-argument", "orgId required");
  await requireOrgRole(orgId, uid, ["owner", "admin"]);
  await consumeRateLimit(`invite:${orgId}`, 30);

  const email = String(rawEmail ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "email inválido");
  }
  const role: MemberRole = rawRole === "admin" || rawRole === "owner" ? rawRole : "member";
  if (role === "owner") {
    throw new HttpsError("invalid-argument", "não é possível convidar como owner");
  }

  const token = `chi_${randomBytes(24).toString("hex")}`;
  const inviteRef = db.collection(`orgs/${orgId}/invites`).doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await inviteRef.set({
    email,
    role,
    tokenHash: hashInviteToken(token),
    status: "pending",
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  // Token returned once — product can email it; for now the inviter copies a link.
  return {
    inviteId: inviteRef.id,
    email,
    role,
    acceptToken: token,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

export const acceptOrgInvite = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);
  const { orgId, inviteId, token } = (request.data ?? {}) as {
    orgId?: string;
    inviteId?: string;
    token?: string;
  };
  if (!orgId || !inviteId || !token) {
    throw new HttpsError("invalid-argument", "orgId, inviteId and token required");
  }

  const user = await getAuth().getUser(uid);
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) throw new HttpsError("failed-precondition", "conta sem email");

  const inviteRef = db.doc(`orgs/${orgId}/invites/${inviteId}`);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError("not-found", "convite não encontrado");
  const data = inviteSnap.data()!;
  if (data.status !== "pending") throw new HttpsError("failed-precondition", "convite já usado");
  const exp = data.expiresAt as Timestamp | undefined;
  if (exp && exp.toMillis() < Date.now()) {
    await inviteRef.set({ status: "expired" }, { merge: true });
    throw new HttpsError("failed-precondition", "convite expirado");
  }
  if (String(data.email).toLowerCase() !== email) {
    throw new HttpsError("permission-denied", "este convite é para outro email");
  }
  if (hashInviteToken(token) !== String(data.tokenHash ?? "")) {
    throw new HttpsError("permission-denied", "token inválido");
  }

  const role = (data.role as MemberRole) ?? "member";
  await db.doc(`orgs/${orgId}/members/${uid}`).set(
    {
      uid,
      role: role === "owner" ? "admin" : role,
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy: data.createdBy ?? null,
    },
    { merge: true },
  );
  await inviteRef.set(
    { status: "accepted", acceptedBy: uid, acceptedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ok: true, orgId, role };
});

export const setOrgMemberRole = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);
  const { orgId, memberUid, role } = (request.data ?? {}) as {
    orgId?: string;
    memberUid?: string;
    role?: string;
  };
  if (!orgId || !memberUid) throw new HttpsError("invalid-argument", "orgId and memberUid required");
  await requireOrgRole(orgId, uid, ["owner"]);
  if (memberUid === uid) throw new HttpsError("invalid-argument", "não altere o próprio role aqui");
  const next: MemberRole = role === "admin" ? "admin" : "member";
  await db.doc(`orgs/${orgId}/members/${memberUid}`).set({ role: next }, { merge: true });
  return { ok: true };
});

export const removeOrgMember = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);
  const { orgId, memberUid } = (request.data ?? {}) as { orgId?: string; memberUid?: string };
  if (!orgId || !memberUid) throw new HttpsError("invalid-argument", "orgId and memberUid required");
  await requireOrgRole(orgId, uid, ["owner", "admin"]);
  if (memberUid === uid) throw new HttpsError("invalid-argument", "não remova a si mesmo");
  const target = await db.doc(`orgs/${orgId}/members/${memberUid}`).get();
  if (!target.exists) throw new HttpsError("not-found", "membro não encontrado");
  if (target.get("role") === "owner") {
    throw new HttpsError("permission-denied", "não remova o owner");
  }
  await target.ref.delete();
  return { ok: true };
});
