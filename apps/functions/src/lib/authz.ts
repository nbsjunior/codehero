import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.ts";

export { requireVerifiedEmail } from "./quotas.ts";

/** Org member role from members/{uid}.role — default "member". */
export async function requireOrgRole(
  orgId: string,
  uid: string,
  allowed: ReadonlyArray<"owner" | "admin" | "member">,
): Promise<string> {
  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!member.exists) throw new HttpsError("permission-denied", "not a member of this org");
  const role = String(member.get("role") ?? "member");
  if (!allowed.includes(role as "owner" | "admin" | "member")) {
    throw new HttpsError("permission-denied", `requires role: ${allowed.join("|")}`);
  }
  return role;
}

/**
 * Firestore-backed rate limit (hourly bucket by default).
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowId: string = new Date().toISOString().slice(0, 13),
): Promise<void> {
  const ref = db.doc(`_rateLimits/${key}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const same = data.windowId === windowId;
    const count = same ? Number(data.count ?? 0) : 0;
    if (count >= limit) {
      throw new HttpsError("resource-exhausted", "Too many requests. Try again later.");
    }
    tx.set(
      ref,
      { windowId, count: count + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
}
