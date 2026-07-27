import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db, repoRef } from "./lib/firebase.ts";
import { loadActiveRules } from "./lib/activeRules.ts";
import { downloadAndScanRepo, toSarifResults } from "./lib/repoScan.ts";
import { persistAnalysisResults } from "./lib/ingestCore.ts";

const DEFAULT_PERIODICITY_DAYS = 7;
const MIN_PERIODICITY_DAYS = 1;
const MAX_PERIODICITY_DAYS = 90;
// Cap on how many due repos one scheduled invocation scans, so a single run
// stays within the function's time budget — any repos left over are simply
// still "due" and get picked up on the next daily check.
const MAX_REPOS_PER_RUN = 20;

async function requireOrgAccess(uid: string, orgId: string): Promise<void> {
  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (member.exists) return;
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (admin.exists) return;
  throw new HttpsError("permission-denied", "not a member of this org");
}

interface SetAutoScanInput {
  orgId: string;
  projectId: string;
  repoId: string;
  enabled: boolean;
  periodicityDays?: number;
}

/**
 * Lets a project/repo admin enable/disable the weekly automatic scan for a
 * repo, and configure how often it runs (in days). Platform-wide graphs read
 * findings regardless of source (github-action vs auto-scan) — this only
 * controls whether auto-scan produces *new* findings for this repo.
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
    Math.max(MIN_PERIODICITY_DAYS, Math.round(request.data.periodicityDays ?? snap.get("autoScan")?.periodicityDays ?? DEFAULT_PERIODICITY_DAYS)),
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

/** Manual "run the auto-scan now" trigger for a project/repo admin — reuses the same pipeline the weekly job uses. */
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
 * Runs daily and scans any repo whose autoScan is enabled and due (its own
 * `periodicityDays` — default weekly — governs actual cadence, so this daily
 * check just looks for repos whose timer has elapsed). Uses the Admin SDK
 * collectionGroup query on a single boolean field (no composite index
 * needed) and filters "due" in memory.
 */
export const autoScanRepos = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const now = Date.now();
    const enabledSnap = await db.collectionGroup("repos").where("autoScan.enabled", "==", true).get();

    const due = enabledSnap.docs.filter((d) => {
      const nextRunAt = d.get("autoScan")?.nextRunAt?.toDate?.() ?? null;
      return !nextRunAt || nextRunAt.getTime() <= now;
    });

    let scanned = 0;
    let failed = 0;
    for (const d of due.slice(0, MAX_REPOS_PER_RUN)) {
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
              nextRunAt: new Date(now + periodicityDays * 86_400_000),
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

    logger.info("autoScanRepos complete", { dueCount: due.length, scanned, failed });
  },
);
