// Severity, issue type and rating scales — shared vocabulary across the whole
// platform (scanner output, ingestion, dashboard, SDD).

export const SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_TYPES = ["VULNERABILITY", "BUG", "CODE_SMELL", "SECURITY_HOTSPOT"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const RATINGS = ["A", "B", "C", "D", "E"] as const;
export type Rating = (typeof RATINGS)[number];

/** SARIF `level` mapping for a given severity. */
export function severityToSarifLevel(sev: Severity): "error" | "warning" | "note" {
  switch (sev) {
    case "BLOCKER":
    case "CRITICAL":
      return "error";
    case "MAJOR":
    case "MINOR":
      return "warning";
    case "INFO":
      return "note";
  }
}

/** Numeric weight used when picking the "worst" severity present. */
export function severityRank(sev: Severity): number {
  return SEVERITIES.length - SEVERITIES.indexOf(sev);
}
