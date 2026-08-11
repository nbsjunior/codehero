/**
 * CodeHero code-graph — grafo estrutural determinístico do repositório.
 *
 * Sem Gen AI, sem Memgraph: Tree-sitter (via @codehero/engine) → JSON
 * com nós (funções/arquivos) e arestas (calls/imports). Consultas tipadas
 * (callers/callees/caminhos até entrypoints) para MCP, SDD e triagem.
 *
 * Distinto do Joern CPG (segurança profunda opcional): este grafo é
 * navegação + priorização, não taint enterprise.
 */
export type GraphNodeKind = "function" | "file";
export type GraphEdgeKind = "calls" | "imports";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  file: string;
  name: string;
  startLine?: number;
  endLine?: number;
  /** Heurística: main/handler/export de entry file, etc. */
  entry?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** Linha do call site / import (quando aplicável). */
  line?: number;
  /** Resolução: user = nome casou com função do repo; unknown = só nome. */
  resolved?: "user" | "unknown";
}

export interface CodeGraphDocument {
  version: 1;
  generatedAt: string;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  indexes: {
    fanIn: Record<string, number>;
    fanOut: Record<string, number>;
    entries: string[];
    byFile: Record<string, string[]>;
  };
}

export interface CallGraphEvidence {
  functionId: string | null;
  functionName: string | null;
  fanIn: number;
  fanOut: number;
  hopsToEntry: number | null;
  callers: Array<{ id: string; name: string; file: string }>;
  callees: Array<{ id: string; name: string; file: string }>;
  imports: string[];
  /** 0–1: alto = mais exposto (fan-in + perto de entry). Determinístico. */
  priority: number;
}
