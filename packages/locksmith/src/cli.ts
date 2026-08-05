#!/usr/bin/env node
/**
 * hero-locksmith — Locksmith Loop CLI (AmEx arXiv:2607.28271)
 *
 * Usage:
 *   hero-locksmith run <cobol-file> [--json]
 *   hero-locksmith analyze <cobol-file>
 */
import { isAbsolute, resolve } from "node:path";
import { analyzeCobolFile } from "./analyzer.ts";
import { runLocksmithLoop } from "./loop.ts";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const asJson = args.includes("--json");

function resolveInput(p: string | undefined): string {
  if (!p) return "";
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
const file = resolveInput(args[1]);

function usage(): never {
  console.log(`Usage:
  hero-locksmith run <cobol-file> [--json]
  hero-locksmith analyze <cobol-file> [--json]
`);
  process.exit(1);
}

if (cmd === "help" || cmd === "-h" || cmd === "--help") usage();

if (cmd === "analyze") {
  if (!file) usage();
  const model = analyzeCobolFile(file);
  if (asJson) {
    console.log(JSON.stringify(model, null, 2));
  } else {
    console.log(`Source: ${model.sourcePath}`);
    console.log(`Paragraphs (${model.paragraphs.length}): ${model.paragraphs.join(", ")}`);
    console.log(`Transitions: ${model.transitions.length}`);
    console.log(`Branch probes: ${model.branchProbes.length}`);
    for (const t of model.transitions) {
      console.log(`  ${t.from} -${t.kind}-> ${t.to}`);
    }
  }
  process.exit(0);
}

if (cmd === "run") {
  if (!file) usage();
  const report = runLocksmithLoop({ sourcePath: file });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("=== Locksmith Loop ===");
    console.log(
      `Coverage: paragraphs ${report.coverage.paragraphsHit}/${report.coverage.paragraphsTotal} ` +
        `(${(report.coverage.paragraphPct * 100).toFixed(0)}%) | ` +
        `branches ${report.coverage.branchesHit}/${report.coverage.branchesTotal} | ` +
        `transitions ${report.coverage.transitionsHit}/${report.coverage.transitionsTotal}`,
    );
    console.log(
      `Witnesses accepted: ${report.witnessesAccepted} | mutations kept: ${report.mutationsKept} | reverted: ${report.mutationsReverted}`,
    );
    console.log(`Parity PASS/FAIL: ${report.parityPass}/${report.parityFail}`);
    if (report.lockedOpened.length) console.log(`Opened: ${report.lockedOpened.join(", ")}`);
    if (report.lockedFailed.length) console.log(`Failed locks: ${report.lockedFailed.join(", ")}`);
    console.log("--- history ---");
    for (const h of report.history) console.log(`  ${h}`);
  }
  process.exit(report.parityFail > report.parityPass && report.mutationsKept === 0 ? 2 : 0);
}

usage();
