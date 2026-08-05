import type { BehavioralFingerprint, CoverageSnapshot, ProgramModel } from "./types.ts";

export function emptyCoverage(model: ProgramModel): {
  paragraphs: Set<string>;
  transitions: Set<string>;
  branches: Set<string>;
} {
  return {
    paragraphs: new Set(),
    transitions: new Set(),
    branches: new Set(),
  };
}

export function absorbFingerprint(
  model: ProgramModel,
  cov: { paragraphs: Set<string>; transitions: Set<string>; branches: Set<string> },
  fp: BehavioralFingerprint,
): number {
  let gained = 0;
  for (const p of fp.paragraphsHit) {
    if (!cov.paragraphs.has(p)) {
      cov.paragraphs.add(p);
      gained++;
    }
  }
  for (const b of fp.branchesHit) {
    if (!cov.branches.has(b)) {
      cov.branches.add(b);
      gained++;
    }
  }
  // Infer transitions from consecutive paragraph hits in unsorted order — use pair presence.
  const hit = new Set(fp.paragraphsHit);
  for (const t of model.transitions) {
    if (hit.has(t.from) && (hit.has(t.to) || t.to.startsWith("CALL:"))) {
      const key = `${t.from}->${t.to}`;
      if (!cov.transitions.has(key)) {
        cov.transitions.add(key);
        gained++;
      }
    }
  }
  return gained;
}

export function snapshot(
  model: ProgramModel,
  cov: { paragraphs: Set<string>; transitions: Set<string>; branches: Set<string> },
): CoverageSnapshot {
  const paragraphsTotal = Math.max(model.paragraphs.length, 1);
  const transitionsTotal = Math.max(model.transitions.length, 1);
  const branchesTotal = Math.max(model.branchProbes.length, 1);
  return {
    paragraphsHit: cov.paragraphs.size,
    paragraphsTotal: model.paragraphs.length,
    transitionsHit: cov.transitions.size,
    transitionsTotal: model.transitions.length,
    branchesHit: cov.branches.size,
    branchesTotal: model.branchProbes.length,
    paragraphPct: cov.paragraphs.size / paragraphsTotal,
    transitionPct: cov.transitions.size / transitionsTotal,
    branchPct: cov.branches.size / branchesTotal,
  };
}

/** Plateau: branch coverage gain within ±tol of previous (paper ±2–3). */
export function isPlateau(prevBranches: number, nextBranches: number, tol = 2): boolean {
  return Math.abs(nextBranches - prevBranches) <= tol && nextBranches <= prevBranches;
}
