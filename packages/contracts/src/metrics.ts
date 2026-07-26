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

export interface QualityGateInput {
  newCodeCoverage: number;
  newCodeDuplication: number;
  newBlockerIssues: number;
  securityRating: Rating;
  maintainabilityRating: Rating;
}

export interface QualityGateResult {
  status: "PASSED" | "FAILED";
  failedConditions: string[];
}

function ratingIsWorseThan(actual: Rating, max: Rating): boolean {
  const order = ["A", "B", "C", "D", "E"] as const;
  return order.indexOf(actual) > order.indexOf(max);
}

export function evaluateQualityGate(
  input: QualityGateInput,
  thresholds: QualityGateThresholds = DEFAULT_QUALITY_GATE,
): QualityGateResult {
  const failed: string[] = [];
  if (input.newCodeCoverage < thresholds.minNewCodeCoverage)
    failed.push(`Coverage on new code ${input.newCodeCoverage}% < ${thresholds.minNewCodeCoverage}%`);
  if (input.newCodeDuplication > thresholds.maxNewCodeDuplication)
    failed.push(`Duplication on new code ${input.newCodeDuplication}% > ${thresholds.maxNewCodeDuplication}%`);
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
