import { analyzeCobolFile, findLockedParagraphs } from "./analyzer.ts";
import { absorbFingerprint, emptyCoverage, isPlateau, snapshot } from "./coverage.ts";
import { parityGate } from "./parity.ts";
import { cobolRunner, mirrorJavaRunner, type TargetRunner } from "./runner.ts";
import { catalogSkillsFor, defaultAuthoring } from "./skills.ts";
import type {
  LoopConfig,
  LoopReport,
  MutationSkill,
  ProgramModel,
  Witness,
} from "./types.ts";
import { rewardUcb1, witnessSearchSweep } from "./witness.ts";

const DEFAULT_CONFIG: LoopConfig = {
  plateauRounds: 2,
  maxMutations: 8,
  ranking: "bang-feasibility",
  authoring: defaultAuthoring,
};

export interface LocksmithOptions {
  sourcePath: string;
  config?: Partial<LoopConfig>;
  javaRunner?: TargetRunner;
  /** Seed mutations already applied (both sides). */
  mutations?: MutationSkill[];
}

/**
 * Locksmith Loop (paper Fig. 1 / §III):
 *   Witness Search → (plateau?) → Locked Paragraph Analyzer → Mutation Skill
 *   → re-run both sides → Parity Gate → keep iff coverage↑ ∧ PASS
 *   → recurse until no locked paragraphs openable or budget exhausted.
 */
