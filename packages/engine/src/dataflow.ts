import type { CfgBlock } from "./cfg.ts";

/**
 * Monotone forward dataflow (Dragon Book / Kildall).
 * Lattice elements must implement join (least upper bound) and equality.
 * Transfer is applied statement-by-statement inside each basic block.
 *
 * Complexity: O(N · H) where H is lattice height (for taint bits, small).
 */
export interface Lattice<F> {
  bottom: () => F;
  join: (a: F, b: F) => F;
  equals: (a: F, b: F) => boolean;
}

export function runForwardWorklist<F>(
  blocks: CfgBlock[],
  lattice: Lattice<F>,
  transferNode: (fact: F, node: CfgBlock["nodes"][number], blockId: number) => F,
  initial?: F,
): { inFact: F[]; outFact: F[] } {
  const n = blocks.length;
  const inFact: F[] = Array.from({ length: n }, () => lattice.bottom());
  const outFact: F[] = Array.from({ length: n }, () => lattice.bottom());
  if (n === 0) return { inFact, outFact };

  if (initial) inFact[0] = initial;

  const queue: number[] = [];
  const pending = new Set<number>();
  const enqueue = (id: number) => {
    if (!pending.has(id)) {
      pending.add(id);
      queue.push(id);
    }
  };

  enqueue(0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    pending.delete(id);
    const block = blocks[id]!;
    let fact: F = inFact[id] as F;
    for (const node of block.nodes) {
      fact = transferNode(fact, node, id);
    }
    outFact[id] = fact;
    for (const s of block.succ) {
      const joined = lattice.join(inFact[s] as F, fact);
      if (!lattice.equals(inFact[s] as F, joined)) {
        inFact[s] = joined;
        enqueue(s);
      }
    }
  }

  return { inFact, outFact };
}
