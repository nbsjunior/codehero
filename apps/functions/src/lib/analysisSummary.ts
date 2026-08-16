import {
  technicalDebtMinutes,
  technicalDebtRatio,
  maintainabilityRating,
  ratingFromWorstSeverity,
  evaluateQualityGate,
  mergeQualityGate,
  SEVERITIES,
  coverageOnNewCode,
  coveragePercent as coveragePct,
  type Severity,
  type QualityGateThresholds,
  type SarifResult,
  type SarifLog,
  type CoverageReport,
  type CoverageCounter,
  type ChangedLines,
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
  /** new-code = diff; overall = relatório global; none = não medido. */
  coverageScope: "new-code" | "overall" | "none";
  /** Duplicação % medida; `null` = não enviada. */
  duplicationPercent: number | null;
  /** Cobertura de branches; `null` = não enviada. */
  branchCoveragePercent: number | null;
  /** Findings fora do gate por FP local alto (ruleRepoFpRate). */
  gateSuppressedCount: number;
};

/** Reconstrói CoverageReport a partir das properties do run SARIF. */
export function coverageReportFromSarif(sarif: SarifLog): CoverageReport | null {
  const raw = (
    sarif.runs?.[0] as {
      properties?: {
        coverage?: {
          format?: string;
          lines?: CoverageCounter;
          branches?: CoverageCounter;
          files?: Array<{
            path?: string;
            lines?: CoverageCounter;
            branches?: CoverageCounter;
            uncoveredLines?: number[];
            coveredLines?: number[];
          }>;
        };
      };
    }
  )?.properties?.coverage;
  if (!raw || typeof raw !== "object") return null;
  const filesRaw = Array.isArray(raw.files) ? raw.files : [];
  if (filesRaw.length === 0 && (!raw.lines || raw.lines.total <= 0)) return null;
  const files = filesRaw
    .filter((f) => f && typeof f.path === "string")
    .map((f) => ({
      path: f.path!,
      lines: f.lines ?? { covered: 0, total: 0 },
      ...(f.branches ? { branches: f.branches } : {}),
      uncoveredLines: Array.isArray(f.uncoveredLines) ? f.uncoveredLines : [],
      coveredLines: Array.isArray(f.coveredLines) ? f.coveredLines : [],
    }));
  const lines =
    raw.lines && typeof raw.lines.total === "number"
      ? raw.lines
      : files.reduce<CoverageCounter>(
          (acc, f) => ({
            covered: acc.covered + f.lines.covered,
            total: acc.total + f.lines.total,
          }),
          { covered: 0, total: 0 },
        );
  return {
    format: (raw.format as CoverageReport["format"]) ?? "unknown",
    lines,
    ...(raw.branches ? { branches: raw.branches } : {}),
    files,
  };
}

/**
 * Percentual que alimenta o gate: prefere cobertura em código novo quando o CI
 * envia `changedLines`; senão usa o agregado global do relatório.
 */
export function resolveCoverageForGate(
  sarif: SarifLog,
  changedLines?: ChangedLines | null,
): { percent: number | null; scope: AnalysisSummary["coverageScope"] } {
  const hasDiff = changedLines && Object.keys(changedLines).length > 0;
  if (hasDiff) {
    const report = coverageReportFromSarif(sarif);
    const nc = coverageOnNewCode(report, changedLines!);
    if (!nc.applicable) return { percent: null, scope: "none" };
    return { percent: nc.percent, scope: "new-code" };
  }
  const raw = (
    sarif.runs?.[0] as { properties?: { coverage?: { lines?: CoverageCounter } } }
  )?.properties?.coverage?.lines;
  if (!raw || typeof raw.total !== "number" || raw.total <= 0) {
    return { percent: null, scope: "none" };
  }
  return { percent: coveragePct(raw), scope: "overall" };
}

/**
 * Calcula o summary da analysis (puro — sem I/O).
 *
 * Regras de escopo:
 * - Débito / maintainabilityRating: sempre o inventário completo.
 * - Blockers no gate: com fingerprints → só código novo; sem → todos.
 * - Security no gate: com fingerprints → só vulns novas; rating persistido overall.
 * - gateSuppressed: fora do gate e fora da dívida/ratings.
 */
export function computeAnalysisSummary(
  results: SarifResult[],
  linesOfCode: number,
  newCodeFingerprints?: string[],
  coveragePercent?: number | null,
  duplicationPercent?: number | null,
  qualityGateThresholds?: QualityGateThresholds | null,
  branchCoveragePercent?: number | null,
  coverageScope: AnalysisSummary["coverageScope"] = "none",
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
  const scope: AnalysisSummary["coverageScope"] =
    cov == null ? "none" : coverageScope === "none" ? "overall" : coverageScope;
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

  if (scope === "new-code") {
    gate.failedConditions = gate.failedConditions.map((c) =>
      c.startsWith("Cobertura ") && !c.startsWith("Cobertura de branch")
        ? c.replace(/^Cobertura /, "Cobertura em código novo ")
        : c,
    );
  }

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
    coverageScope: scope,
    duplicationPercent: dupe,
    branchCoveragePercent: branchCov,
    gateSuppressedCount,
  };
}
