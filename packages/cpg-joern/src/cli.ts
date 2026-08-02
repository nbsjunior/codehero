#!/usr/bin/env node
import { runJoernScan } from "./index.ts";

const args = process.argv.slice(2);
let sourceRoot = ".";
let out: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" || args[i] === "--out") out = args[++i];
  else if (args[i] && !args[i]!.startsWith("-")) sourceRoot = args[i]!;
}

const result = runJoernScan({ sourceRoot, outSarif: out });
if (!result.ok) {
  process.stderr.write(`hero-joern: FAILED (${result.backend})\n${result.stderr}\n${result.hint ?? ""}\n`);
  process.exit(2);
}
process.stdout.write(`${result.sarifPath}\n`);
process.stderr.write(`hero-joern: ${result.findingsApprox} finding(s) via ${result.backend}\n`);
