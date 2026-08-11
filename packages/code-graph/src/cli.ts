#!/usr/bin/env node
/**
 * hero-code-graph — build/query deterministic repo graph (no Gen AI).
 *
 *   hero-code-graph build [root] -o .codehero/code-graph.json
 *   hero-code-graph callers <file#line> --graph .codehero/code-graph.json
 *   hero-code-graph enrich <file> <line> --graph ...
 */
import { mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildCodeGraph, loadCodeGraph, saveCodeGraph } from "./build.ts";
import { callees, callers, enrichFinding, summarizeGraph } from "./query.ts";
import { structuralLanguageFor } from "@codehero/engine";

function collectFiles(root: string, ignore = new Set(["node_modules", "dist", ".git", "out", "coverage", ".next"])): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && structuralLanguageFor(abs)) out.push(abs);
    }
  };
  const st = statSync(root);
  if (st.isFile()) return structuralLanguageFor(root) ? [root] : [];
  walk(root);
  return out;
}

function parseArgs(argv: string[]) {
  const cmd = argv[0] ?? "help";
  const out: { cmd: string; root: string; graph: string; file?: string; line?: number; positional: string[] } = {
    cmd,
    root: process.cwd(),
    graph: join(process.cwd(), ".codehero", "code-graph.json"),
    positional: [],
  };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "-o" || a === "--out" || a === "--graph") {
      out.graph = resolve(rest[++i] ?? out.graph);
    } else if (a === "--root") {
      out.root = resolve(rest[++i] ?? out.root);
    } else if (!a.startsWith("-")) {
      out.positional.push(a);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "help" || args.cmd === "--help") {
    process.stdout.write(`Usage:
  hero-code-graph build [root] -o .codehero/code-graph.json
  hero-code-graph callers <nodeId> --graph ...
  hero-code-graph callees <nodeId> --graph ...
  hero-code-graph enrich <file> <line> --graph ...
`);
    return;
  }

  if (args.cmd === "build") {
    const root = resolve(args.positional[0] ?? args.root);
    const files = collectFiles(root);
    process.stderr.write(`Building code-graph for ${files.length} file(s) under ${root}…\n`);
    const doc = await buildCodeGraph({ root, files });
    mkdirSync(dirname(args.graph), { recursive: true });
    saveCodeGraph(doc, args.graph);
    const s = summarizeGraph(doc);
    process.stdout.write(JSON.stringify({ out: args.graph, ...s }, null, 2) + "\n");
    return;
  }

  if (!existsSync(args.graph)) {
    process.stderr.write(`Graph not found: ${args.graph}\nRun: hero-code-graph build\n`);
    process.exit(2);
  }
  const doc = loadCodeGraph(args.graph);

  if (args.cmd === "callers") {
    const id = args.positional[0];
    if (!id) throw new Error("callers requires nodeId");
    process.stdout.write(JSON.stringify(callers(doc, id), null, 2) + "\n");
    return;
  }
  if (args.cmd === "callees") {
    const id = args.positional[0];
    if (!id) throw new Error("callees requires nodeId");
    process.stdout.write(JSON.stringify(callees(doc, id), null, 2) + "\n");
    return;
  }
  if (args.cmd === "enrich") {
    const file = args.positional[0];
    const line = Number(args.positional[1]);
    if (!file || !Number.isFinite(line)) throw new Error("enrich requires <file> <line>");
    process.stdout.write(JSON.stringify(enrichFinding(doc, file, line), null, 2) + "\n");
    return;
  }

  process.stderr.write(`Unknown command: ${args.cmd}\n`);
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.stack ?? err.message : err) + "\n");
  process.exit(1);
});
