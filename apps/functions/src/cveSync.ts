import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { db } from "./lib/firebase.ts";
import { syncCveWatchlist, listCveWatchlistEntries } from "./lib/cveWatchlist.ts";

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "platform admin required");
}

/**
 * Weekly (advisories don't churn hour-to-hour): pulls recent GitHub Security
 * Advisories per tracked ecosystem into `cveWatchlist`, which
 * ruleforgeDaily's new-rule prompt reads from — grounding rule proposals in
 * real, current CVEs instead of the LLM's frozen training knowledge.
 */
export const cveWatchlistSync = onSchedule(
  {
    schedule: "0 5 * * 0", // Sundays 05:00 America/Sao_Paulo
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const result = await syncCveWatchlist();
    logger.info("cveWatchlistSync complete", result);
  },
);

/** Manual trigger for admins (mirrors runRuleforgeDaily's pattern). */
export const runCveWatchlistSyncNow = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "sign-in required");
    await requirePlatformAdmin(request.auth.uid);
    return syncCveWatchlist();
  },
);

/** Lets the admin see what's currently grounding the daily rule-proposal engine. */
export const listCveWatchlist = onCall<{ limit?: number }>(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(request.auth.uid);
  const limit = Math.min(200, Math.max(1, request.data?.limit ?? 100));
  const entries = await listCveWatchlistEntries(limit);
  return { entries };
});
