import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { db, storage, STORAGE_BUCKET_NAME } from "./lib/firebase.ts";
import { archiveAnalysisSnapshot, type AnalysisSummaryLike } from "./lib/analytics.ts";
import { cleanupIngestJobs } from "./ingestWorker.ts";
import {
  getPlatformOpsConfig,
  markPurgeRan,
  shouldRunPurgeNow,
  DEFAULT_PLATFORM_OPS,
} from "./lib/platformOps.ts";

/** Default detailed retention window (3 months) — overridable via platform ops settings. */
export const DETAIL_RETENTION_DAYS = DEFAULT_PLATFORM_OPS.retentionDays;

/**
 * Purge detailed analysis artifacts older than 90 days.
 *
 * KEPT forever (training / analytics):
 * - analyticsDaily / analyticsMonthly / analyticsRepos / analyticsArchives
 * - orgs/{orgId}/ruleforgeFeedback (false positives + confirmed for rule motor)
 * - issues with status === "false_positive" (extra FP signal)
 *
 * PURGED after 90 days:
 * - analyses docs + SARIF in Storage
 * - open/resolved issues (lastSeen older than cutoff)
 * - sddOutcomes, aged sddSpecs
 * - finished ingestJobs (older than 7 days)
 */
export async function runDetailPurge(options?: {
  batchSize?: number;
  retentionDays?: number;
}): Promise<{
  analysesDeleted: number;
  issuesDeleted: number;
  outcomesDeleted: number;
  specsDeleted: number;
  jobsCleaned: number;
  sarifDeleted: number;
}> {
  const retentionDays = options?.retentionDays ?? DETAIL_RETENTION_DAYS;
  const batchSize = options?.batchSize ?? 200;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const cutoffTs = Timestamp.fromDate(cutoff);

  let analysesDeleted = 0;
  let issuesDeleted = 0;
  let outcomesDeleted = 0;
  let specsDeleted = 0;
  let sarifDeleted = 0;

  // --- analyses + SARIF ---
  const analysesSnap = await db
    .collectionGroup("analyses")
    .where("createdAt", "<", cutoffTs)
    .limit(batchSize)
    .get();

  for (const doc of analysesSnap.docs) {
    const parts = doc.ref.path.split("/");
    // orgs/{org}/projects/{proj}/repos/{repo}/analyses/{id}
    const orgId = parts[1]!;
    const projectId = parts[3]!;
    const repoId = parts[5]!;
    const data = doc.data();
    const createdAt = data.createdAt?.toDate?.() ?? null;

    try {
      await archiveAnalysisSnapshot({
        orgId,
        projectId,
        repoId,
        analysisId: doc.id,
        createdAt,
        summary: (data.summary as AnalysisSummaryLike) ?? null,
        linesOfCode: typeof data.linesOfCode === "number" ? data.linesOfCode : 0,
        source: typeof data.source === "string" ? data.source : "unknown",
      });
    } catch (err) {
      logger.warn("archive before purge failed", { path: doc.ref.path, err: String(err) });
    }

    const sarifPath = typeof data.sarifPath === "string" ? data.sarifPath : null;
    if (sarifPath) {
      try {
        await storage.bucket(STORAGE_BUCKET_NAME).file(sarifPath).delete({ ignoreNotFound: true });
        sarifDeleted += 1;
      } catch (err) {
        logger.warn("SARIF delete failed", { sarifPath, err: String(err) });
      }
    }

    await doc.ref.delete();
    analysesDeleted += 1;
  }

  // --- issues (keep false_positive for training) ---
  const issuesSnap = await db
    .collectionGroup("issues")
    .where("lastSeen", "<", cutoffTs)
    .limit(batchSize)
    .get();

  const issueBatch = db.batch();
  let issueBatchCount = 0;
  for (const doc of issuesSnap.docs) {
    if (doc.get("status") === "false_positive") continue;
    issueBatch.delete(doc.ref);
    issueBatchCount += 1;
    issuesDeleted += 1;
  }
  if (issueBatchCount > 0) await issueBatch.commit();

  // --- sddOutcomes (telemetry noise, not FP corpus) ---
  const outcomesSnap = await db
    .collectionGroup("sddOutcomes")
    .where("createdAt", "<", cutoffTs)
    .limit(batchSize)
    .get();
  if (!outcomesSnap.empty) {
    const b = db.batch();
    for (const d of outcomesSnap.docs) {
      b.delete(d.ref);
      outcomesDeleted += 1;
    }
    await b.commit();
  }

  // --- aged SDD specs ---
  const specsSnap = await db
    .collectionGroup("sddSpecs")
    .where("createdAt", "<", cutoffTs)
    .limit(batchSize)
    .get();
  if (!specsSnap.empty) {
    const b = db.batch();
    for (const d of specsSnap.docs) {
      b.delete(d.ref);
      specsDeleted += 1;
    }
    await b.commit();
  }

  const jobsCleaned = await cleanupIngestJobs(7);

  return {
    analysesDeleted,
    issuesDeleted,
    outcomesDeleted,
    specsDeleted,
    jobsCleaned,
    sarifDeleted,
  };
}

/**
 * Daily tick — actual purge respects platform ops settings:
 * purgeEnabled, purgeIntervalDays, retentionDays, purgeBatchSize.
 */
export const purgeStaleDetail = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const cfg = await getPlatformOpsConfig();
    if (!shouldRunPurgeNow(cfg)) {
      logger.info("purgeStaleDetail skipped", {
        purgeEnabled: cfg.purgeEnabled,
        purgeIntervalDays: cfg.purgeIntervalDays,
        purgeLastRunAt: cfg.purgeLastRunAt,
      });
      return;
    }

    let total = {
      analysesDeleted: 0,
      issuesDeleted: 0,
      outcomesDeleted: 0,
      specsDeleted: 0,
      jobsCleaned: 0,
      sarifDeleted: 0,
    };
    for (let pass = 0; pass < 8; pass++) {
      const result = await runDetailPurge({
        batchSize: cfg.purgeBatchSize,
        retentionDays: cfg.retentionDays,
      });
      total = {
        analysesDeleted: total.analysesDeleted + result.analysesDeleted,
        issuesDeleted: total.issuesDeleted + result.issuesDeleted,
        outcomesDeleted: total.outcomesDeleted + result.outcomesDeleted,
        specsDeleted: total.specsDeleted + result.specsDeleted,
        jobsCleaned: total.jobsCleaned + result.jobsCleaned,
        sarifDeleted: total.sarifDeleted + result.sarifDeleted,
      };
      if (
        result.analysesDeleted === 0 &&
        result.issuesDeleted === 0 &&
        result.outcomesDeleted === 0 &&
        result.specsDeleted === 0
      ) {
        break;
      }
    }
    await markPurgeRan();
    logger.info("purgeStaleDetail complete", { retentionDays: cfg.retentionDays, ...total });
  },
);

/** Platform-admin manual trigger (bypasses interval; still uses configured retention). */
export const runDetailPurgeNow = onCall(
  { timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
    const admin = await db.doc(`platformAdmins/${uid}`).get();
    if (!admin.exists) throw new HttpsError("permission-denied", "platform admin only");
    const cfg = await getPlatformOpsConfig();
    if (!cfg.purgeEnabled) {
      throw new HttpsError("failed-precondition", "expurgo desabilitado nas configurações da plataforma");
    }
    const result = await runDetailPurge({
      batchSize: cfg.purgeBatchSize,
      retentionDays: cfg.retentionDays,
    });
    await markPurgeRan();
    return result;
  },
);
