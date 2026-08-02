import type { RankerModel } from "./index.ts";

/**
 * Seed model — priors honestos até existir corpus de feedback suficiente.
 * Treinar de verdade: `hero-fp-ranker train feedback.json models/assertiveness.json`
 * e versionar o artefato. Mesma entrada → mesma saída.
 */
export const DEFAULT_MODEL: RankerModel = {
  version: "seed-priors-v1",
  algorithm: "gbm-stumps-v1",
  learningRate: 0.2,
  baseScore: 0.4,
  trainedAt: "2026-08-02T00:00:00.000Z",
  trainSize: 0,
  notes:
    "Prior stumps (not fitted). Low assertiveness for test/dist/generated and high ruleRepoFpRate.",
  stumps: [
    { feature: "isTestFile", threshold: 0.5, left: 0.15, right: -0.9 },
    { feature: "isDistPath", threshold: 0.5, left: 0.1, right: -1.2 },
    { feature: "isGenerated", threshold: 0.5, left: 0.1, right: -0.8 },
    { feature: "ruleRepoFpRate", threshold: 0.4, left: 0.2, right: -0.7 },
    { feature: "severityRank", threshold: 0.6, left: -0.1, right: 0.35 },
    { feature: "isImported", threshold: 0.5, left: 0.05, right: 0.15 },
    { feature: "taintPathLenNorm", threshold: 0.25, left: -0.05, right: 0.25 },
  ],
};
