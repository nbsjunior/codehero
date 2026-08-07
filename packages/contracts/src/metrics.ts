import type { Rating, Severity } from "./severity.ts";
import { severityRank } from "./severity.ts";

// ---------------------------------------------------------------------------
// SQALE-based maintainability & debt model (mirrors the SonarQube conceptual
// model). All functions are pure so they can run in Functions, the scanner, or
// the browser.
// ---------------------------------------------------------------------------

/** Default cost, in minutes, to author one line of code (SQALE default). */
export const COST_PER_LINE_MIN = 30;

/** Technical Debt = sum of remediation effort of all CODE_SMELL issues. */
export function technicalDebtMinutes(codeSmellEfforts: number[]): number {
  return codeSmellEfforts.reduce((a, b) => a + b, 0);
}

/** Development cost of the codebase, in minutes. */
export function developmentCostMinutes(linesOfCode: number, costPerLine = COST_PER_LINE_MIN): number {
  return Math.max(1, linesOfCode) * costPerLine;
}

/** Technical Debt Ratio = debt / development cost. */
export function technicalDebtRatio(debtMin: number, linesOfCode: number, costPerLine = COST_PER_LINE_MIN): number {
  return debtMin / developmentCostMinutes(linesOfCode, costPerLine);
}

/** Maintainability rating (A–E) from the debt ratio, per SQALE thresholds. */
export function maintainabilityRating(debtRatio: number): Rating {
  if (debtRatio <= 0.05) return "A";
  if (debtRatio <= 0.1) return "B";
  if (debtRatio <= 0.2) return "C";
  if (debtRatio <= 0.5) return "D";
  return "E";
}

/**
 * Security / Reliability rating derived from the worst issue severity present.
 * No issues -> A. Then each severity band maps to a rating.
 */
export function ratingFromWorstSeverity(severities: Severity[]): Rating {
  if (severities.length === 0) return "A";
  const worst = severities.reduce((acc, s) => (severityRank(s) > severityRank(acc) ? s : acc));
  switch (worst) {
    case "INFO":
      return "A";
    case "MINOR":
      return "B";
    case "MAJOR":
      return "C";
    case "CRITICAL":
      return "D";
    case "BLOCKER":
      return "E";
  }
}

export interface QualityGateThresholds {
  minNewCodeCoverage: number; // percent
  maxNewCodeDuplication: number; // percent
  maxNewBlockerIssues: number;
  maxSecurityRating: Rating;
  maxMaintainabilityRating: Rating;
}

export const DEFAULT_QUALITY_GATE: QualityGateThresholds = {
  minNewCodeCoverage: 80,
  maxNewCodeDuplication: 3,
  maxNewBlockerIssues: 0,
  maxSecurityRating: "A",
  maxMaintainabilityRating: "A",
};

export function mergeQualityGate(
  partial?: Partial<QualityGateThresholds> | null,
): QualityGateThresholds {
  if (!partial) return { ...DEFAULT_QUALITY_GATE };
  return {
    minNewCodeCoverage: partial.minNewCodeCoverage ?? DEFAULT_QUALITY_GATE.minNewCodeCoverage,
    maxNewCodeDuplication: partial.maxNewCodeDuplication ?? DEFAULT_QUALITY_GATE.maxNewCodeDuplication,
    maxNewBlockerIssues: partial.maxNewBlockerIssues ?? DEFAULT_QUALITY_GATE.maxNewBlockerIssues,
    maxSecurityRating: partial.maxSecurityRating ?? DEFAULT_QUALITY_GATE.maxSecurityRating,
    maxMaintainabilityRating:
      partial.maxMaintainabilityRating ?? DEFAULT_QUALITY_GATE.maxMaintainabilityRating,
  };
}

export interface QualityGateInput {
  /**
   * `null` = não medido (nenhum relatório de cobertura enviado). A condição é
   * PULADA nesse caso, em vez de reprovar — ver coverage.ts. Um número, mesmo
   * 0, significa medido e é avaliado normalmente.
   */
  newCodeCoverage: number | null;
  /** `null` = não medido; a condição é pulada, como em `newCodeCoverage`. */
  newCodeDuplication: number | null;
  newBlockerIssues: number;
  securityRating: Rating;
  maintainabilityRating: Rating;
}

