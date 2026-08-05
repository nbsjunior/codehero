/**
 * Code embedding leve (estilo Code2Vec) — NÃO supervisionado, determinístico.
 *
 * Percorre a AST da função, extrai caminhos de tipos de nó (sem literais/
 * identificadores) e faz feature hashing para um vetor fixo. Funções com
 * forma parecida ficam próximas no espaço — base para K-Means offline.
 */
import { walk, type SyntaxNode } from "@codehero/engine";

/** Declarações de função — alinhado a packages/engine structural/metrics. */
export const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "function_item",
  "method_definition",
  "method_declaration",
  "constructor_declaration",
  "local_function_statement",
  "arrow_function",
  "function_expression",
  "generator_function_declaration",
  "func_literal",
  "lambda",
  "paragraph",
  "procedure_definition",
]);

export const DEFAULT_EMBED_DIM = 64;

/** FNV-1a 32-bit — estável cross-platform. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Caminhos curtos de tipos de nó (pai→filho→neto), inspirados em Code2Vec
 * path-contexts, sem rede neural.
 */
export function extractAstPaths(root: SyntaxNode, maxDepth = 4): string[] {
  const paths: string[] = [];
  const stack: Array<{ node: SyntaxNode; chain: string[] }> = [{ node: root, chain: [root.type] }];

  while (stack.length) {
    const { node, chain } = stack.pop()!;
    if (chain.length >= 2) {
      paths.push(chain.join(">"));
    }
    if (chain.length >= maxDepth) continue;
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (!c) continue;
      // Pula literais/idents — queremos FORMA, não valor (igual duplication.ts).
      if (
        /^(identifier|property_identifier|string|string_literal|number|integer|float|true|false|null|none|nil)$/i.test(
          c.type,
        )
      ) {
        continue;
      }
      stack.push({ node: c, chain: [...chain, c.type] });
    }
  }

  // Bag-of-types (unigramas) para funções muito pequenas.
  walk(root, (n) => {
    if (!/^(identifier|string|number|comment)/i.test(n.type)) {
      paths.push(`T:${n.type}`);
    }
  });

  return paths;
}

/** Feature hashing → vetor L2-normalizado. */
export function embedPaths(paths: string[], dim = DEFAULT_EMBED_DIM): Float64Array {
  const v = new Float64Array(dim);
  for (const p of paths) {
    const h = fnv1a(p);
    const idx = h % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    v[idx]! += sign;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i]! /= norm;
  return v;
}

export function embedFunctionAst(fnRoot: SyntaxNode, dim = DEFAULT_EMBED_DIM): Float64Array {
  return embedPaths(extractAstPaths(fnRoot), dim);
}

export function cosine(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function euclidean(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}
