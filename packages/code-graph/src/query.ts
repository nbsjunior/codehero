import type { CallGraphEvidence, CodeGraphDocument, GraphNode } from "./types.ts";

function nodeMap(doc: CodeGraphDocument): Map<string, GraphNode> {
  return new Map(doc.nodes.map((n) => [n.id, n]));
}

function callAdj(doc: CodeGraphDocument, direction: "in" | "out"): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (e.kind !== "calls") continue;
    const from = direction === "out" ? e.from : e.to;
    const to = direction === "out" ? e.to : e.from;
    const list = m.get(from) ?? [];
    list.push(to);
    m.set(from, list);
  }
  return m;
}

export function callers(doc: CodeGraphDocument, id: string): GraphNode[] {
  const nodes = nodeMap(doc);
  const adj = callAdj(doc, "in");
  return (adj.get(id) ?? []).map((x) => nodes.get(x)).filter((n): n is GraphNode => Boolean(n));
}

export function callees(doc: CodeGraphDocument, id: string): GraphNode[] {
  const nodes = nodeMap(doc);
  const adj = callAdj(doc, "out");
  return (adj.get(id) ?? []).map((x) => nodes.get(x)).filter((n): n is GraphNode => Boolean(n));
}

export function importsOf(doc: CodeGraphDocument, fileOrFileId: string): string[] {
  const fid = fileOrFileId.startsWith("file:") ? fileOrFileId : `file:${fileOrFileId.replace(/\\/g, "/")}`;
  return doc.edges.filter((e) => e.kind === "imports" && e.from === fid).map((e) => {
    const n = doc.nodes.find((x) => x.id === e.to);
    return n?.name || e.to;
  });
}

export function functionAt(doc: CodeGraphDocument, file: string, line: number): GraphNode | null {
  const f = file.replace(/\\/g, "/");
  let best: GraphNode | null = null;
  for (const n of doc.nodes) {
    if (n.kind !== "function" || n.file !== f || n.startLine == null || n.endLine == null) continue;
    if (line >= n.startLine && line <= n.endLine) {
      if (!best || (n.startLine ?? 0) >= (best.startLine ?? 0)) best = n;
    }
  }
  return best;
}

/**
 * BFS reverse along calls edges from `id` toward entry nodes.
 * Returns minimum hops, or null if unreachable.
 */
export function hopsToEntrypoint(doc: CodeGraphDocument, id: string, maxDepth = 12): number | null {
  const entries = new Set(doc.indexes.entries);
  if (entries.has(id)) return 0;
  const reverse = callAdj(doc, "in"); // callers of X
  // Walk from id following callers (who calls me) toward entries? 
  // Actually path TO entrypoint means: can an entry reach me via calls?
  // So forward from entries, or reverse from id following callers.
  const queue: Array<{ id: string; d: number }> = [{ id, d: 0 }];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.d >= maxDepth) continue;
    for (const caller of reverse.get(cur.id) ?? []) {
      if (seen.has(caller)) continue;
      if (entries.has(caller)) return cur.d + 1;
      seen.add(caller);
      queue.push({ id: caller, d: cur.d + 1 });
    }
  }
  return null;
}

/** Deterministic priority 0–1 for triage (no ML). */
export function graphPriority(fanIn: number, hops: number | null): number {
  const fan = Math.min(1, fanIn / 20);
  const reach = hops == null ? 0.15 : Math.max(0, 1 - hops / 8);
  return Math.round((0.55 * fan + 0.45 * reach) * 1000) / 1000;
}

export function enrichFinding(
  doc: CodeGraphDocument,
  file: string,
  line: number,
  opts?: { callerLimit?: number },
): CallGraphEvidence {
  const limit = opts?.callerLimit ?? 8;
  const fn = functionAt(doc, file, line);
  const id = fn?.id ?? null;
  const fanIn = id ? doc.indexes.fanIn[id] ?? 0 : 0;
  const fanOut = id ? doc.indexes.fanOut[id] ?? 0 : 0;
  const hops = id ? hopsToEntrypoint(doc, id) : null;
  const callerNodes = id ? callers(doc, id).slice(0, limit) : [];
  const calleeNodes = id ? callees(doc, id).slice(0, limit) : [];
  const imports = importsOf(doc, file.replace(/\\/g, "/"));

  return {
    functionId: id,
    functionName: fn?.name ?? null,
    fanIn,
    fanOut,
    hopsToEntry: hops,
    callers: callerNodes.map((n) => ({ id: n.id, name: n.name, file: n.file })),
    callees: calleeNodes.map((n) => ({ id: n.id, name: n.name, file: n.file })),
    imports,
    priority: graphPriority(fanIn, hops),
  };
}

export function summarizeGraph(doc: CodeGraphDocument): {
  nodes: number;
  edges: number;
  functions: number;
  calls: number;
  imports: number;
  entries: number;
} {
  return {
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    functions: doc.nodes.filter((n) => n.kind === "function").length,
    calls: doc.edges.filter((e) => e.kind === "calls").length,
    imports: doc.edges.filter((e) => e.kind === "imports").length,
    entries: doc.indexes.entries.length,
  };
}
