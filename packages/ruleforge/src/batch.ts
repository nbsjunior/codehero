import { RULES, type HeroRule } from "@codehero/contracts";
import { casesForRule, loadCorpus } from "./corpus.ts";
import { evolveRule, type EvolveOutcome } from "./evolve.ts";
import type { RuleCandidateGenerator } from "./llmGenerator.ts";
import { poolFor } from "./mutations.ts";
import type { CorpusCase, Mutation } from "./types.ts";

export interface RuleEvolutionReport {
  outcome: EvolveOutcome;
  proposedMutationIds: string[];
  baselinePattern: HeroRule["pattern"];
  /** Pattern that won the search (only meaningful when decision=PROMOTED). */
  promotedPattern: HeroRule["pattern"] | null;
}

export interface BatchEvolutionReport {
  ranAt: string;
  seed: number;
  rules: RuleEvolutionReport[];
  promotedCount: number;
  rejectedCount: number;
}

export interface BatchEvolutionOptions {
  seed?: number;
  corpus?: CorpusCase[];
  /** When set, Genkit/LLM proposals are merged into each rule's mutation pool. */
  generator?: RuleCandidateGenerator;
  /** Extra free-text context (CVE notes, feedback summary) forwarded to the generator. */
  context?: string;
  rules?: HeroRule[];
}

/**
 * Runs the deterministic evolutionary search over every rule (or a subset),
 * optionally enriching each rule's mutation pool with offline LLM proposals.
 * Promotion still requires the corpus gate — the generator never decides.
 */
export async function evolveAllRules(opts: BatchEvolutionOptions = {}): Promise<BatchEvolutionReport> {
  const seed = opts.seed ?? daySeed();
  const corpus = opts.corpus ?? loadCorpus();
  const rules = opts.rules ?? RULES;
  const context = opts.context ?? "Daily offline ruleforge batch.";
  const reports: RuleEvolutionReport[] = [];

  for (const rule of rules) {
    const cases = casesForRule(corpus, rule.id);
    if (cases.length === 0) continue;

    let extraMutations: Mutation[] = [];
    if (opts.generator) {
      const baselineEval = evolveRule(rule, cases, { seed, extraMutations: [] });
      const failingExamples = baselineEval.baseline.failures.map((f) => ({
        code: f.code,
        expected: f.expected,
      }));
      try {
        extraMutations = await opts.generator.propose({
          ruleId: rule.id,
          context,
          failingExamples,
        });
      } catch (err) {
        // Generator failures must not abort the deterministic hand-authored pass.
        console.warn(`[ruleforge] generator failed for ${rule.id}:`, err);
      }
    }

    const outcome = evolveRule(rule, cases, { seed, extraMutations });
    const promotedPattern =
      outcome.decision === "PROMOTED" ? applyWinningMask(rule, outcome.bestMask, extraMutations) : null;

    reports.push({
      outcome,
      proposedMutationIds: extraMutations.map((m) => m.id),
      baselinePattern: rule.pattern,
      promotedPattern,
    });
  }

  return {
    ranAt: new Date().toISOString(),
    seed,
    rules: reports,
    promotedCount: reports.filter((r) => r.outcome.decision === "PROMOTED").length,
    rejectedCount: reports.filter((r) => r.outcome.decision === "REJECTED").length,
  };
}

function applyWinningMask(rule: HeroRule, mask: number, extra: Mutation[]): HeroRule["pattern"] {
  const pool = [...poolFor(rule.id), ...extra].slice(0, 12);
  let pattern = rule.pattern;
  for (let i = 0; i < pool.length; i++) {
    if (mask & (1 << i)) pattern = pool[i]!.apply(pattern);
  }
  return pattern;
}

/** Stable-ish daily seed so the same calendar day is replayable. */
export function daySeed(date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return y * 10_000 + m * 100 + d;
}
