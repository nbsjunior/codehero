/**
 * @codehero/locksmith — deterministic validation loop for legacy migration.
 *
 * Implements the student-side of the American Express "Locksmith Loop"
 * (arXiv:2607.28271): Witness Search, Locked Paragraph Analyzer, Mutation Skills,
 * Parity Gate. Authoring Layer (Teacher) is an optional callback — Genkit/AI
 * may propose skills; only the deterministic Parity Gate judges.
 *
 * Scope today: COBOL CFG mock runner + Java mirror. Plug a real Java harness
 * via `javaRunner` when you have an instrumented migration target.
 */

export type {
  BehavioralFingerprint,
  CoverageSnapshot,
  HarnessKey,
  LockedParagraph,
  LoopConfig,
  LoopReport,
  MutationSkill,
  MutationSkillKind,
  ParityAxisResult,
  ParityResult,
  ProgramModel,
  Witness,
  WitnessAlgorithm,
} from "./types.ts";

export {
  analyzeCobolFile,
  analyzeCobolSource,
  DEFAULT_HARNESS_KEYS,
  findLockedParagraphs,
} from "./analyzer.ts";
export { parityGate } from "./parity.ts";
export {
  cobolRunner,
  mirrorJavaRunner,
  runMock,
  type TargetRunner,
} from "./runner.ts";
export { catalogSkillsFor, defaultAuthoring } from "./skills.ts";
export { proposeFromCatalog, type AuthoringPropose } from "./authoring.ts";
export { runLocksmithLoop, type LocksmithOptions } from "./loop.ts";
export {
  artWitnesses,
  lhsWitnesses,
  mapElitesWitnesses,
  pairwiseWitnesses,
  threeWayWitnesses,
  ucb1Witnesses,
  witnessSearchSweep,
} from "./witness.ts";