export interface QualityGateResult {
  status: "PASSED" | "FAILED";
  failedConditions: string[];
}

export const RATING_ORDER = ["A", "B", "C", "D", "E"] as const;

function ratingIsWorseThan(actual: Rating, max: Rating): boolean {
  return RATING_ORDER.indexOf(actual) > RATING_ORDER.indexOf(max);
}

/** The worst (lowest) rating in a list. Empty list -> "A" (nothing to be bad about). */
export function worstRating(ratings: Rating[]): Rating {
  if (ratings.length === 0) return "A";
  return ratings.reduce((worst, r) => (ratingIsWorseThan(r, worst) ? r : worst));
}

export interface RepoMetrics {
  debtMinutes: number;
  openIssues: number;
  maintainabilityRating: Rating;
  securityRating: Rating;
  qualityGateStatus: "PASSED" | "FAILED";
}

export interface ProjectAggregateMetrics extends RepoMetrics {
  repoCount: number;
}

/**
 * Consolidates a project's repos into one summary: debt/issues sum, worst
 * rating across repos, and a gate that only passes when every repo's gate
 * passes. Shared by the backend rollup (written to the project doc on
 * ingest) and any client that wants to recompute the same number from raw
 * repo docs (e.g. an admin view that reads repos directly).
 */
export function aggregateProjectMetrics(repos: RepoMetrics[]): ProjectAggregateMetrics {
  return {
    repoCount: repos.length,
    debtMinutes: repos.reduce((sum, r) => sum + r.debtMinutes, 0),
    openIssues: repos.reduce((sum, r) => sum + r.openIssues, 0),
    maintainabilityRating: worstRating(repos.map((r) => r.maintainabilityRating)),
    securityRating: worstRating(repos.map((r) => r.securityRating)),
    qualityGateStatus: repos.every((r) => r.qualityGateStatus === "PASSED") ? "PASSED" : "FAILED",
  };
}

export function evaluateQualityGate(
  input: QualityGateInput,
  thresholds: QualityGateThresholds = DEFAULT_QUALITY_GATE,
): QualityGateResult {
  const failed: string[] = [];
  if (input.newCodeCoverage !== null && input.newCodeCoverage < thresholds.minNewCodeCoverage)
    failed.push(
      `Cobertura em código novo ${input.newCodeCoverage}% < ${thresholds.minNewCodeCoverage}%`,
    );
  if (input.newCodeDuplication !== null && input.newCodeDuplication > thresholds.maxNewCodeDuplication)
    failed.push(
      `Duplicação em código novo ${input.newCodeDuplication}% > ${thresholds.maxNewCodeDuplication}%`,
    );
  if (input.newBlockerIssues > thresholds.maxNewBlockerIssues)
    failed.push(`New blocker issues ${input.newBlockerIssues} > ${thresholds.maxNewBlockerIssues}`);
  if (ratingIsWorseThan(input.securityRating, thresholds.maxSecurityRating))
    failed.push(`Security rating ${input.securityRating} worse than ${thresholds.maxSecurityRating}`);
  if (ratingIsWorseThan(input.maintainabilityRating, thresholds.maxMaintainabilityRating))
    failed.push(`Maintainability rating ${input.maintainabilityRating} worse than ${thresholds.maxMaintainabilityRating}`);
  return { status: failed.length === 0 ? "PASSED" : "FAILED", failedConditions: failed };
}

/** Human-friendly debt string, e.g. 135 -> "2h 15min". */
export function formatDebt(minutes: number): string {
  if (minutes <= 0) return "0min";
  const days = Math.floor(minutes / (60 * 8)); // 8h work day
  const hours = Math.floor((minutes % (60 * 8)) / 60);
  const mins = minutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", mins ? `${mins}min` : ""].filter(Boolean).join(" ");
}
