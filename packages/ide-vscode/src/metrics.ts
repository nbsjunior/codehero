/**
 * SQALE metrics — same thresholds as `@codehero/contracts/metrics` (ingest / portal).
 * Inlined so the VSIX packs without external workspace deps (`vsce --no-dependencies`).
 */

export type Rating = "A" | "B" | "C" | "D" | "E";
export type Severity = "INFO" | "MINOR" | "MAJOR" | "CRITICAL" | "BLOCKER";

const COST_PER_LINE_MIN = 30;
const SEV_RANK: Record<Severity, number> = {
  INFO: 0,
  MINOR: 1,
  MAJOR: 2,
  CRITICAL: 3,
  BLOCKER: 4,
};
const RATING_ORDER: Rating[] = ["A", "B", "C", "D", "E"];

export function technicalDebtMinutes(codeSmellEfforts: number[]): number {
  return codeSmellEfforts.reduce((a, b) => a + b, 0);
}

export function technicalDebtRatio(debtMin: number, linesOfCode: number): number {
  return debtMin / (Math.max(1, linesOfCode) * COST_PER_LINE_MIN);
}

export function maintainabilityRating(debtRatio: number): Rating {
  if (debtRatio <= 0.05) return "A";
  if (debtRatio <= 0.1) return "B";
  if (debtRatio <= 0.2) return "C";
  if (debtRatio <= 0.5) return "D";
  return "E";
}

export function ratingFromWorstSeverity(severities: Severity[]): Rating {
  if (severities.length === 0) return "A";
  const worst = severities.reduce((acc, s) => (SEV_RANK[s] > SEV_RANK[acc] ? s : acc));
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

export function formatDebt(minutes: number): string {
  if (minutes <= 0) return "0min";
  const days = Math.floor(minutes / (60 * 8));
  const hours = Math.floor((minutes % (60 * 8)) / 60);
  const mins = minutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", mins ? `${mins}min` : ""]
    .filter(Boolean)
    .join(" ");
}

function ratingIsWorseThan(actual: Rating, max: Rating): boolean {
  return RATING_ORDER.indexOf(actual) > RATING_ORDER.indexOf(max);
}

/** IDE gate: coverage/duplication skipped (null); blockers + ratings only. */
export function evaluateIdeQualityGate(input: {
  newBlockerIssues: number;
  securityRating: Rating;
  maintainabilityRating: Rating;
}): { status: "PASSED" | "FAILED"; failedConditions: string[] } {
  const failed: string[] = [];
  if (input.newBlockerIssues > 0) failed.push(`BLOCKER abertos: ${input.newBlockerIssues}`);
  if (ratingIsWorseThan(input.securityRating, "A")) {
    failed.push(`Security rating ${input.securityRating} pior que A`);
  }
  if (ratingIsWorseThan(input.maintainabilityRating, "A")) {
    failed.push(`Maintainability rating ${input.maintainabilityRating} pior que A`);
  }
  return { status: failed.length === 0 ? "PASSED" : "FAILED", failedConditions: failed };
}

export interface RepoHealth {
  debtMinutes: number;
  debtRatio: number;
  linesOfCode: number;
  maintainabilityRating: Rating;
  securityRating: Rating;
  openIssues: number;
  byIssueType: Record<string, number>;
  qualityGateStatus: "PASSED" | "FAILED";
  qualityGateFailed: string[];
}

export function computeRepoHealth(
  findings: Array<{ severity: string; issueType?: string; remediationEffortMin?: number }>,
  linesOfCode: number,
): RepoHealth {
  const codeSmellEfforts: number[] = [];
  const vulnSeverities: Severity[] = [];
  const byIssueType: Record<string, number> = {};
  let newBlockerIssues = 0;

  for (const f of findings) {
    const type = (f.issueType || "CODE_SMELL").toUpperCase();
    byIssueType[type] = (byIssueType[type] ?? 0) + 1;
    const sev = f.severity.toUpperCase() as Severity;
    if (type === "CODE_SMELL") codeSmellEfforts.push(Number(f.remediationEffortMin ?? 0) || 0);
    if (type === "VULNERABILITY" && sev in SEV_RANK) vulnSeverities.push(sev);
    if (sev === "BLOCKER") newBlockerIssues += 1;
  }

  const loc = Math.max(1, linesOfCode);
  const debtMinutes = technicalDebtMinutes(codeSmellEfforts);
  const debtRatio = technicalDebtRatio(debtMinutes, loc);
  const maint = maintainabilityRating(debtRatio);
  const security = ratingFromWorstSeverity(vulnSeverities);
  const gate = evaluateIdeQualityGate({
    newBlockerIssues,
    securityRating: security,
    maintainabilityRating: maint,
  });

  return {
    debtMinutes,
    debtRatio,
    linesOfCode: loc,
    maintainabilityRating: maint,
    securityRating: security,
    openIssues: findings.length,
    byIssueType,
    qualityGateStatus: gate.status,
    qualityGateFailed: gate.failedConditions,
  };
}
