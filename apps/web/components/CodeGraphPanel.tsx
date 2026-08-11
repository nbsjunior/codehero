"use client";

import { useMemo } from "react";

export type CodeGraphViz = {
  version?: number;
  generatedAt?: string;
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
  links: Array<{ from: string; to: string; kind?: string }>;
};

export type IssueCallGraph = {
  functionId?: string | null;
  functionName?: string | null;
  fanIn?: number;
  fanOut?: number;
  hopsToEntry?: number | null;
  callers?: Array<{ id: string; name: string; file: string }>;
  callees?: Array<{ id: string; name: string; file: string }>;
  priority?: number;
};

/** Agrega evidência por issue quando o resumo do repo ainda não existe. */
export function vizFromIssues(
  issues: Array<{ file?: string; callGraph?: IssueCallGraph | null }>,
): CodeGraphViz | null {
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
  const links: CodeGraphViz["links"] = [];

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

  let n = 0;
  for (const issue of issues) {
    const g = issue.callGraph;
    if (!g?.functionId) continue;
    n += 1;
    upsert(g.functionId, g.functionName || "fn", issue.file || "", {
      fanIn: g.fanIn,
      fanOut: g.fanOut,
      hopsToEntry: g.hopsToEntry ?? null,
    });
    for (const c of g.callers ?? []) {
      upsert(c.id, c.name, c.file);
      const key = `${c.id}->${g.functionId}`;
      if (!linkKeys.has(key)) {
        linkKeys.add(key);
        links.push({ from: c.id, to: g.functionId, kind: "calls" });
      }
    }
    for (const c of g.callees ?? []) {
      upsert(c.id, c.name, c.file);
      const key = `${g.functionId}->${c.id}`;
      if (!linkKeys.has(key)) {
        linkKeys.add(key);
        links.push({ from: g.functionId, to: c.id, kind: "calls" });
      }
    }
  }
  if (!n || nodes.size === 0) return null;
  const hotspots = [...nodes.values()]
    .sort((a, b) => b.fanIn - a.fanIn || a.name.localeCompare(b.name))
    .slice(0, 28);
  return {
    version: 1,
    nodes: nodes.size,
    edges: links.length,
    functions: nodes.size,
    calls: links.length,
    imports: 0,
    entries: hotspots.filter((h) => h.hopsToEntry === 0).length,
    hotspots,
    links,
  };
}

