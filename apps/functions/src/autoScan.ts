import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { db, repoRef } from "./lib/firebase.ts";
import { loadActiveRules } from "./lib/activeRules.ts";
import { downloadAndScanRepo, toSarifResults } from "./lib/repoScan.ts";
import { persistAnalysisResults } from "./lib/ingestCore.ts";
import { assertBuildQuota, incrementBuildQuota } from "./lib/quotas.ts";
import { observe } from "./lib/observability.ts";

const DEFAULT_PERIODICITY_DAYS = 7;
const MIN_PERIODICITY_DAYS = 1;
const MAX_PERIODICITY_DAYS = 90;
const SHARD_COUNT = 24;
/**
 * Upper bound on repos considered per hourly shard run — a safety cap, not
 * the real throughput limiter (that's TIME_BUDGET_MS below, since repo scans
 * are now processed concurrently rather than one at a time). At 20k repos on
 * the default 7-day cadence, ~2,857 repos/day need to cycle through; with
 * CONCURRENCY workers and a ~480s usable budget per run, this clears that
 * bar with headroom (any leftovers just get picked up on the next run).
 */
const MAX_REPOS_PER_SHARD = 300;
/** Parallel repo scans per shard run. Each is a zip download + regex scan, not CPU-heavy, so this stays well within 1GiB. */
const CONCURRENCY = 8;
/** Stop starting new repos once this much of the 540s function timeout has elapsed — leaves buffer to finish in-flight work cleanly. */
const TIME_BUDGET_MS = 480_000;

async function requireOrgAccess(uid: string, orgId: string): Promise<void> {
  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (member.exists) return;
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (admin.exists) return;
  throw new HttpsError("permission-denied", "not a member of this org");
}

/** Stable 0..SHARD_COUNT-1 bucket from repo id (spreads load across the day). */
export function autoScanShard(repoId: string): number {
  const h = createHash("sha256").update(repoId).digest();
  return h.readUInt32BE(0) % SHARD_COUNT;
}

interface SetAutoScanInput {
  orgId: string;
  projectId: string;
  repoId: string;
  enabled: boolean;
  periodicityDays?: number;
}

/**
 * Lets a project/repo admin enable/disable automatic scan for a repo, and
 * configure how often it runs (in days).
 */
export const setRepoAutoScan = onCall<SetAutoScanInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId, repoId, enabled } = request.data ?? ({} as SetAutoScanInput);
  if (!orgId || !projectId || !repoId || typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "orgId, projectId, repoId and enabled are required");
  }
  await requireOrgAccess(uid, orgId);

  const rRef = repoRef(orgId, projectId, repoId);
  const snap = await rRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "repo not found");

  const periodicityDays = Math.min(
    MAX_PERIODICITY_DAYS,
    Math.max(
      MIN_PERIODICITY_DAYS,
      Math.round(
        request.data.periodicityDays ?? snap.get("autoScan")?.periodicityDays ?? DEFAULT_PERIODICITY_DAYS,
      ),
    ),
  );
  const nextRunAt = enabled ? new Date(Date.now() + periodicityDays * 86_400_000) : null;

  await rRef.set(
    {
      autoScan: {
        enabled,
        periodicityDays,
        nextRunAt,
        updatedAt: new Date(),
        updatedBy: uid,
      },
    },
    { merge: true },
  );

  return { enabled, periodicityDays, nextRunAt: nextRunAt?.toISOString() ?? null };
});

