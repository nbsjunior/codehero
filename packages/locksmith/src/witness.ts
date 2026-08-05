import type { HarnessKey, Witness, WitnessAlgorithm } from "./types.ts";

function keyPart(k: HarnessKey, v: string | number | boolean): { input?: Record<string, string | number | boolean>; stub?: Record<string, string | number | boolean> } {
  if (k.kind === "input") return { input: { [k.name]: v } };
  return { stub: { [k.name]: v } };
}

function mergeWitness(
  id: string,
  algorithm: WitnessAlgorithm,
  parts: Array<{ input?: Record<string, string | number | boolean>; stub?: Record<string, string | number | boolean> }>,
): Witness {
  const inputState: Record<string, string | number | boolean> = {};
  const stubState: Record<string, string | number | boolean> = {};
  for (const p of parts) {
    Object.assign(inputState, p.input);
    Object.assign(stubState, p.stub);
  }
  return { id, algorithm, inputState, stubState };
}

/** Pairwise combinatorial (t=2) over harness domains. */
export function pairwiseWitnesses(keys: HarnessKey[], budget = 80): Witness[] {
  const out: Witness[] = [];
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!;
      const b = keys[j]!;
      for (const va of a.domain) {
        for (const vb of b.domain) {
          if (n >= budget) return out;
          out.push(
            mergeWitness(`pw-${n++}`, "pairwise", [keyPart(a, va), keyPart(b, vb)]),
          );
        }
      }
    }
  }
  return out;
}

/** 3-way covering (t=3) sample — first three keys Cartesian, rest pinned mid. */
export function threeWayWitnesses(keys: HarnessKey[], budget = 60): Witness[] {
  if (keys.length < 3) return pairwiseWitnesses(keys, budget);
  const [a, b, c, ...rest] = keys;
  const mid = rest.map((k) => keyPart(k, k.domain[Math.floor(k.domain.length / 2)]!));
  const out: Witness[] = [];
  let n = 0;
  for (const va of a!.domain) {
    for (const vb of b!.domain) {
      for (const vc of c!.domain) {
        if (n >= budget) return out;
        out.push(
          mergeWitness(`3w-${n++}`, "three-way", [
            keyPart(a!, va),
            keyPart(b!, vb),
            keyPart(c!, vc),
            ...mid,
          ]),
        );
      }
    }
  }
  return out;
}

/** Latin Hypercube–style: one sample per stratum index across keys. */
export function lhsWitnesses(keys: HarnessKey[], samples = 24): Witness[] {
  const out: Witness[] = [];
  const maxLen = Math.max(...keys.map((k) => k.domain.length), 1);
  for (let s = 0; s < samples; s++) {
    const parts = keys.map((k) => {
      const idx = Math.floor((s / samples) * k.domain.length) % k.domain.length;
      return keyPart(k, k.domain[idx]!);
    });
    // Shuffle stratum with offset by key index
    const offsetParts = keys.map((k, ki) => {
      const idx = (Math.floor((s / samples) * maxLen) + ki) % k.domain.length;
      return keyPart(k, k.domain[idx]!);
    });
    out.push(mergeWitness(`lhs-${s}`, "lhs", s % 2 === 0 ? parts : offsetParts));
  }
  return out;
}

/** Adaptive Random Testing — maximize distance from archive in normalized space. */
export function artWitnesses(keys: HarnessKey[], archive: Witness[], candidates = 40, pick = 12): Witness[] {
  const pool: Witness[] = [];
  for (let i = 0; i < candidates; i++) {
    const parts = keys.map((k) => keyPart(k, k.domain[Math.floor(Math.random() * k.domain.length)]!));
    pool.push(mergeWitness(`art-c-${i}`, "art", parts));
  }
  const scored = pool.map((w) => ({
    w,
    d: archive.length === 0 ? 1 : Math.min(...archive.map((a) => witnessDistance(keys, w, a))),
  }));
  scored.sort((a, b) => b.d - a.d);
  return scored.slice(0, pick).map((s, i) => ({ ...s.w, id: `art-${i}` }));
}

