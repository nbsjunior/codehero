import type { CodeGraphDocument } from "./types.ts";
import { hopsToEntrypoint, summarizeGraph } from "./query.ts";

/** Compacto o bastante para SARIF run properties + Firestore (sem o JSON completo). */
export interface CodeGraphVizSummary {
  version: 1;
  generatedAt: string;
  nodes: number;
  edges: number;
  functions: number;
  calls: number;
  imports: number;
  entries: number;
  hotspots: Array<{
    id: string;
    name: string;
    file: string;
    fanIn: number;
    fanOut: number;
    hopsToEntry: number | null;
  }>;
  /** Arestas entre hotspots (e vizinhos imediatos), limitadas. */
  links: Array<{ from: string; to: string; kind: "calls" | "imports" }>;
}

const HOTSPOT_LIMIT = 28;
const LINK_LIMIT = 90;

/**
 * Resume o grafo para UI (portal/plugin): contagens + amostra de nós/arestas.
 * Determinístico — sem Gen AI.
 */
export function toVizSummary(doc: CodeGraphDocument): CodeGraphVizSummary {
  const stats = summarizeGraph(doc);
  const functions = doc.nodes.filter((n) => n.kind === "function" && n.file);
  const ranked = [...functions]
    .map((n) => ({
      id: n.id,
      name: n.name,
      file: n.file,
      fanIn: doc.indexes.fanIn[n.id] ?? 0,
      fanOut: doc.indexes.fanOut[n.id] ?? 0,
      hopsToEntry: hopsToEntrypoint(doc, n.id),
    }))
    .sort((a, b) => b.fanIn - a.fanIn || a.name.localeCompare(b.name))
    .slice(0, HOTSPOT_LIMIT);

  const hotspotIds = new Set(ranked.map((h) => h.id));
  const links: CodeGraphVizSummary["links"] = [];
  for (const e of doc.edges) {
    if (links.length >= LINK_LIMIT) break;
    if (e.kind !== "calls") continue;
    if (!hotspotIds.has(e.from) && !hotspotIds.has(e.to)) continue;
    links.push({ from: e.from, to: e.to, kind: "calls" });
  }

  return {
    version: 1,
    generatedAt: doc.generatedAt,
    nodes: stats.nodes,
    edges: stats.edges,
    functions: stats.functions,
    calls: stats.calls,
    imports: stats.imports,
    entries: stats.entries,
    hotspots: ranked,
    links,
  };
}

/** Monta um viz a partir de evidências por issue (quando o run summary não veio). */
export function vizFromCallGraphEvidence(
  items: Array<{
    callGraph?: {
      functionId?: string | null;
      functionName?: string | null;
      fanIn?: number;
      fanOut?: number;
      hopsToEntry?: number | null;
      callers?: Array<{ id: string; name: string; file: string }>;
      callees?: Array<{ id: string; name: string; file: string }>;
    } | null;
    file?: string;
  }>,
): CodeGraphVizSummary | null {
  const nodes = new Map<
    string,
    {
      id: string;
      name: string;
      file: string;
      fanIn: number;
      fanOut: number;
      hopsToEntry: number | null;
    }
  >();
  const linkKeys = new Set<string>();
  const links: CodeGraphVizSummary["links"] = [];

  const upsert = (
    id: string,
    name: string,
    file: string,
    extras?: { fanIn?: number; fanOut?: number; hopsToEntry?: number | null },
  ) => {
    const prev = nodes.get(id);
    if (!prev) {
      nodes.set(id, {
        id,
        name,
        file,
        fanIn: extras?.fanIn ?? 0,
        fanOut: extras?.fanOut ?? 0,
        hopsToEntry: extras?.hopsToEntry ?? null,
      });
      return;
    }
    prev.fanIn = Math.max(prev.fanIn, extras?.fanIn ?? 0);
    prev.fanOut = Math.max(prev.fanOut, extras?.fanOut ?? 0);
    if (prev.hopsToEntry == null && extras?.hopsToEntry != null) {
      prev.hopsToEntry = extras.hopsToEntry;
    }
  };

  const addLink = (from: string, to: string) => {
    const key = `${from}->${to}`;
    if (linkKeys.has(key) || links.length >= LINK_LIMIT) return;
    linkKeys.add(key);
    links.push({ from, to, kind: "calls" });
  };

  let withGraph = 0;
  for (const item of items) {
    const g = item.callGraph;
    if (!g?.functionId) continue;
    withGraph += 1;
    upsert(g.functionId, g.functionName || "fn", item.file || "", {
      fanIn: g.fanIn,
      fanOut: g.fanOut,
      hopsToEntry: g.hopsToEntry ?? null,
    });
    for (const c of g.callers ?? []) {
      upsert(c.id, c.name, c.file);
      addLink(c.id, g.functionId);
    }
    for (const c of g.callees ?? []) {
      upsert(c.id, c.name, c.file);
      addLink(g.functionId, c.id);
    }
  }

  if (!withGraph || nodes.size === 0) return null;

  const hotspots = [...nodes.values()]
    .sort((a, b) => b.fanIn - a.fanIn || a.name.localeCompare(b.name))
    .slice(0, HOTSPOT_LIMIT);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    nodes: nodes.size,
    edges: links.length,
    functions: nodes.size,
    calls: links.length,
    imports: 0,
    entries: hotspots.filter((h) => h.hopsToEntry === 0).length,
    hotspots,
    links: links.filter(
      (l) => hotspots.some((h) => h.id === l.from) || hotspots.some((h) => h.id === l.to),
    ),
  };
}
