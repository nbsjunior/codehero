import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase.ts";
import {
  getPlatformOpsConfig,
  savePlatformOpsConfig,
  normalizeOpsInput,
  markQueueRepaired,
  stuckCutoff,
  type PlatformOpsConfig,
} from "./lib/platformOps.ts";

async function requirePlatformAdmin(uid: string | undefined): Promise<string> {
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "platform admin only");
  return uid;
}

export const getPlatformOpsSettings = onCall(async (request) => {
  await requirePlatformAdmin(request.auth?.uid);
  const config = await getPlatformOpsConfig();
  const queue = await countIngestJobs();
  return { config, queue };
});

export const setPlatformOpsSettings = onCall<{
  purgeEnabled?: boolean;
  retentionDays?: number;
  purgeIntervalDays?: number;
  purgeBatchSize?: number;
  deferIssueWrites?: boolean;
  queueAutoRetry?: boolean;
  queueStuckMinutes?: number;
}>(async (request) => {
  const uid = await requirePlatformAdmin(request.auth?.uid);
  const patch = normalizeOpsInput(request.data ?? {});
  if (Object.keys(patch).length === 0) {
    throw new HttpsError("invalid-argument", "no valid settings provided");
  }
  const config = await savePlatformOpsConfig(patch, uid);
  logger.info("platform ops settings updated", { uid, patch });
  return { config };
});

async function countIngestJobs(): Promise<{
  pending: number;
  running: number;
  failed: number;
  done: number;
}> {
  const statuses = ["pending", "running", "failed", "done"] as const;
  const counts = { pending: 0, running: 0, failed: 0, done: 0 };
  await Promise.all(
    statuses.map(async (status) => {
      const snap = await db.collection("ingestJobs").where("status", "==", status).count().get();
      counts[status] = snap.data().count;
    }),
  );
  return counts;
}

/**
 * Re-queue failed and stuck ingest jobs by creating fresh pending docs
 * (onDocumentCreated only fires on create — cannot reuse the same doc).
 */
export async function repairIngestQueuesCore(limit = 100): Promise<{
  requeued: number;
  markedSuperseded: number;
}> {
  const cfg = await getPlatformOpsConfig();
  const cutoff = stuckCutoff(cfg);
  let requeued = 0;
  let markedSuperseded = 0;

  const failedSnap = await db.collection("ingestJobs").where("status", "==", "failed").limit(limit).get();
  const stuckSnap = await db
    .collection("ingestJobs")
    .where("status", "==", "running")
    .where("createdAt", "<", cutoff)
    .limit(limit)
    .get();

  // Also pick very old pending (never picked up).
  const stalePendingSnap = await db
    .collection("ingestJobs")
    .where("status", "==", "pending")
    .where("createdAt", "<", cutoff)
    .limit(Math.min(50, limit))
    .get();

  const candidates = [...failedSnap.docs, ...stuckSnap.docs, ...stalePendingSnap.docs];
  const seen = new Set<string>();

  for (const doc of candidates) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const data = doc.data();
    if (!data?.orgId || !data?.sarifPath || !data?.analysisId) {
      await doc.ref.set({ status: "superseded", error: "incomplete_payload" }, { merge: true });
      markedSuperseded += 1;
      continue;
    }

    await db.collection("ingestJobs").add({
      orgId: data.orgId,
      projectId: data.projectId,
      repoId: data.repoId,
      analysisId: data.analysisId,
      sarifPath: data.sarifPath,
      branch: data.branch ?? "main",
      source: data.source ?? "github-action",
      newCodeFingerprints: data.newCodeFingerprints ?? [],
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
      repairedFrom: doc.id,
    });
    await doc.ref.set(
      { status: "superseded", supersededAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    requeued += 1;
    markedSuperseded += 1;
  }

  await markQueueRepaired();
  return { requeued, markedSuperseded };
}

export const repairIngestQueues = onCall(
  { timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    await requirePlatformAdmin(request.auth?.uid);
    const result = await repairIngestQueuesCore(150);
    const queue = await countIngestJobs();
    logger.info("repairIngestQueues", result);
    return { ...result, queue };
  },
);

/** Hourly: if queueAutoRetry is on, re-queue failed/stuck jobs. */
export const autoRepairIngestQueues = onSchedule(
  {
    schedule: "35 * * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const cfg = await getPlatformOpsConfig();
    if (!cfg.queueAutoRetry) {
      logger.info("autoRepairIngestQueues skipped (disabled)");
      return;
    }
    const result = await repairIngestQueuesCore(80);
    logger.info("autoRepairIngestQueues", result);
  },
);

export type { PlatformOpsConfig };
