import type { Mutation } from "./types.ts";
import type { MutationSpec } from "./mutationSpec.ts";

// ---------------------------------------------------------------------------
// Optional, offline, batch-only candidate source. This is where generative AI
// enters the platform's rule lifecycle — and nowhere else.
//
// Cost/safety model:
//   - Called at most once per day (Genkit flow `ruleforgeDaily` via Cloud
//     Scheduler), NEVER per file or per scan. Runtime scanning
//     (packages/scanner) never reaches this code.
//   - Output is untrusted input: a `Mutation`/`MutationSpec` proposed here is
//     scored by the exact same deterministic corpus evaluator (evaluate.ts)
//     as a hand-authored mutation before it can be promoted (evolve.ts).
//     The LLM proposes; the corpus decides.
//   - Production wiring: apps/functions Genkit flow + onSchedule daily job.
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
 * Optional richer generator that returns serialisable specs (used by Genkit
 * structured output). Adapters convert specs → Mutation before evolve.
 */
export interface SpecCandidateGenerator {
  proposeSpecs(input: CandidateGenerationInput): Promise<MutationSpec[]>;
}

/**
 * Reference no-op implementation used in tests/dev so the evolutionary loop
 * has a working `RuleCandidateGenerator` without requiring API credentials.
 */
export const noopGenerator: RuleCandidateGenerator = {
  async propose() {
    return [];
  },
};
