import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { dirname as posixDirname, join as posixJoin } from "node:path/posix";
import {
  parseStructural,
  structuralLanguageFor,
  computeFileMetrics,
  walk,
  type SyntaxNode,
} from "@codehero/engine";
import type { CodeGraphDocument, GraphEdge, GraphNode } from "./types.ts";

const CALL_TYPES = new Set([
  "call_expression",
  "call",
  "method_invocation",
  "invocation_expression", // C#
]);

const IMPORT_TYPES = new Set([
  "import_statement",
  "import_declaration",
  "import_from_statement",
  "using_directive",
]);

const ENTRY_NAMES = new Set([
  "main",
  "Main",
  "handler",
  "Handler",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "run",
  "start",
  "listen",
]);

const ENTRY_FILE_RE = /(^|\/)(main|index|app|server|api|route|routes|handler|program)(\.[^/]+)?$/i;

function posix(p: string): string {
  return p.split("\\").join("/");
}

function nodeId(file: string, name: string, startLine: number): string {
  return `${posix(file)}#${name || "anonymous"}@${startLine}`;
}

function fileId(file: string): string {
  return `file:${posix(file)}`;
}

function calleeNameFromCall(n: SyntaxNode): string | null {
  // Prefer field "function" / "name" when present.
  const fn = n.childForFieldName("function") ?? n.childForFieldName("name");
  if (fn) return leafIdentifier(fn);
  // Fallback: last identifier-like child (covers member calls loosely).
  let last: string | null = null;
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (!c) continue;
    const id = leafIdentifier(c);
    if (id) last = id;
    if (c.type === "arguments" || c.type === "argument_list") break;
  }
  return last;
}

function leafIdentifier(n: SyntaxNode): string | null {
  if (
    n.type === "identifier" ||
    n.type === "property_identifier" ||
    n.type === "field_identifier" ||
    n.type === "type_identifier"
  ) {
    return n.text || null;
  }
  if (n.type === "member_expression" || n.type === "member_access_expression" || n.type === "attribute") {
    const prop = n.childForFieldName("property") ?? n.childForFieldName("name");
    if (prop?.text) return prop.text;
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (!c) continue;
      const id = leafIdentifier(c);
      if (id) return id;
    }
  }
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (!c) continue;
    const id = leafIdentifier(c);
    if (id) return id;
  }
  return null;
}

function importPathFromNode(n: SyntaxNode): string | null {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (!c) continue;
    if (c.type === "string" || c.type === "string_literal" || c.type === "interpreted_string_literal") {
      const raw = c.text || "";
      const q = raw[0];
      const quoteChars = new Set(['"', "'", String.fromCharCode(96)]);
      const t =
        raw.length >= 2 && quoteChars.has(q!) && raw[raw.length - 1] === q
          ? raw.slice(1, -1)
          : raw;
      if (t) return t;
    }
    const nested = importPathFromNode(c);
    if (nested) return nested;
  }
  return null;
}

function isEntryFunction(name: string | null, file: string): boolean {
  if (name && ENTRY_NAMES.has(name)) return true;
  if (name && ENTRY_FILE_RE.test(posix(file)) && (name === "default" || !name.startsWith("_"))) {
    return true;
  }
  return false;
}

export interface BuildCodeGraphOptions {
  root: string;
  files: string[];
  /** Max files to parse (safety). */
  maxFiles?: number;
}

/**
 * Builds a deterministic structural graph for the given source files.
 * Unresolved call names become synthetic function stubs (resolved: unknown).
 */
