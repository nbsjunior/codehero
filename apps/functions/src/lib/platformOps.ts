import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase.ts";

export const PLATFORM_OPS_DOC = "platformOpsSettings/config";

export interface PlatformOpsConfig {
  /** When false, scheduled purge is a no-op. */
  purgeEnabled: boolean;
  /** Age of detail data before purge (days). Default 90 (3 months). */
  retentionDays: number;
  /** Minimum days between purge runs (scheduled job may fire more often). */
  purgeIntervalDays: number;
  purgeBatchSize: number;
  purgeLastRunAt: string | null;

  /** CI ingest defers issue BulkWriter to ingestJobs queue. */
  deferIssueWrites: boolean;
  /** Scheduled/manual repair of failed or stuck ingest jobs. */
  queueAutoRetry: boolean;
  /** Jobs in running/pending longer than this are considered stuck. */
  queueStuckMinutes: number;
  queueLastRepairAt: string | null;

  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_PLATFORM_OPS: Omit<PlatformOpsConfig, "updatedAt" | "updatedBy" | "purgeLastRunAt" | "queueLastRepairAt"> = {
  purgeEnabled: true,
  retentionDays: 90,
  purgeIntervalDays: 7,
  purgeBatchSize: 400,
  deferIssueWrites: true,
  queueAutoRetry: true,
  queueStuckMinutes: 30,
};

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function normalizeOpsInput(raw: Partial<PlatformOpsConfig> | Record<string, unknown>): Partial<typeof DEFAULT_PLATFORM_OPS> {
  const out: Partial<typeof DEFAULT_PLATFORM_OPS> = {};
  if (typeof raw.purgeEnabled === "boolean") out.purgeEnabled = raw.purgeEnabled;
  if (raw.retentionDays !== undefined) out.retentionDays = clampInt(raw.retentionDays, 7, 730, 90);
  if (raw.purgeIntervalDays !== undefined) out.purgeIntervalDays = clampInt(raw.purgeIntervalDays, 1, 90, 7);
  if (raw.purgeBatchSize !== undefined) out.purgeBatchSize = clampInt(raw.purgeBatchSize, 50, 500, 400);
  if (typeof raw.deferIssueWrites === "boolean") out.deferIssueWrites = raw.deferIssueWrites;
  if (typeof raw.queueAutoRetry === "boolean") out.queueAutoRetry = raw.queueAutoRetry;
  if (raw.queueStuckMinutes !== undefined) out.queueStuckMinutes = clampInt(raw.queueStuckMinutes, 5, 1440, 30);
  return out;
}

export async function getPlatformOpsConfig(): Promise<PlatformOpsConfig> {
  const snap = await db.doc(PLATFORM_OPS_DOC).get();
  const data = snap.data() ?? {};
  return {
    purgeEnabled: typeof data.purgeEnabled === "boolean" ? data.purgeEnabled : DEFAULT_PLATFORM_OPS.purgeEnabled,
    retentionDays: clampInt(data.retentionDays, 7, 730, DEFAULT_PLATFORM_OPS.retentionDays),
    purgeIntervalDays: clampInt(data.purgeIntervalDays, 1, 90, DEFAULT_PLATFORM_OPS.purgeIntervalDays),
    purgeBatchSize: clampInt(data.purgeBatchSize, 50, 500, DEFAULT_PLATFORM_OPS.purgeBatchSize),
    purgeLastRunAt: data.purgeLastRunAt?.toDate?.()?.toISOString?.() ?? null,
    deferIssueWrites:
      typeof data.deferIssueWrites === "boolean" ? data.deferIssueWrites : DEFAULT_PLATFORM_OPS.deferIssueWrites,
    queueAutoRetry: typeof data.queueAutoRetry === "boolean" ? data.queueAutoRetry : DEFAULT_PLATFORM_OPS.queueAutoRetry,
    queueStuckMinutes: clampInt(data.queueStuckMinutes, 5, 1440, DEFAULT_PLATFORM_OPS.queueStuckMinutes),
    queueLastRepairAt: data.queueLastRepairAt?.toDate?.()?.toISOString?.() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
    updatedBy: (data.updatedBy as string) ?? null,
  };
}

export async function savePlatformOpsConfig(
  patch: Partial<typeof DEFAULT_PLATFORM_OPS>,
  uid: string,
): Promise<PlatformOpsConfig> {
  await db.doc(PLATFORM_OPS_DOC).set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );
  return getPlatformOpsConfig();
}

export async function markPurgeRan(): Promise<void> {
  await db.doc(PLATFORM_OPS_DOC).set({ purgeLastRunAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function markQueueRepaired(): Promise<void> {
  await db.doc(PLATFORM_OPS_DOC).set({ queueLastRepairAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Whether the scheduled purge should execute now (enabled + interval elapsed). */
export function shouldRunPurgeNow(cfg: PlatformOpsConfig, now = new Date()): boolean {
  if (!cfg.purgeEnabled) return false;
  if (!cfg.purgeLastRunAt) return true;
  const last = new Date(cfg.purgeLastRunAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= cfg.purgeIntervalDays * 86_400_000;
}

export function stuckCutoff(cfg: PlatformOpsConfig, now = new Date()): Timestamp {
  return Timestamp.fromDate(new Date(now.getTime() - cfg.queueStuckMinutes * 60_000));
}