function layoutNodes(ids: string[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.38;
  const pos = new Map<string, { x: number; y: number }>();
  const n = Math.max(1, ids.length);
  ids.forEach((id, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    pos.set(id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  return pos;
}

function shortName(name: string, max = 18): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

export function CodeGraphPanel({
  graph,
  loading = false,
  title = "Grafo do código avaliado",
  focus,
}: {
  graph: CodeGraphViz | null;
  loading?: boolean;
  title?: string;
  /** Destaca um nó (ex.: função do apontamento aberto). */
  focus?: { functionId?: string | null; functionName?: string | null } | null;
}) {
  const layout = useMemo(() => {
    if (!graph?.hotspots?.length) return null;
    const ids = graph.hotspots.map((h) => h.id);
    const W = 640;
    const H = 340;
    const pos = layoutNodes(ids, W, H);
    const byId = new Map(graph.hotspots.map((h) => [h.id, h]));
    const maxFan = Math.max(1, ...graph.hotspots.map((h) => h.fanIn));
    return { W, H, pos, byId, maxFan, ids };
  }, [graph]);

  if (loading) {
    return (
      <section className="ch-metric-card ch-graph-panel">
        <h3>{title}</h3>
        <p className="hero-caption">Carregando grafo…</p>
      </section>
    );
  }

  if (!graph || (!graph.functions && !graph.hotspots?.length)) {
    return (
      <section className="ch-metric-card ch-graph-panel">
        <h3>{title}</h3>
        <p className="hero-caption" style={{ marginBottom: 0 }}>
          Ainda sem grafo estrutural. Rode a avaliação no plugin ou no CI com métricas (o scanner gera o
          code-graph automaticamente) e sincronize o SARIF.
        </p>
      </section>
    );
  }

  const focusId = focus?.functionId ?? null;

  return (
    <section className="ch-metric-card ch-graph-panel">
      <div className="ch-section-title" style={{ marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="hero-caption">determinístico · sem Gen AI</span>
      </div>

      <div className="ch-graph-kpis" role="group" aria-label="Números do grafo">
        <div>
          <strong>{graph.functions.toLocaleString("pt-BR")}</strong>
          <span>funções</span>
        </div>
        <div>
          <strong>{graph.calls.toLocaleString("pt-BR")}</strong>
          <span>calls</span>
        </div>
        <div>
          <strong>{graph.imports.toLocaleString("pt-BR")}</strong>
          <span>imports</span>
        </div>
        <div>
          <strong>{graph.entries.toLocaleString("pt-BR")}</strong>
          <span>entries</span>
        </div>
        <div>
          <strong>{graph.nodes.toLocaleString("pt-BR")}</strong>
          <span>nós</span>
        </div>
        <div>
          <strong>{graph.edges.toLocaleString("pt-BR")}</strong>
          <span>arestas</span>
        </div>
      </div>

      {layout ? (
        <svg
          className="ch-graph-svg"
          viewBox={`0 0 ${layout.W} ${layout.H}`}
          role="img"
          aria-label="Relações de chamada entre funções avaliadas"
        >
          <defs>
            <marker
              id="ch-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted, #94a3b8)" />
            </marker>
          </defs>
          {graph.links.map((l, i) => {
            const a = layout.pos.get(l.from);
            const b = layout.pos.get(l.to);
            if (!a || !b) return null;
            return (
              <line
                key={`${l.from}-${l.to}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="ch-graph-edge"
                markerEnd="url(#ch-arrow)"
              />
            );
          })}
          {graph.hotspots.map((h) => {
            const p = layout.pos.get(h.id);
            if (!p) return null;
            const r = 10 + (h.fanIn / layout.maxFan) * 14;
            const isFocus = focusId === h.id || (!!focus?.functionName && focus.functionName === h.name);
            const isEntry = h.hopsToEntry === 0;
            return (
              <g key={h.id} transform={`translate(${p.x},${p.y})`}>
                <circle
                  r={r}
                  className={`ch-graph-node${isFocus ? " is-focus" : ""}${isEntry ? " is-entry" : ""}`}
                >
                  <title>
                    {`${h.name} · ${h.file}\nfan-in ${h.fanIn} · fan-out ${h.fanOut}` +
                      (h.hopsToEntry == null ? "" : ` · hops→entry ${h.hopsToEntry}`)}
                  </title>
                </circle>
                <text y={r + 12} className="ch-graph-label">
                  {shortName(h.name)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      <ul className="ch-graph-hotlist">
        {graph.hotspots.slice(0, 8).map((h) => (
          <li key={h.id}>
            <code>{h.name}</code>
            <span className="hero-caption" title={h.file}>
              {h.file.split("/").pop()}
            </span>
            <em>fan-in {h.fanIn}</em>
            {h.hopsToEntry != null ? <em>hops {h.hopsToEntry}</em> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Mini-grafo na ficha do apontamento. */
export function FindingCallGraphBlock({ callGraph }: { callGraph?: IssueCallGraph | null }) {
  if (!callGraph?.functionId && !callGraph?.functionName) return null;
  const callers = callGraph.callers ?? [];
  const callees = callGraph.callees ?? [];
  return (
    <div className="hero-ficha-block ch-finding-graph">
      <h4>Grafo (função avaliada)</h4>
      <p className="hero-caption" style={{ marginTop: 0 }}>
        <strong>{callGraph.functionName || "—"}</strong>
        {" · "}
        fan-in {callGraph.fanIn ?? 0}
        {" · "}
        fan-out {callGraph.fanOut ?? 0}
        {callGraph.hopsToEntry != null ? ` · hops→entry ${callGraph.hopsToEntry}` : ""}
      </p>
      <div className="ch-finding-graph-cols">
        <div>
          <span className="hero-caption">Callers</span>
          {callers.length === 0 ? (
            <p className="hero-caption">nenhum</p>
          ) : (
            <ul>
              {callers.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <code>{c.name}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <span className="hero-caption">Callees</span>
          {callees.length === 0 ? (
            <p className="hero-caption">nenhum</p>
          ) : (
            <ul>
              {callees.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <code>{c.name}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
