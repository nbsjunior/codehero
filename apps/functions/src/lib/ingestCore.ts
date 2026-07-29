import { FieldValue } from "firebase-admin/firestore";
import {
  technicalDebtMinutes,
  technicalDebtRatio,
  maintainabilityRating,
  ratingFromWorstSeverity,
  evaluateQualityGate,
  SEVERITIES,
  type Severity,
  coveragePercent as coveragePct,
  type CoverageCounter,
  type SarifLog,
  type SarifResult,
} from "@codehero/contracts";
import { db, repoRef } from "./firebase.ts";
import { recomputeProjectAggregate } from "./projectAggregate.ts";
import { recordAnalysisAnalytics } from "./analytics.ts";

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
  source: "github-action" | "auto-scan" | "cli";
  /** Stable key so CI retries do not create duplicate analyses. */
  idempotencyKey?: string | null;
  /** When true, only write analysis/repo metrics — issues go to ingestJobs worker. */
  deferIssueWrites?: boolean;
  /** Cobertura medida no build; `null`/ausente pula a condição do gate. */
  coveragePercent?: number | null;
  analysisId?: string;
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
 * Extrai o percentual de cobertura das `properties` do run do SARIF, onde o
 * scanner o deposita. Ausente → `null`, que o gate trata como não medido.
 */
export function coverageFromSarif(sarif: SarifLog): number | null {
  const raw = (sarif.runs?.[0] as { properties?: { coverage?: { lines?: CoverageCounter } } })
    ?.properties?.coverage?.lines;
  if (!raw || typeof raw.total !== "number" || raw.total <= 0) return null;
  return coveragePct(raw);
}

export function computeAnalysisSummary(
  results: SarifResult[],
  linesOfCode: number,
  newCodeFingerprints?: string[],
  /**
   * Percentual de cobertura medido, ou `null` quando o build não enviou
   * relatório. `null` PULA a condição no gate — antes daqui passava um `100`
   * fixo, que fazia a condição existir no papel e nunca reprovar nada.
   */
  coveragePercent?: number | null,
): PersistAnalysisResult["summary"] {
  const newSet = new Set(newCodeFingerprints ?? []);
  const bySeverity: Record<Severity, number> = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  const codeSmellEfforts: number[] = [];
  const vulnSeverities: Severity[] = [];
  let newBlockerIssues = 0;

  for (const r of results) {
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const fp = r.partialFingerprints?.["heroHash/v1"] ?? `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    if (SEVERITIES.includes(sev)) bySeverity[sev] += 1;
    if (issueType === "CODE_SMELL") codeSmellEfforts.push(r.properties?.remediationEffortMin ?? 0);
    if (issueType === "VULNERABILITY" && SEVERITIES.includes(sev)) vulnSeverities.push(sev);
    if (sev === "BLOCKER" && newSet.has(fp)) newBlockerIssues += 1;
  }

  const debtMin = technicalDebtMinutes(codeSmellEfforts);
  const debtRatio = technicalDebtRatio(debtMin, linesOfCode);
  const maintRating = maintainabilityRating(debtRatio);
  const securityRating = ratingFromWorstSeverity(vulnSeverities);
  const gate = evaluateQualityGate({
    newCodeCoverage: coveragePercent ?? null,
    // Duplicação ainda não é medida — `null` para não fingir aprovação.
    newCodeDuplication: null,
    newBlockerIssues,
    securityRating,
    maintainabilityRating: maintRating,
  });

  return {
    total: results.length,
    bySeverity,
    debtMinutes: debtMin,
    debtRatio,
    maintainabilityRating: maintRating,
    securityRating,
    qualityGate: gate,
  };
}

/** Upsert issue docs from SARIF results (BulkWriter). Used sync or by ingest worker. */
export async function upsertIssuesFromResults(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  results: SarifResult[];
  branch: string;
  source: string;
  analysisId: string;
  newCodeFingerprints?: string[];
}): Promise<void> {
  const newSet = new Set(input.newCodeFingerprints ?? []);
  const rRef = repoRef(input.orgId, input.projectId, input.repoId);
  const now = FieldValue.serverTimestamp();
  const bulkWriter = db.bulkWriter();

  for (const r of input.results) {
    const fp =
      r.partialFingerprints?.["heroHash/v1"] ??
      `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const loc = r.locations?.[0]?.physicalLocation;

    bulkWriter.set(
      rRef.collection("issues").doc(fp),
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
        risk: r.properties?.risk ?? null,
        reason: r.properties?.reason ?? null,
        howToFix: r.properties?.howToFix ?? null,
        strategy: r.properties?.strategy ?? null,
        constraints: r.properties?.constraints ?? [],
        referenceExample: r.properties?.referenceExample ?? null,
        cwe: r.properties?.cwe ?? [],
        status: "open",
        isNewCode: newSet.has(fp),
        branch: input.branch,
        source: input.source,
        lastSeen: now,
        lastAnalysisId: input.analysisId,
        firstSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await bulkWriter.close();
}

/**
 * Shared core of "an analysis happened for this repo": upserts issues (unless
 * deferred), computes debt + quality gate, records analysis snapshot, updates
 * repo metrics + project rollup + analytics.
 */
export async function persistAnalysisResults(input: PersistAnalysisInput): Promise<PersistAnalysisResult> {
  const { orgId, projectId, repoId, results, branch, commit, linesOfCode, source } = input;
  const rRef = repoRef(orgId, projectId, repoId);
  const analysisId = input.analysisId ?? `${Date.now()}`;
  const now = FieldValue.serverTimestamp();
  const summary = computeAnalysisSummary(
    results,
    linesOfCode,
    input.newCodeFingerprints,
    input.coveragePercent,
  );

  if (!input.deferIssueWrites) {
    await upsertIssuesFromResults({
      orgId,
      projectId,
      repoId,
      results,
      branch,
      source,
      analysisId,
      newCodeFingerprints: input.newCodeFingerprints,
    });
  }

  await rRef.collection("analyses").doc(analysisId).set({
    analysisId,
    branch,
    commit: commit ?? null,
    createdAt: now,
    sarifPath: input.sarifPath ?? null,
    linesOfCode,
    source,
    summary,
    idempotencyKey: input.idempotencyKey ?? null,
    issuesPending: !!input.deferIssueWrites,
  });

  await rRef.set(
    {
      lastAnalysisId: analysisId,
      lastAnalyzedAt: now,
      lastAnalysisSource: source,
      debtMinutes: summary.debtMinutes,
      maintainabilityRating: summary.maintainabilityRating,
      securityRating: summary.securityRating,
      qualityGateStatus: summary.qualityGate.status,
      openIssues: results.length,
    },
    { merge: true },
  );

  await recomputeProjectAggregate(orgId, projectId);

  try {
    await recordAnalysisAnalytics({
      orgId,
      projectId,
      repoId,
      linesOfCode,
      source,
      summary,
    });
  } catch {
    /* analytics must not fail the ingest */
  }

  return { analysisId, summary };
}

/** Enqueue deferred issue upserts (Firestore queue — no Pub/Sub topic ops required). */
export async function enqueueIssueUpsertJob(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  analysisId: string;
  sarifPath: string;
  branch: string;
  source: string;
  newCodeFingerprints?: string[];
}): Promise<string> {
  const ref = db.collection("ingestJobs").doc();
  await ref.set({
    ...input,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
  });
  return ref.id;
}
