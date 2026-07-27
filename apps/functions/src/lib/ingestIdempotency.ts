import { createHash } from "node:crypto";
import type { SarifResult } from "@codehero/contracts";
import { repoRef } from "./firebase.ts";

/** Stable idempotency key for an ingest (prefer commit SHA). */
export function ingestIdempotencyKey(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  commit?: string | null;
  branch: string;
  results: SarifResult[];
}): string {
  if (input.commit && input.commit.length >= 7) {
    return `commit:${input.commit}`;
  }
  const sample = input.results
    .slice(0, 20)
    .map((r) => r.partialFingerprints?.["heroHash/v1"] ?? r.ruleId)
    .join("|");
  const hash = createHash("sha256")
    .update(`${input.branch}|${input.results.length}|${sample}`)
    .digest("hex")
    .slice(0, 24);
  return `hash:${hash}`;
}

/**
 * Returns a prior analysis if the same idempotency key was ingested recently
 * (24h), so CI retries do not duplicate issues / burn quota.
 */
export async function findRecentIngest(
  orgId: string,
  projectId: string,
  repoId: string,
  idempotencyKey: string,
): Promise<{ analysisId: string; summary: unknown } | null> {
  const snap = await repoRef(orgId, projectId, repoId)
    .collection("analyses")
    .where("idempotencyKey", "==", idempotencyKey)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  const createdAt = doc.get("createdAt")?.toDate?.() as Date | undefined;
  if (createdAt && Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000) return null;
  return { analysisId: doc.id, summary: doc.get("summary") };
}
