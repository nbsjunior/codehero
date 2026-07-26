import type { HeroRule } from "@codehero/contracts";

export interface CorpusCase {
  id: string;
  ruleId: string;
  code: string;
  expected: "match" | "no_match";
  note?: string;
}

export interface EvalFailure {
  caseId: string;
  expected: CorpusCase["expected"];
  actual: CorpusCase["expected"];
  code: string;
  note?: string;
}

export interface EvalResult {
  ruleId: string;
  cases: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number;
  recall: number;
  f1: number;
  failures: EvalFailure[];
}

/**
 * A mutation is a pure, named transformation of a rule's pattern. Mutations
 * are hand-curated (or, in V1+, proposed offline by an LLM from CWE/CVE
 * descriptions — see llmGenerator.ts) but ALWAYS scored by the same
 * deterministic corpus evaluator before they can be promoted. The LLM (or a
 * human) proposes; the corpus decides.
 */
export interface Mutation {
  id: string;
  description: string;
  apply: (pattern: HeroRule["pattern"]) => HeroRule["pattern"];
}

export interface Individual {
  /** Bitmask over the rule's mutation pool — which mutations are active. */
  mask: number;
  pattern: HeroRule["pattern"];
  fitness: EvalResult;
}
