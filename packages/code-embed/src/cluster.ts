/**
 * Pipeline offline: arquivos → AST → embedding → K-Means → famílias.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { parseStructural, walk, type SyntaxNode } from "@codehero/engine";
import { DEFAULT_EMBED_DIM, embedFunctionAst, euclidean, FUNCTION_NODE_TYPES } from "./embed.ts";
import { chooseK, kmeans } from "./kmeans.ts";
import { pca2d } from "./pca.ts";

const CODE_EXT = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".go",
  ".cs",
  ".cbl",
  ".cob",
  ".sql",
]);

export interface FunctionUnit {
  id: string;
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  embedding: number[];
  clusterId: string;
  clusterIndex: number;
  familySize: number;
  /** 0 = no centro; 1 = outlier do próprio cluster. */
  outlierScore: number;
  pca?: { x: number; y: number };
}

export interface ClusterReport {
  version: "code-embed-v1";
  generatedAt: string;
  dim: number;
  k: number;
  inertia: number;
  iterations: number;
  functionCount: number;
  fileCount: number;
  clusters: Array<{
    id: string;
    size: number;
    /** Arquivos mais representativos (amostra). */
    sampleFiles: string[];
  }>;
  functions: FunctionUnit[];
}

function listFiles(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name === ".git" || name === "build") continue;
    const p = join(root, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(p, out);
    else if (CODE_EXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function functionName(n: SyntaxNode): string {
  const id = n.childForFieldName("name");
  if (id?.text) return id.text.slice(0, 80);
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i);
    if (c && (c.type === "identifier" || c.type === "property_identifier")) {
      return c.text.slice(0, 80);
    }
  }
  return n.type;
}

export interface ExtractedFn {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  node: SyntaxNode;
}

export async function extractFunctions(file: string, source: string): Promise<ExtractedFn[]> {
  const parsed = await parseStructural(file, source);
  if (!parsed) return [];
  const out: ExtractedFn[] = [];
  walk(parsed.root, (n) => {
    if (!FUNCTION_NODE_TYPES.has(n.type)) return;
    const startLine = n.startPosition.row + 1;
    const endLine = n.endPosition.row + 1;
    if (endLine - startLine < 1) return;
    out.push({
      file,
      name: functionName(n),
      startLine,
      endLine,
      node: n,
    });
  });
  return out;
}

export interface ClusterOptions {
  root: string;
  k?: number;
  dim?: number;
  seed?: number;
  maxFiles?: number;
  withPca?: boolean;
}

export async function clusterRepository(opts: ClusterOptions): Promise<ClusterReport> {
  const dim = opts.dim ?? DEFAULT_EMBED_DIM;
  const root = opts.root;
  const files = listFiles(root).slice(0, opts.maxFiles ?? 5000);
  const extracted: ExtractedFn[] = [];
  const cwd = root;

  for (const abs of files) {
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (source.length > 1_500_000) continue;
    const rel = relative(cwd, abs).split("\\").join("/") || abs;
    try {
      for (const fn of await extractFunctions(rel, source)) {
        extracted.push({ ...fn, file: rel });
      }
    } catch {
      /* parser fail — skip file */
    }
  }

  const vectors = extracted.map((fn) => embedFunctionAst(fn.node, dim));
  const k = opts.k ?? chooseK(vectors.length);
  const km = kmeans(vectors, k, { seed: opts.seed ?? 42 });

  const sizes = new Array<number>(km.k).fill(0);
  for (const a of km.assignments) sizes[a]!++;

  const dists = extracted.map((_, i) => {
    const a = km.assignments[i]!;
    return euclidean(vectors[i]!, km.centroids[a]!);
  });
  const maxByCluster = new Array<number>(km.k).fill(0);
  for (let i = 0; i < dists.length; i++) {
    const a = km.assignments[i]!;
    maxByCluster[a] = Math.max(maxByCluster[a]!, dists[i]!);
  }

  const pca = opts.withPca !== false ? pca2d(vectors) : [];

  const functions: FunctionUnit[] = extracted.map((fn, i) => {
    const a = km.assignments[i]!;
    const maxD = maxByCluster[a]! || 1;
    const clusterId = `fam-${km.k}-${a}`;
    return {
      id: `${fn.file}:${fn.startLine}:${fn.name}`,
      file: fn.file,
      name: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      embedding: Array.from(vectors[i]!),
      clusterId,
      clusterIndex: a,
      familySize: sizes[a]!,
      outlierScore: Math.min(1, dists[i]! / maxD),
      pca: pca[i],
    };
  });

  const clusters = Array.from({ length: km.k }, (_, a) => {
    const id = `fam-${km.k}-${a}`;
    const members = functions.filter((f) => f.clusterIndex === a);
    const filesSample = [...new Set(members.map((m) => m.file))].slice(0, 8);
    return { id, size: members.length, sampleFiles: filesSample };
  }).filter((c) => c.size > 0);

  return {
    version: "code-embed-v1",
    generatedAt: new Date().toISOString(),
    dim,
    k: km.k,
    inertia: km.inertia,
    iterations: km.iterations,
    functionCount: functions.length,
    fileCount: files.length,
    clusters,
    functions,
  };
}

/** Índice file → funções (para anotar findings por linha). */
export function indexByFile(report: ClusterReport): Map<string, FunctionUnit[]> {
  const m = new Map<string, FunctionUnit[]>();
  for (const f of report.functions) {
    const key = f.file.replace(/\\/g, "/");
    const list = m.get(key) ?? [];
    list.push(f);
    m.set(key, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.startLine - b.startLine);
  return m;
}

export function findFamilyForLine(
  byFile: Map<string, FunctionUnit[]>,
  file: string,
  line: number,
): FunctionUnit | null {
  const list = byFile.get(file.replace(/\\/g, "/"));
  if (!list) return null;
  return list.find((f) => line >= f.startLine && line <= f.endLine) ?? null;
}