async function scanAndPersistRepo(
  orgId: string,
  projectId: string,
  repoId: string,
  repoUrl: string,
): Promise<void> {
  await assertBuildQuota(orgId);

  const work = join(tmpdir(), `codehero-autoscan-${repoId.slice(0, 8)}-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    const active = await loadActiveRules(orgId, projectId);
    const { findings, linesOfCode } = await downloadAndScanRepo(repoUrl, active.rules, work);
    await persistAnalysisResults({
      orgId,
      projectId,
      repoId,
      results: toSarifResults(findings),
      branch: "main",
      commit: null,
      linesOfCode: Math.max(1, linesOfCode),
      sarifPath: null,
      source: "auto-scan",
    });
    await incrementBuildQuota(orgId);
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

interface RunNowInput {
  orgId: string;
  projectId: string;
  repoId: string;
}

/** Manual "run the auto-scan now" trigger for a project/repo admin. */
export const runRepoAutoScanNow = onCall<RunNowInput>(
  { timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

    const { orgId, projectId, repoId } = request.data ?? ({} as RunNowInput);
    if (!orgId || !projectId || !repoId) {
      throw new HttpsError("invalid-argument", "orgId, projectId and repoId are required");
    }
    await requireOrgAccess(uid, orgId);

    const rRef = repoRef(orgId, projectId, repoId);
    const snap = await rRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "repo not found");
    const repoUrl = snap.get("repoUrl");
    if (!repoUrl) throw new HttpsError("failed-precondition", "repo has no repoUrl configured");

    await scanAndPersistRepo(orgId, projectId, repoId, repoUrl);

    const periodicityDays = snap.get("autoScan")?.periodicityDays ?? DEFAULT_PERIODICITY_DAYS;
    await rRef.set(
      {
        autoScan: {
          lastRunAt: new Date(),
          nextRunAt: new Date(Date.now() + periodicityDays * 86_400_000),
        },
      },
      { merge: true },
    );

    return { ok: true };
  },
);

/**
 * Hourly shard runner: at hour H, only repos with autoScanShard(repoId) === H
 * are considered. Combined with nextRunAt, this spreads ~100k repos across
 * the day without a single 540s timeout blowing up.
 */
export const autoScanRepos = onSchedule(
  {
    schedule: "20 * * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const startedAt = Date.now();
    const shard = new Date().getHours() % SHARD_COUNT;
    const enabledSnap = await db.collectionGroup("repos").where("autoScan.enabled", "==", true).get();

    const due = enabledSnap.docs.filter((d) => {
      const repoId = d.id;
      if (autoScanShard(repoId) !== shard) return false;
      const nextRunAt = d.get("autoScan")?.nextRunAt?.toDate?.() ?? null;
      return !nextRunAt || nextRunAt.getTime() <= startedAt;
    });
    const candidates = due.slice(0, MAX_REPOS_PER_SHARD);

    let scanned = 0;
    let failed = 0;
    let cursor = 0;

    // Bounded-concurrency worker pool, self-limiting on a wall-clock budget
    // rather than a fixed repo count — throughput adapts to how long repos
    // actually take to scan instead of a guessed constant.
    async function worker(): Promise<void> {
      for (;;) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) return;
        const i = cursor++;
        if (i >= candidates.length) return;
        const d = candidates[i]!;
        const parts = d.ref.path.split("/"); // orgs/{orgId}/projects/{projectId}/repos/{repoId}
        const orgId = parts[1]!;
        const projectId = parts[3]!;
        const repoId = parts[5]!;
        const repoUrl = d.get("repoUrl");
        const periodicityDays = d.get("autoScan")?.periodicityDays ?? DEFAULT_PERIODICITY_DAYS;
        if (!repoUrl) continue;

        try {
          await scanAndPersistRepo(orgId, projectId, repoId, repoUrl);
          await d.ref.set(
            {
              autoScan: {
                lastRunAt: new Date(),
                nextRunAt: new Date(Date.now() + periodicityDays * 86_400_000),
              },
            },
            { merge: true },
          );
          scanned += 1;
        } catch (err) {
          failed += 1;
          logger.error("autoScanRepos: repo scan failed", { orgId, projectId, repoId, err: String(err) });
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    observe("autoscan.shard_complete", {
      shard,
      dueCount: due.length,
      candidateCount: candidates.length,
      scanned,
      failed,
      elapsedMs: Date.now() - startedAt,
    });
    logger.info("autoScanRepos complete", { shard, dueCount: due.length, scanned, failed });
  },
);
