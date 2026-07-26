import type { Mutation } from "./types.ts";

// ---------------------------------------------------------------------------
// Optional, offline, batch-only candidate source. This is where generative AI
// enters the platform's rule lifecycle — and nowhere else.
//
// Cost/safety model:
//   - Called at most a handful of times per day/week (e.g. nightly job, or
//     triggered when a new CVE/CWE advisory is ingested), NEVER per file or
//     per scan. Runtime scanning (packages/scanner) never reaches this code.
//   - Output is untrusted input: a `Mutation`/`HeroRule` candidate proposed
//     here is scored by the exact same deterministic corpus evaluator
//     (evaluate.ts) as a hand-authored mutation before it can be promoted
//     (evolve.ts). The LLM proposes; the corpus decides. A hallucinated or
//     overly broad pattern that regresses the corpus is rejected the same way
//     a bad hand-written mutation would be.
//   - No LLM call happens inside this repo's test/build/CI path — this file
//     defines the interface and is intentionally NOT wired into `evolve.ts`'s
//     default pool. Wiring a real provider is a deployment-time decision for
//     the hero-ruleforge batch job (Cloud Run / Cloud Scheduler), not part of
//     the request-serving path.
// ---------------------------------------------------------------------------

export interface CandidateGenerationInput {
  ruleId: string;
  /** e.g. a CVE/CWE advisory description, or a batch of confirmed false-positive snippets. */
  context: string;
  /** Corpus cases the rule currently gets wrong — the concrete gap to close. */
  failingExamples: Array<{ code: string; expected: "match" | "no_match" }>;
}

export interface RuleCandidateGenerator {
  /** Propose new mutations for a rule. Must be pure w.r.t. the corpus — may
   *  call an external model, but must not itself decide promotion. */
  propose(input: CandidateGenerationInput): Promise<Mutation[]>;
}

/**
 * Reference no-op implementation used in tests/dev so the evolutionary loop
 * has a working `RuleCandidateGenerator` without requiring API credentials.
 * A production implementation (`AnthropicCandidateGenerator`, etc.) would call
 * an LLM once per batch run, parse its suggestion into a `Mutation`, and
 * return it here — unchanged, still subject to corpus scoring downstream.
 */
export const noopGenerator: RuleCandidateGenerator = {
  async propose() {
    return [];
  },
};