export async function buildCodeGraph(opts: BuildCodeGraphOptions): Promise<CodeGraphDocument> {
  const root = resolve(opts.root);
  const maxFiles = opts.maxFiles ?? 8_000;
  const files = opts.files
    .map((f) => resolve(root, f))
    .filter((f) => structuralLanguageFor(f))
    .slice(0, maxFiles);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byName = new Map<string, string[]>(); // simple name → node ids
  const fileNodeIds = new Map<string, string>();

  // Pass 1: functions + file nodes
  for (const abs of files) {
    const rel = posix(relative(root, abs) || posix(abs));
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const parsed = await parseStructural(rel, source);
    if (!parsed) continue;

    const fid = fileId(rel);
    if (!fileNodeIds.has(rel)) {
      fileNodeIds.set(rel, fid);
      nodes.push({ id: fid, kind: "file", file: rel, name: rel });
    }

    const metrics = computeFileMetrics(rel, source, parsed);
    for (const fn of metrics.functions) {
      const name = fn.name || "anonymous";
      const id = nodeId(rel, name, fn.startLine);
      nodes.push({
        id,
        kind: "function",
        file: rel,
        name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        entry: isEntryFunction(fn.name, rel),
      });
      const list = byName.get(name) ?? [];
      list.push(id);
      byName.set(name, list);
    }
  }

  const functionNodes = nodes.filter((n) => n.kind === "function");
  const enclosing = (file: string, line: number): string | null => {
    let best: GraphNode | null = null;
    for (const n of functionNodes) {
      if (n.file !== file || n.startLine == null || n.endLine == null) continue;
      if (line >= n.startLine && line <= n.endLine) {
        if (!best || (n.startLine ?? 0) >= (best.startLine ?? 0)) best = n;
      }
    }
    return best?.id ?? null;
  };

  // Pass 2: calls + imports
  for (const abs of files) {
    const rel = posix(relative(root, abs) || posix(abs));
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const parsed = await parseStructural(rel, source);
    if (!parsed) continue;

    walk(parsed.root, (n) => {
      if (CALL_TYPES.has(n.type)) {
        const name = calleeNameFromCall(n);
        if (!name) return;
        const line = n.startPosition.row + 1;
        const from = enclosing(rel, line) ?? fileId(rel);
        const candidates = byName.get(name) ?? [];
        // Prefer same-file unique, else unique global, else stub.
        let to: string;
        let resolved: "user" | "unknown" = "unknown";
        const same = candidates.filter((id) => id.startsWith(`${rel}#`));
        if (same.length === 1) {
          to = same[0]!;
          resolved = "user";
        } else if (candidates.length === 1) {
          to = candidates[0]!;
          resolved = "user";
        } else {
          to = `unresolved:${name}`;
          if (!nodes.some((x) => x.id === to)) {
            nodes.push({
              id: to,
              kind: "function",
              file: "",
              name,
            });
          }
        }
        if (from !== to) {
          edges.push({ from, to, kind: "calls", line, resolved });
        }
        return;
      }

      if (IMPORT_TYPES.has(n.type)) {
        const spec = importPathFromNode(n);
        if (!spec) return;
        const from = fileId(rel);
        let to = `module:${spec}`;
        let resolved: "user" | "unknown" = "unknown";
        if (spec.startsWith(".")) {
          const base = posixDirname(rel);
          const joined = posixJoin(base, spec);
          const guess = [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`, `${joined}.jsx`, `${joined}/index.ts`];
          for (const g of guess) {
            if (fileNodeIds.has(g)) {
              to = fileId(g);
              resolved = "user";
              break;
            }
          }
        }
        if (!nodes.some((x) => x.id === to)) {
          nodes.push({
            id: to,
            kind: "file",
            file: resolved === "user" ? to.replace(/^file:/, "") : "",
            name: spec,
          });
        }
        edges.push({ from, to, kind: "imports", line: n.startPosition.row + 1, resolved });
      }
    });
  }

  const fanIn: Record<string, number> = {};
  const fanOut: Record<string, number> = {};
  for (const e of edges) {
    if (e.kind !== "calls") continue;
    fanIn[e.to] = (fanIn[e.to] ?? 0) + 1;
    fanOut[e.from] = (fanOut[e.from] ?? 0) + 1;
  }

  const byFile: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.kind !== "function" || !n.file) continue;
    (byFile[n.file] ??= []).push(n.id);
  }

  const entries = nodes.filter((n) => n.entry).map((n) => n.id);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: posix(root),
    nodes,
    edges,
    indexes: { fanIn, fanOut, entries, byFile },
  };
}

export function saveCodeGraph(doc: CodeGraphDocument, path: string): void {
  writeFileSync(path, JSON.stringify(doc, null, 2), "utf8");
}

export function loadCodeGraph(path: string): CodeGraphDocument {
  return JSON.parse(readFileSync(path, "utf8")) as CodeGraphDocument;
}
