import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import {
  generateIngestToken,
  hashIngestToken,
  ingestTokenHint,
  safeEqualStr,
} from "./ingestTokenCrypto.ts";

export { generateIngestToken, hashIngestToken, ingestTokenHint } from "./ingestTokenCrypto.ts";

/**
 * Persist secret under repos/{id}/secrets/ci (Admin SDK only — rules deny client).
 * Strip legacy plaintext `ingestToken` from the parent repo doc.
 */
export async function storeIngestToken(repoRef: DocumentReference, token: string): Promise<void> {
  const hash = hashIngestToken(token);
  const hint = ingestTokenHint(token);
  const batch = repoRef.firestore.batch();
  batch.set(
    repoRef.collection("secrets").doc("ci"),
    {
      hash,
      token,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(
    repoRef,
    {
      ingestTokenHint: hint,
      ingestTokenHash: hash,
      ingestToken: FieldValue.delete(),
    },
    { merge: true },
  );
  await batch.commit();
}

export type VerifyIngestResult = { ok: true } | { ok: false; status: 401 | 404; error: string };

/**
 * Validate Bearer token against secrets/ci, with lazy migrate from legacy
 * plaintext `ingestToken` on the repo doc.
 */
export async function verifyIngestToken(
  repoRef: DocumentReference,
  presented: string | undefined,
): Promise<VerifyIngestResult> {
  const token = (presented ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const rSnap = await repoRef.get();
  if (!rSnap.exists) return { ok: false, status: 401, error: "unauthorized" };

  const secRef = repoRef.collection("secrets").doc("ci");
  const secSnap = await secRef.get();

  if (secSnap.exists) {
    const stored = String(secSnap.get("token") ?? "");
    const hash = String(secSnap.get("hash") ?? "");
    if (stored && safeEqualStr(stored, token)) return { ok: true };
    if (hash && safeEqualStr(hash, hashIngestToken(token))) return { ok: true };
    return { ok: false, status: 401, error: "unauthorized" };
  }

  // Legacy migrate: plaintext on repo doc
  const legacy = String(rSnap.get("ingestToken") ?? "");
  if (legacy && safeEqualStr(legacy, token)) {
    await storeIngestToken(repoRef, legacy);
    return { ok: true };
  }

  return { ok: false, status: 401, error: "unauthorized" };
}

/** Admin-only plaintext for GitHub Action install (never expose to clients). */
export async function readIngestTokenPlain(repoRef: DocumentReference): Promise<string | null> {
  const secSnap = await repoRef.collection("secrets").doc("ci").get();
  if (secSnap.exists) {
    const t = String(secSnap.get("token") ?? "");
    if (t) return t;
  }
  const rSnap = await repoRef.get();
  const legacy = String(rSnap.get("ingestToken") ?? "");
  if (legacy) {
    await storeIngestToken(repoRef, legacy);
    return legacy;
  }
  return null;
}
