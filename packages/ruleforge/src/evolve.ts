import type { HeroRule } from "@codehero/contracts";
import { evaluateRule } from "./evaluate.ts";
import { poolFor } from "./mutations.ts";
import type { CorpusCase, EvalResult, Individual, Mutation } from "./types.ts";

// ---------------------------------------------------------------------------
// hero-ruleforge — deterministic evolutionary rule search.
//
// This is the ONLY place rules change over time. It is intentionally free of
// any network/LLM call: fitness is a pure function of (candidate pattern,
// golden corpus), so an arbitrarily large number of generations/candidates
// costs CPU-milliseconds, never a generative-AI API bill. This is what keeps
// "IA que evolui as regras" from becoming "IA que analisa cada arquivo" in
// disguise — evolution happens offline, in batch, against a fixed corpus.
//
// Generative proposals (Genkit daily flow) arrive as `extraMutations` and are
// scored by the same gate — the LLM proposes; this file decides.
//
// A seeded PRNG makes every run reproducible and auditable: given the same
// corpus + mutation pool + seed, the same rule change is proposed every time,
// so a promoted rule can be traced back to an exact, replayable search.
// ---------------------------------------------------------------------------

const POPULATION_SIZE = 8;
const GENERATIONS = 5;
const MIN_PRECISION = 0.85;
const MIN_IMPROVEMENT = 1e-6;

/** Mulberry32 — tiny deterministic PRNG, seeded for reproducible searches. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function applyMask(base: HeroRule["pattern"], mutations: Mutation[], mask: number): HeroRule["pattern"] {
  let pattern = base;
  for (let i = 0; i < mutations.length; i++) {
    if (mask & (1 << i)) pattern = mutations[i]!.apply(pattern);
  }
  return pattern;
}

function activeMutationIds(mutations: Mutation[], mask: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < mutations.length; i++) if (mask & (1 << i)) ids.push(mutations[i]!.id);
  return ids;
}

/** True if `candidate` is at least as correct as `baseline` on every case (no regressions). */
function noRegressions(baseline: EvalResult, candidate: EvalResult): boolean {
  const baselineWrongCaseIds = new Set(baseline.failures.map((f) => f.caseId));
  const candidateWrongCaseIds = new Set(candidate.failures.map((f) => f.caseId));
  for (const id of candidateWrongCaseIds) {
    if (!baselineWrongCaseIds.has(id)) return false; // candidate broke a case baseline got right
  }
  return true;
}

export interface EvolveOutcome {
  ruleId: string;
  baseline: EvalResult;
  best: EvalResult;
  bestMask: number;
  mutationIds: string[];
  generationLog: Array<{ generation: number; bestF1: number; bestMask: number }>;
  decision: "PROMOTED" | "REJECTED";
  reason: string;
}

export interface EvolveOptions {
  seed?: number;
  /** Extra mutations (e.g. Genkit/LLM proposals) merged into the hand-authored pool. */
  extraMutations?: Mutation[];
}

export function evolveRule(rule: HeroRule, cases: CorpusCase[], seedOrOpts: number | EvolveOptions = 42): EvolveOutcome {
  const opts: EvolveOptions = typeof seedOrOpts === "number" ? { seed: seedOrOpts } : seedOrOpts;
  const seed = opts.seed ?? 42;
  const pool = [...poolFor(rule.id), ...(opts.extraMutations ?? [])];
  const rand = mulberry32(seed);
  const baseline = evaluateRule(rule.pattern, cases);

  if (pool.length === 0) {
    return {
      ruleId: rule.id,
      baseline,
      best: baseline,
      bestMask: 0,
      mutationIds: [],
      generationLog: [],
      decision: "REJECTED",
      reason: "sem mutações registradas para esta regra",
    };
  }

  // Bitmask search is O(2^n); cap LLM+hand pool so a bad batch can't explode CPU.
  const capped = pool.slice(0, 12);
  const maxMask = (1 << capped.length) - 1;

  function scoreIndividual(mask: number): Individual {
    const pattern = applyMask(rule.pattern, capped, mask);
    return { mask, pattern, fitness: evaluateRule(pattern, cases) };
  }

  function fitnessValue(ind: Individual): number {
    // F1 primary, precision as tie-break, fewer active mutations as final tie-break (Occam's razor).
    const simplicity = 1 - popcount(ind.mask) / (capped.length + 1);
    return ind.fitness.f1 * 1000 + ind.fitness.precision * 10 + simplicity;
  }

  // Initial population: always include the unchanged baseline (mask 0) and
  // the fully-mutated individual, then fill with random masks.
  const masks = new Set<number>([0, maxMask]);
  while (masks.size < Math.min(POPULATION_SIZE, maxMask + 1)) {
    masks.add(Math.floor(rand() * (maxMask + 1)));
  }
  let population = [...masks].map(scoreIndividual);

  const generationLog: EvolveOutcome["generationLog"] = [];
  let best = population.reduce((a, b) => (fitnessValue(b) > fitnessValue(a) ? b : a));

  for (let gen = 0; gen < GENERATIONS; gen++) {
    population.sort((a, b) => fitnessValue(b) - fitnessValue(a));
    const survivors = population.slice(0, Math.max(2, Math.ceil(POPULATION_SIZE / 2)));

    const children: Individual[] = [];
    while (survivors.length && children.length < POPULATION_SIZE) {
      const parent = survivors[Math.floor(rand() * survivors.length)]!;
      const flipBit = 1 << Math.floor(rand() * capped.length);
      const childMask = parent.mask ^ flipBit; // bit-flip mutation
      children.push(scoreIndividual(childMask));
    }

    population = [...survivors, ...children];
    const genBest = population.reduce((a, b) => (fitnessValue(b) > fitnessValue(a) ? b : a));
    if (fitnessValue(genBest) > fitnessValue(best)) best = genBest;
    generationLog.push({ generation: gen + 1, bestF1: best.fitness.f1, bestMask: best.mask });
  }

  const improved = best.fitness.f1 - baseline.f1 > MIN_IMPROVEMENT;
  const precisionOk = best.fitness.precision >= MIN_PRECISION;
  const regressionFree = noRegressions(baseline, best.fitness);

  let decision: EvolveOutcome["decision"] = "REJECTED";
  let reason: string;
  if (!improved) {
    reason = `sem ganho de F1 (baseline=${baseline.f1.toFixed(3)}, melhor=${best.fitness.f1.toFixed(3)})`;
  } else if (!precisionOk) {
    reason = `precisão ${best.fitness.precision.toFixed(3)} abaixo do mínimo ${MIN_PRECISION}`;
  } else if (!regressionFree) {
    reason = "candidato introduz regressão em caso(s) que a regra atual acerta";
  } else {
    decision = "PROMOTED";
    reason = `F1 ${baseline.f1.toFixed(3)} → ${best.fitness.f1.toFixed(3)}, sem regressões, precisão ${best.fitness.precision.toFixed(3)}`;
  }

  return {
    ruleId: rule.id,
    baseline,
    best: best.fitness,
    bestMask: best.mask,
    mutationIds: activeMutationIds(capped, best.mask),
    generationLog,
    decision,
    reason,
  };
}

function popcount(n: number): number {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>= 1;
  }
  return c;
}