function witnessDistance(keys: HarnessKey[], a: Witness, b: Witness): number {
  let d = 0;
  for (const k of keys) {
    const av = k.kind === "input" ? a.inputState[k.name] : a.stubState[k.name];
    const bv = k.kind === "input" ? b.inputState[k.name] : b.stubState[k.name];
    if (av === undefined || bv === undefined) {
      d += 0.5;
      continue;
    }
    const ai = k.domain.indexOf(av as never);
    const bi = k.domain.indexOf(bv as never);
    d += Math.abs(ai - bi) / Math.max(k.domain.length - 1, 1);
  }
  return d;
}

/** MAP-Elites: niche by which stub keys are non-default. */
export function mapElitesWitnesses(keys: HarnessKey[], eliteMap: Map<string, Witness>, budget = 20): Witness[] {
  const out: Witness[] = [];
  let n = 0;
  while (n < budget) {
    const parts = keys.map((k) => keyPart(k, k.domain[Math.floor(Math.random() * k.domain.length)]!));
    const w = mergeWitness(`me-${n}`, "map-elites", parts);
    const niche = keys
      .filter((k) => k.kind === "stub")
      .map((k) => `${k.name}=${w.stubState[k.name] ?? "_"}`)
      .join("|");
    const prev = eliteMap.get(niche);
    if (!prev) {
      eliteMap.set(niche, w);
      out.push(w);
    } else {
      // Prefer denser input occupancy
      if (Object.keys(w.inputState).length >= Object.keys(prev.inputState).length) {
        eliteMap.set(niche, w);
        out.push(w);
      }
    }
    n++;
  }
  return out;
}

/** UCB1 bandit over keys — prefer under-explored (key,value) arms. */
export function ucb1Witnesses(
  keys: HarnessKey[],
  armStats: Map<string, { n: number; reward: number }>,
  totalPulls: number,
  pick = 16,
): Witness[] {
  const out: Witness[] = [];
  for (let i = 0; i < pick; i++) {
    const parts = keys.map((k) => {
      let bestVal = k.domain[0]!;
      let bestScore = -Infinity;
      for (const v of k.domain) {
        const arm = `${k.name}=${String(v)}`;
        const st = armStats.get(arm) ?? { n: 0, reward: 0 };
        const mean = st.n === 0 ? 1 : st.reward / st.n;
        const bonus = Math.sqrt((2 * Math.log(Math.max(totalPulls, 1))) / Math.max(st.n, 1e-6));
        const score = mean + bonus;
        if (score > bestScore) {
          bestScore = score;
          bestVal = v;
        }
      }
      const arm = `${k.name}=${String(bestVal)}`;
      const st = armStats.get(arm) ?? { n: 0, reward: 0 };
      armStats.set(arm, { n: st.n + 1, reward: st.reward });
      return keyPart(k, bestVal);
    });
    out.push(mergeWitness(`ucb1-${totalPulls + i}`, "ucb1", parts));
  }
  return out;
}

export function rewardUcb1(
  armStats: Map<string, { n: number; reward: number }>,
  w: Witness,
  reward: number,
): void {
  for (const [k, v] of Object.entries(w.inputState)) {
    const arm = `${k}=${String(v)}`;
    const st = armStats.get(arm) ?? { n: 1, reward: 0 };
    armStats.set(arm, { n: st.n, reward: st.reward + reward });
  }
  for (const [k, v] of Object.entries(w.stubState)) {
    const arm = `${k}=${String(v)}`;
    const st = armStats.get(arm) ?? { n: 1, reward: 0 };
    armStats.set(arm, { n: st.n, reward: st.reward + reward });
  }
}

/** One multi-algorithm sweep (paper Witness Search portfolio). */
export function witnessSearchSweep(
  keys: HarnessKey[],
  archive: Witness[],
  eliteMap: Map<string, Witness>,
  armStats: Map<string, { n: number; reward: number }>,
  totalPulls: number,
): Witness[] {
  return [
    ...pairwiseWitnesses(keys, 24),
    ...threeWayWitnesses(keys, 16),
    ...lhsWitnesses(keys, 12),
    ...artWitnesses(keys, archive, 30, 8),
    ...mapElitesWitnesses(keys, eliteMap, 10),
    ...ucb1Witnesses(keys, armStats, totalPulls, 8),
  ];
}
