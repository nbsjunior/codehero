import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "platform admin required");
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Site-wide feature toggles, controlled only by the general platform admin.
 * Any signed-in user can READ (so client code anywhere in the app can gate a
 * feature), but only a platformAdmins/{uid} can write — enforced here via
 * Admin SDK, not client Firestore rules, so the write path never depends on
 * the client's own permission model.
 */
export const listFeatureFlags = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "sign-in required");
  const snap = await db.collection("platformFeatureFlags").orderBy("key", "asc").get();
  const flags: FeatureFlag[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      key: d.id,
      enabled: Boolean(data.enabled),
      description: (data.description as string) ?? "",
      updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
      updatedBy: (data.updatedBy as string) ?? null,
    };
  });
  return { flags };
});

interface SetFlagInput {
  key: string;
  enabled: boolean;
  description?: string;
}

export const setFeatureFlag = onCall<SetFlagInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const { key, enabled, description } = request.data ?? ({} as SetFlagInput);
  const cleanKey = (key ?? "").trim();
  if (!cleanKey || !/^[a-z][a-z0-9_-]{2,63}$/.test(cleanKey)) {
    throw new HttpsError("invalid-argument", "key must be kebab/snake_case, 3-64 chars, starting with a letter");
  }

  await db
    .collection("platformFeatureFlags")
    .doc(cleanKey)
    .set(
      {
        enabled: Boolean(enabled),
        description: (description ?? "").trim().slice(0, 240),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true },
    );

  return { ok: true };
});
