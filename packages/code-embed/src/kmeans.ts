/**
 * K-Means determinístico (seed fixa) — agrupamento não supervisionado de embeddings.
 */
import { euclidean } from "./embed.ts";

export interface KMeansResult {
  k: number;
  assignments: number[];
  centroids: Float64Array[];
  inertia: number;
  iterations: number;
}

function seededRand(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function cloneVec(v: Float64Array): Float64Array {
  return Float64Array.from(v);
}

/** k-means++ style init com RNG seedado. */
function initCentroids(points: Float64Array[], k: number, rand: () => number): Float64Array[] {
  const centroids: Float64Array[] = [];
  centroids.push(cloneVec(points[Math.floor(rand() * points.length)]!));
  while (centroids.length < k) {
    const distSq = points.map((p) => {
      let best = Infinity;
      for (const c of centroids) best = Math.min(best, euclidean(p, c) ** 2);
      return best;
    });
    const sum = distSq.reduce((a, b) => a + b, 0) || 1;
    let r = rand() * sum;
    let idx = 0;
    for (let i = 0; i < distSq.length; i++) {
      r -= distSq[i]!;
      if (r <= 0) {
        idx = i;
        break;
      }
      idx = i;
    }
    centroids.push(cloneVec(points[idx]!));
  }
  return centroids;
}

export function chooseK(n: number, maxK = 24): number {
  if (n < 2) return 1;
  if (n < 6) return 2;
  return Math.max(2, Math.min(maxK, Math.round(Math.sqrt(n / 2))));
}

export function kmeans(
  points: Float64Array[],
  k: number,
  opts?: { maxIter?: number; seed?: number },
): KMeansResult {
  const maxIter = opts?.maxIter ?? 40;
  const seed = opts?.seed ?? 42;
  if (points.length === 0) {
    return { k: 0, assignments: [], centroids: [], inertia: 0, iterations: 0 };
  }
  const kk = Math.max(1, Math.min(k, points.length));
  const rand = seededRand(seed);
  let centroids = initCentroids(points, kk, rand);
  const assignments = new Array<number>(points.length).fill(0);
  let iterations = 0;

  for (; iterations < maxIter; iterations++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = euclidean(points[i]!, centroids[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const dim = points[0]!.length;
    const sums = Array.from({ length: kk }, () => new Float64Array(dim));
    const counts = new Array<number>(kk).fill(0);
    for (let i = 0; i < points.length; i++) {
      const a = assignments[i]!;
      counts[a]!++;
      const p = points[i]!;
      const s = sums[a]!;
      for (let d = 0; d < dim; d++) s[d]! += p[d]!;
    }
    for (let c = 0; c < kk; c++) {
      if (counts[c]! === 0) {
        centroids[c] = cloneVec(points[Math.floor(rand() * points.length)]!);
        continue;
      }
      const s = sums[c]!;
      const n = counts[c]!;
      const cen = new Float64Array(dim);
      for (let d = 0; d < dim; d++) cen[d] = s[d]! / n;
      centroids[c] = cen;
    }

    if (!changed && iterations > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < points.length; i++) {
    inertia += euclidean(points[i]!, centroids[assignments[i]!]!) ** 2;
  }

  return { k: kk, assignments, centroids, inertia, iterations: iterations + 1 };
}
