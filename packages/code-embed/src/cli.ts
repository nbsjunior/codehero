#!/usr/bin/env node
/**
 * CLI offline — AST → embedding → K-Means.
 *
 *   hero-code-embed cluster <dir> [--out report.json] [--k 8] [--annotate-sarif in.sarif]
 *   hero-code-embed annotate <report.json> <in.sarif> <out.sarif>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { clusterRepository } from "./cluster.ts";
import { annotateSarifWithClusters } from "./annotate.ts";

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
}

function has(argv: string[], name: string): boolean {
  return argv.includes(name);
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "cluster") {
  const dir = rest.find((a) => !a.startsWith("-")) ?? ".";
  const out = resolve(flag(rest, "--out") ?? "reports/code-embed-clusters.json");
  const kRaw = flag(rest, "--k");
  const k = kRaw ? parseInt(kRaw, 10) : undefined;
  const annotateIn = flag(rest, "--annotate-sarif");
  const noPca = has(rest, "--no-pca");

  console.log(`CodeHero code-embed: clustering ${resolve(dir)} …`);
  const report = await clusterRepository({
    root: resolve(dir),
    k,
    withPca: !noPca,
  });
  mkdirSync(dirname(out), { recursive: true });
  // Embeddings completos incham o JSON — guardar só metadados + pca no report público.
  const slim = {
    ...report,
    functions: report.functions.map(({ embedding: _e, ...meta }) => meta),
  };
  writeFileSync(out, JSON.stringify(slim, null, 2));
  console.log(
    `→ ${out} (${report.functionCount} funções, k=${report.k}, inertia=${report.inertia.toFixed(2)})`,
  );

  if (annotateIn) {
    const sarifPath = resolve(annotateIn);
    const sarifOut = resolve(flag(rest, "--sarif-out") ?? annotateIn.replace(/\.sarif$/i, ".clustered.sarif"));
    const sarif = JSON.parse(readFileSync(sarifPath, "utf8"));
    const { annotated } = annotateSarifWithClusters(sarif, report);
    writeFileSync(sarifOut, JSON.stringify(sarif, null, 2));
    console.log(`SARIF anotado: ${annotated} finding(s) → ${sarifOut}`);
  }
} else if (cmd === "annotate") {
  const reportPath = rest[0];
  const sarifIn = rest[1];
  const sarifOut = rest[2] ?? (sarifIn ? sarifIn.replace(/\.sarif$/i, ".clustered.sarif") : null);
  if (!reportPath || !sarifIn || !sarifOut) {
    console.error("usage: hero-code-embed annotate <report.json> <in.sarif> [out.sarif]");
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
  // Relatório slim não tem embedding — annotate só precisa de functions[].
  const sarif = JSON.parse(readFileSync(resolve(sarifIn), "utf8"));
  const { annotated } = annotateSarifWithClusters(sarif, report);
  writeFileSync(resolve(sarifOut), JSON.stringify(sarif, null, 2));
  console.log(`annotated ${annotated} → ${sarifOut}`);
} else {
  console.error(`usage:
  hero-code-embed cluster <dir> [--out report.json] [--k N] [--annotate-sarif in.sarif] [--sarif-out out.sarif]
  hero-code-embed annotate <report.json> <in.sarif> [out.sarif]`);
  process.exit(1);
}
