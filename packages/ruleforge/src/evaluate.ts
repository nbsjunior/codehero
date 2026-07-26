import { matchPattern, type HeroRule } from "@codehero/contracts";
import type { CorpusCase, EvalResult } from "./types.ts";

/**
 * Score a rule's pattern against a set of labeled corpus cases. Uses the
 * exact same `matchPattern` the production scanner uses (packages/contracts)
 * — a candidate can never score well here and behave differently once
 * promoted, because there is only one matcher implementation.
 */
export function evaluateRule(pattern: HeroRule["pattern"], cases: CorpusCase[]): EvalResult {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  const failures: EvalResult["failures"] = [];

  for (const c of cases) {
    const matched = matchPattern(pattern, c.code).length > 0;
    const expectMatch = c.expected === "match";

    if (matched && expectMatch) truePositive++;
    else if (matched && !expectMatch) {
      falsePositive++;
      failures.push({ caseId: c.id, expected: "no_match", actual: "match", code: c.code, note: c.note });
    } else if (!matched && expectMatch) {
      falseNegative++;
      failures.push({ caseId: c.id, expected: "match", actual: "no_match", code: c.code, note: c.note });
    } else trueNegative++;
  }

  const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 1;
  const recall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    ruleId: cases[0]?.ruleId ?? "unknown",
    cases: cases.length,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1,
    failures,
  };
}
