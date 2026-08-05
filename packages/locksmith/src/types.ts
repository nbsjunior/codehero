/**
 * Locksmith Loop types — American Express arXiv:2607.28271
 * ("Agentic Method for Deterministic Validation of Legacy Code Migration").
 *
 * Student = deterministic tools (analyzer, witness search, runner, parity).
 * Teacher = Authoring Layer (proposes Mutation Skills; never judges alone).
 */

/** Scenario: input-state + stub-state driving a mock run. */
export interface Witness {
  id: string;
  /** Working-storage / variables pinned before run. */
  inputState: Record<string, string | number | boolean>;
  /** Mocked external outcomes (file status, SQLCODE, CALL return, MQ, …). */
  stubState: Record<string, string | number | boolean>;
  /** Algorithm that produced this witness. */
  algorithm: WitnessAlgorithm;
}

export type WitnessAlgorithm =
  | "pairwise"
  | "three-way"
  | "lhs"
  | "art"
  | "map-elites"
  | "ucb1";

/** Behavioral fingerprint — Parity Gate axes (paper §III-F). */
export interface BehavioralFingerprint {
  /** Paragraphs entered (set comparison). */
  paragraphsHit: string[];
  /** Ordered external-operation log. */
  stubLog: string[];
  /** Observable terminal variables. */
  terminalState: Record<string, string | number | boolean>;
  /** Instrumented branch probe ids taken (e.g. IF-true / IF-false). */
  branchesHit: string[];
}

export interface ProgramModel {
  /** Absolute or relative path of COBOL source. */
  sourcePath: string;
  paragraphs: string[];
  /** Static paragraph→paragraph edges (PERFORM / GO TO / fall-through). */
  transitions: Array<{ from: string; to: string; kind: "perform" | "goto" | "fallthrough" | "exit" }>;
  /** Branch probe ids discovered statically. */
  branchProbes: string[];
  /** Controllable stub/input keys the harness exposes. */
  harnessKeys: HarnessKey[];
}

export interface HarnessKey {
  name: string;
  domain: Array<string | number | boolean>;
  kind: "input" | "stub";
}

export interface LockedParagraph {
  name: string;
  uncoveredBranches: string[];
  /** Controllable variables involved in gates (best-effort). */
  gateVariables: string[];
  /** Score: bang × feasibility (paper default) or uncovered count (greedy). */
  score: number;
  attempted: boolean;
  opened: boolean;
}

export type MutationSkillKind = "dispatcher-arm" | "call-injection";

/** Reusable parity-preserving mutation (applied to BOTH sides). */
export interface MutationSkill {
  id: string;
  kind: MutationSkillKind;
  description: string;
  /** Target locked paragraph. */
  targetParagraph: string;
  /** For dispatcher-arm: pin stub/input keys. */
  pins?: Record<string, string | number | boolean>;
  /** For call-injection: force entry from this paragraph. */
  injectFrom?: string;
}

export interface ParityAxisResult {
  axis: "paragraphs_hit" | "stub_log" | "terminal_state";
  ok: boolean;
  detail?: string;
}

export interface ParityResult {
  ok: boolean;
  axes: ParityAxisResult[];
}

export interface CoverageSnapshot {
  paragraphsHit: number;
  paragraphsTotal: number;
  transitionsHit: number;
  transitionsTotal: number;
  branchesHit: number;
  branchesTotal: number;
  paragraphPct: number;
  transitionPct: number;
  branchPct: number;
}

export interface LoopConfig {
  /** Consecutive Witness Search sweeps with no new branches → plateau. */
  plateauRounds: number;
  maxMutations: number;
  ranking: "greedy" | "bang-feasibility";
  /** Optional Authoring Layer — propose skill when catalog misses. */
  authoring?: (locked: LockedParagraph, model: ProgramModel) => MutationSkill | null;
}

export interface LoopReport {
  coverage: CoverageSnapshot;
  witnessesAccepted: number;
  mutationsKept: number;
  mutationsReverted: number;
  lockedOpened: string[];
  lockedFailed: string[];
  parityPass: number;
  parityFail: number;
  history: string[];
}