export function runLocksmithLoop(opts: LocksmithOptions): LoopReport {
  const config: LoopConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const model = analyzeCobolFile(opts.sourcePath);
  const mutations = [...(opts.mutations ?? [])];
  const javaRunner = opts.javaRunner ?? mirrorJavaRunner;

  const archive: Witness[] = [];
  const eliteMap = new Map<string, Witness>();
  const armStats = new Map<string, { n: number; reward: number }>();
  let totalPulls = 0;

  const cov = emptyCoverage(model);
  const history: string[] = [];
  let witnessesAccepted = 0;
  let mutationsKept = 0;
  let mutationsReverted = 0;
  let parityPass = 0;
  let parityFail = 0;
  const lockedOpened: string[] = [];
  const lockedFailed: string[] = [];
  const lockedAttempted = new Set<string>();

  let plateauStreak = 0;
  let prevBranchCount = -1;

  // --- Phase A: Witness Search until plateau ---
  for (let sweep = 0; sweep < 12; sweep++) {
    const batch = witnessSearchSweep(model.harnessKeys, archive, eliteMap, armStats, totalPulls);
    totalPulls += batch.length;
    let sweepGain = 0;
    for (const w of batch) {
      const result = evaluateWitness(model, w, mutations, javaRunner, cov);
      if (result.parity.ok) parityPass++;
      else parityFail++;
      rewardUcb1(armStats, w, result.gain > 0 && result.parity.ok ? 1 : 0);
      if (result.gain > 0 && result.parity.ok) {
        archive.push(w);
        witnessesAccepted++;
        sweepGain += result.gain;
      }
    }
    const snap = snapshot(model, cov);
    history.push(
      `witness-sweep#${sweep + 1}: +${sweepGain} branches=${snap.branchesHit}/${snap.branchesTotal} paras=${snap.paragraphsHit}/${snap.paragraphsTotal}`,
    );
    if (prevBranchCount >= 0 && isPlateau(prevBranchCount, snap.branchesHit)) {
      plateauStreak++;
    } else {
      plateauStreak = 0;
    }
    prevBranchCount = snap.branchesHit;
    if (plateauStreak >= config.plateauRounds) {
      history.push(`plateau after ${sweep + 1} sweeps (±2 branches)`);
      break;
    }
  }

  // --- Phase B: Locksmith mutations while locked remain ---
  for (let m = 0; m < config.maxMutations; m++) {
    const locked = findLockedParagraphs(model, cov.branches, cov.paragraphs, config.ranking).filter(
      (l) => !lockedAttempted.has(l.name) && !lockedFailed.includes(l.name),
    );
    if (locked.length === 0) {
      history.push("no locked paragraphs remaining");
      break;
    }
    const target = locked[0]!;
    history.push(`locked: ${target.name} score=${target.score.toFixed(2)} uncovered=${target.uncoveredBranches.length}`);

    const catalog = catalogSkillsFor(target, model);
    // Prefer call-injection for never-entered paragraphs (vault / dead arms).
    const preferInject = !cov.paragraphs.has(target.name);
    let skill =
      (preferInject ? catalog.find((s) => s.kind === "call-injection") : undefined) ??
      catalog[0] ??
      (config.authoring ? config.authoring(target, model) : null);
    if (!skill) {
      lockedFailed.push(target.name);
      lockedAttempted.add(target.name);
      history.push(`no skill for ${target.name}`);
      continue;
    }
    lockedAttempted.add(target.name);

    const trial = [...mutations, skill];
    const before = snapshot(model, cov);
    // Fresh coverage probe with trial mutations on archive + a focused witness
    const probeCov = emptyCoverage(model);
    // Replay archive under trial
    let trialParityOk = true;
    let trialGain = 0;
    const probes: Witness[] =
      archive.length > 0
        ? archive.slice(-12)
        : [
            {
              id: "focus",
              algorithm: "pairwise",
              inputState: { ...(skill.pins ?? {}) },
              stubState: { ...(skill.pins ?? {}) },
            },
          ];

    for (const w of probes) {
      const cFp = cobolRunner(model, w, trial);
      const jFp = javaRunner(model, w, trial);
      const pr = parityGate(cFp, jFp);
      if (!pr.ok) trialParityOk = false;
      trialGain += absorbFingerprint(model, probeCov, cFp);
    }

    // Also run a skill-focused witness
    const focus: Witness = {
      id: `mut-${skill.id}`,
      algorithm: "pairwise",
      inputState: { ...(skill.pins ?? {}) },
      stubState: { ...(skill.pins ?? {}) },
    };
    const cFp = cobolRunner(model, focus, trial);
    const jFp = javaRunner(model, focus, trial);
    const pr = parityGate(cFp, jFp);
    if (!pr.ok) trialParityOk = false;
    trialGain += absorbFingerprint(model, probeCov, cFp);

    const afterProbe = snapshot(model, probeCov);
    const coverageUp =
      afterProbe.branchesHit > before.branchesHit ||
      afterProbe.paragraphsHit > before.paragraphsHit ||
      probeCov.paragraphs.has(target.name);

    if (coverageUp && trialParityOk) {
      mutations.push(skill);
      // Merge probe coverage into global
      for (const p of probeCov.paragraphs) cov.paragraphs.add(p);
      for (const b of probeCov.branches) cov.branches.add(b);
      for (const t of probeCov.transitions) cov.transitions.add(t);
      mutationsKept++;
      parityPass++;
      lockedOpened.push(target.name);
      history.push(`KEEP ${skill.id} (coverage↑ ∧ parity PASS)`);

      // Short witness search recurse (paper: return to Witness Search)
      const batch = witnessSearchSweep(model.harnessKeys, archive, eliteMap, armStats, totalPulls);
      totalPulls += batch.length;
      for (const w of batch.slice(0, 20)) {
        const r = evaluateWitness(model, w, mutations, javaRunner, cov);
        if (r.parity.ok) parityPass++;
        else parityFail++;
        if (r.gain > 0 && r.parity.ok) {
          archive.push(w);
          witnessesAccepted++;
        }
      }
    } else {
      mutationsReverted++;
      if (!trialParityOk) parityFail++;
      lockedFailed.push(target.name);
      history.push(
        `REVERT ${skill.id} (coverageUp=${coverageUp} parity=${trialParityOk} gain=${trialGain})`,
      );
    }
  }

  return {
    coverage: snapshot(model, cov),
    witnessesAccepted,
    mutationsKept,
    mutationsReverted,
    lockedOpened,
    lockedFailed,
    parityPass,
    parityFail,
    history,
  };
}

function evaluateWitness(
  model: ProgramModel,
  w: Witness,
  mutations: MutationSkill[],
  javaRunner: TargetRunner,
  cov: { paragraphs: Set<string>; transitions: Set<string>; branches: Set<string> },
): { gain: number; parity: ReturnType<typeof parityGate> } {
  const cFp = cobolRunner(model, w, mutations);
  const jFp = javaRunner(model, w, mutations);
  const parity = parityGate(cFp, jFp);
  const gain = parity.ok ? absorbFingerprint(model, cov, cFp) : 0;
  return { gain, parity };
}
