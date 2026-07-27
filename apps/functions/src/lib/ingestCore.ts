import { FieldValue } from "firebase-admin/firestore";
import {
  technicalDebtMinutes,
  technicalDebtRatio,
  maintainabilityRating,
  ratingFromWorstSeverity,
  evaluateQualityGate,
  SEVERITIES,
  type Severity,
  type SarifResult,
} from "@codehero/contracts";
import { db, repoRef } from "./firebase.ts";
import { recomputeProjectAggregate } from "./projectAggregate.ts";

export interface PersistAnalysisInput {
  orgId: string;
  projectId: string;
  repoId: string;
  results: SarifResult[];
  branch: string;
  commit?: string | null;
  linesOfCode: number;
  newCodeFingerprints?: string[];
  sarifPath?: string | null;
  /** How this analysis was produced — surfaced in the analysis doc for the admin UI. */
  source: "github-action" | "auto-scan" | "cli";
}

export interface PersistAnalysisResult {
  analysisId: string;
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    debtMinutes: number;
    debtRatio: number;
    maintainabilityRating: string;
    securityRating: string;
    qualityGate: { status: "PASSED" | "FAILED"; failedConditions: string[] };
  };
}

/**
 * Shared core of "an analysis happened for this repo": upserts issues,
 * computes SQALE debt + quality gate, records an analysis snapshot, updates
 * the repo doc, and rolls the project-level aggregate up. Used by both the
 * GitHub Action ingest endpoint (SARIF from CI) and the weekly auto-scan job
 * (SARIF-shaped results built directly from rule matches) — one code path,
 * so a repo's numbers mean the same thing regardless of how the scan ran.
 */
export async function persistAnalysisResults(input: PersistAnalysisInput): Promise<PersistAnalysisResult> {
  const { orgId, projectId, repoId, results, branch, commit, linesOfCode, source } = input;
  const newSet = new Set(input.newCodeFingerprints ?? []);
  const rRef = repoRef(orgId, projectId, repoId);
  const analysisId = `${Date.now()}`;
  const now = FieldValue.serverTimestamp();

  const bySeverity: Record<Severity, number> = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  const codeSmellEfforts: number[] = [];
  const presentSeverities: Severity[] = [];
  let newBlockerIssues = 0;

  // A single WriteBatch caps at 500 operations — a large legacy repo (COBOL/
  // Java monoliths routinely exceed this per analysis) would silently throw
  // past that limit. BulkWriter auto-batches/paginates and retries.
  const bulkWriter = db.bulkWriter();
  for (const r of results) {
    const fp = r.partialFingerprints?.["heroHash/v1"] ?? `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const loc = r.locations?.[0]?.physicalLocation;
    const isNewCode = newSet.has(fp);

    if (SEVERITIES.includes(sev)) {
      bySeverity[sev] += 1;
      presentSeverities.push(sev);
    }
    if (issueType === "CODE_SMELL") codeSmellEfforts.push(r.properties?.remediationEffortMin ?? 0);
    if (sev === "BLOCKER" && isNewCode) newBlockerIssues += 1;

    const issueRef = rRef.collection("issues").doc(fp);
    bulkWriter.set(
      issueRef,
      {
        fingerprint: fp,
        ruleId: r.ruleId,
        severity: sev,
        issueType,
        message: r.message?.text ?? "",
        file: loc?.artifactLocation?.uri ?? "",
        line: loc?.region?.startLine ?? 0,
        column: loc?.region?.startColumn ?? 0,
        snippet: r.properties?.snippet ?? loc?.region?.snippet?.text ?? "",
        remediationEffortMin: r.properties?.remediationEffortMin ?? 0,
        sddTemplateId: r.properties?.sddTemplateId ?? null,
        status: "open",
        isNewCode,
        branch,
        source,
        lastSeen: now,
        lastAnalysisId: analysisId,
        firstSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await bulkWriter.close();

  const debtMin = technicalDebtMinutes(codeSmellEfforts);
  const debtRatio = technicalDebtRatio(debtMin, linesOfCode);
  const maintRating = maintainabilityRating(debtRatio);
  const securityRating = ratingFromWorstSeverity(
    presentSeverities.filter((_, i) => (results[i]?.properties?.issueType ?? "") === "VULNERABILITY"),
  );
  const gate = evaluateQualityGate({
    newCodeCoverage: 100, // coverage not yet wired — treated as passing for MVP
    newCodeDuplication: 0,
    newBlockerIssues,
    securityRating,
    maintainabilityRating: maintRating,
  });

  const summary: PersistAnalysisResult["summary"] = {
    total: results.length,
    bySeverity,
    debtMinutes: debtMin,
    debtRatio,
    maintainabilityRating: maintRating,
    securityRating,
    qualityGate: gate,
  };

  await rRef.collection("analyses").doc(analysisId).set({
    analysisId,
    branch,
    commit: commit ?? null,
    createdAt: now,
    sarifPath: input.sarifPath ?? null,
    linesOfCode,
    source,
    summary,
  });

  await rRef.set(
    {
      lastAnalysisId: analysisId,
      lastAnalyzedAt: now,
      lastAnalysisSource: source,
      debtMinutes: debtMin,
      maintainabilityRating: maintRating,
      securityRating,
      qualityGateStatus: gate.status,
      openIssues: results.length,
    },
    { merge: true },
  );

  // Roll the repo's fresh metrics up into the project-level consolidation
  // (dashboard/admin read this one doc instead of fanning out to every repo).
  await recomputeProjectAggregate(orgId, projectId);

  return { analysisId, summary };
}
