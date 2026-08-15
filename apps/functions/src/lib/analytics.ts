import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase.ts";

export interface AnalysisSummaryLike {
  total: number;
  bySeverity: Record<string, number>;
  debtMinutes: number;
  debtRatio: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGate: { status: string; failedConditions?: string[] };
  coveragePercent?: number | null;
  duplicationPercent?: number | null;
  gateSuppressedCount?: number;
}

/** Increment daily + per-repo analytical rollups (survives detail purge). */
export async function recordAnalysisAnalytics(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  linesOfCode: number;
  source: string;
  summary: AnalysisSummaryLike;
  analyzedAt?: Date;
}): Promise<void> {
  const at = input.analyzedAt ?? new Date();
  const day = at.toISOString().slice(0, 10);
  const month = day.slice(0, 7);

  const dailyRef = db.doc(`analyticsDaily/${day}`);
  const monthlyRef = db.doc(`analyticsMonthly/${month}`);
  const repoKey = `${input.orgId}_${input.projectId}_${input.repoId}`;
  const repoAnalyticsRef = db.doc(`analyticsRepos/${repoKey}`);

  const sevInc: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.summary.bySeverity ?? {})) {
    sevInc[`bySeverity.${k}`] = v;
  }

  const baseInc = {
    builds: 1,
    findings: input.summary.total,
    linesOfCode: input.linesOfCode,
    debtMinutes: input.summary.debtMinutes,
    gatePassed: input.summary.qualityGate.status === "PASSED" ? 1 : 0,
    gateFailed: input.summary.qualityGate.status === "FAILED" ? 1 : 0,
    ...sevInc,
  };

  const batch = db.batch();
  batch.set(
    dailyRef,
    {
      day,
      updatedAt: FieldValue.serverTimestamp(),
      ...Object.fromEntries(Object.entries(baseInc).map(([k, v]) => [k, FieldValue.increment(v)])),
    },
    { merge: true },
  );
  batch.set(
    monthlyRef,
    {
      month,
      updatedAt: FieldValue.serverTimestamp(),
      ...Object.fromEntries(Object.entries(baseInc).map(([k, v]) => [k, FieldValue.increment(v)])),
    },
    { merge: true },
  );
  batch.set(
    repoAnalyticsRef,
    {
      orgId: input.orgId,
      projectId: input.projectId,
      repoId: input.repoId,
      lastBuildAt: Timestamp.fromDate(at),
      lastSource: input.source,
      lastSummary: input.summary,
      lastLinesOfCode: input.linesOfCode,
      updatedAt: FieldValue.serverTimestamp(),
      builds: FieldValue.increment(1),
      findings: FieldValue.increment(input.summary.total),
      linesOfCodeSampled: FieldValue.increment(input.linesOfCode),
    },
    { merge: true },
  );
  await batch.commit();
}

/** Snapshot kept when purging a detailed analysis doc. */
export async function archiveAnalysisSnapshot(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  analysisId: string;
  createdAt: Date | null;
  summary: AnalysisSummaryLike | null;
  linesOfCode: number;
  source: string;
}): Promise<void> {
  const day = (input.createdAt ?? new Date()).toISOString().slice(0, 10);
  await db.collection("analyticsArchives").add({
    orgId: input.orgId,
    projectId: input.projectId,
    repoId: input.repoId,
    analysisId: input.analysisId,
    day,
    summary: input.summary,
    linesOfCode: input.linesOfCode,
    source: input.source,
    archivedAt: FieldValue.serverTimestamp(),
    originalCreatedAt: input.createdAt ? Timestamp.fromDate(input.createdAt) : null,
  });
}
