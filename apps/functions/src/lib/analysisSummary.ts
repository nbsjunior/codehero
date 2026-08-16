import {
  technicalDebtMinutes,
  technicalDebtRatio,
  maintainabilityRating,
  ratingFromWorstSeverity,
  evaluateQualityGate,
  mergeQualityGate,
  SEVERITIES,
  type Severity,
  type QualityGateThresholds,
  type SarifResult,
} from "@codehero/contracts";

export type AnalysisSummary = {
  total: number;
  bySeverity: Record<Severity, number>;
  /** Contagem por tipo (CODE_SMELL, BUG, …) — base da série histórica de smells. */
  byType: Record<string, number>;
  codeSmellCount: number;
  debtMinutes: number;
  debtRatio: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGate: { status: "PASSED" | "FAILED"; failedConditions: string[] };
  /** Cobertura de linhas medida; `null` = não enviada (gate pula a condição). */
  coveragePercent: number | null;
  /** Duplicação % medida; `null` = não enviada. */
  duplicationPercent: number | null;
  /** Cobertura de branches; `null` = não enviada. */
  branchCoveragePercent: number | null;
  /** Findings fora do gate por FP local alto (ruleRepoFpRate). */
  gateSuppressedCount: number;
};

/**
 * Calcula o summary da analysis (puro — sem I/O).
 *
 * Regras de escopo:
 * - Débito / maintainabilityRating: sempre o inventário completo (evita PR
 *   “limpo” zerar a dívida do repo no dashboard).
 * - Blockers no gate: com fingerprints → só código novo; sem → todos.
 * - Security no gate: com fingerprints → só vulns novas; rating persistido
 *   continua overall.
 * - gateSuppressed: fora do gate e fora da dívida/ratings.
 */
export function computeAnalysisSummary(
  results: SarifResult[],
  linesOfCode: number,
  newCodeFingerprints?: string[],
  /**
   * Percentual de cobertura medido, ou `null` quando o build não enviou
   * relatório. `null` PULA a condição no gate.
   *
   * Hoje o SARIF carrega cobertura **global** do relatório (não “código novo”).
   */
  coveragePercent?: number | null,
  duplicationPercent?: number | null,
  qualityGateThresholds?: QualityGateThresholds | null,
  branchCoveragePercent?: number | null,
): AnalysisSummary {
  const newSet = new Set(newCodeFingerprints ?? []);
  const scopeToNewCode = newSet.size > 0;
  const bySeverity: Record<Severity, number> = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  const byType: Record<string, number> = {};
  const codeSmellEffortsOverall: number[] = [];
  const vulnSeveritiesOverall: Severity[] = [];
  const vulnSeveritiesForGate: Severity[] = [];
  let newBlockerIssues = 0;
  let codeSmellCount = 0;
  let gateSuppressedCount = 0;

  for (const r of results) {
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const fp =
      r.partialFingerprints?.["heroHash/v1"] ??
      `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    const inNewCode = newSet.has(fp);
    const gateSuppressed = r.properties?.gateSuppressed === true;

    if (SEVERITIES.includes(sev)) bySeverity[sev] += 1;
    byType[issueType] = (byType[issueType] ?? 0) + 1;
    if (issueType === "CODE_SMELL") codeSmellCount += 1;
    if (gateSuppressed) gateSuppressedCount += 1;

    const blockerInScope = scopeToNewCode ? inNewCode : true;
    if (!gateSuppressed && sev === "BLOCKER" && blockerInScope) newBlockerIssues += 1;

    if (gateSuppressed) continue;

    if (issueType === "CODE_SMELL") {
      codeSmellEffortsOverall.push(r.properties?.remediationEffortMin ?? 0);
    }
    if (issueType === "VULNERABILITY" && SEVERITIES.includes(sev)) {
      vulnSeveritiesOverall.push(sev);
      if (!scopeToNewCode || inNewCode) vulnSeveritiesForGate.push(sev);
    }
  }

  const debtMin = technicalDebtMinutes(codeSmellEffortsOverall);
  const debtRatio = technicalDebtRatio(debtMin, linesOfCode);
  const maintRating = maintainabilityRating(debtRatio);
  const securityRating = ratingFromWorstSeverity(vulnSeveritiesOverall);
  const securityForGate = ratingFromWorstSeverity(vulnSeveritiesForGate);
  const cov =
    typeof coveragePercent === "number" && Number.isFinite(coveragePercent) ? coveragePercent : null;
  const dupe =
    typeof duplicationPercent === "number" && Number.isFinite(duplicationPercent)
      ? duplicationPercent
      : null;
  const branchCov =
    typeof branchCoveragePercent === "number" && Number.isFinite(branchCoveragePercent)
      ? branchCoveragePercent
      : null;
  const gate = evaluateQualityGate(
    {
      newCodeCoverage: cov,
      branchCoverage: branchCov,
      newCodeDuplication: dupe,
      newBlockerIssues,
      securityRating: securityForGate,
      maintainabilityRating: maintRating,
    },
    mergeQualityGate(qualityGateThresholds),
  );

  return {
    total: results.length,
    bySeverity,
    byType,
    codeSmellCount,
    debtMinutes: debtMin,
    debtRatio,
    maintainabilityRating: maintRating,
    securityRating,
    qualityGate: gate,
    coveragePercent: cov,
    duplicationPercent: dupe,
    branchCoveragePercent: branchCov,
    gateSuppressedCount,
  };
}
