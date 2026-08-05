#!/usr/bin/env node
/**
 * One-shot: feedback JSON → training examples → fitted assertiveness.json
 *
 *   node scripts/train-fp-from-feedback.mjs scripts/fixtures/sample-ruleforge-feedback.json
 *   node scripts/train-fp-from-feedback.mjs path/to/export.json
 *
 * Does NOT replace seed unless --commit (writes packages/fp-ranker/models/assertiveness.json).
 * Without --commit, writes reports/assertiveness.fitted.json for review.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const inPath = args.find((a) => !a.startsWith("-"));
if (!inPath) {
  console.error("usage: node scripts/train-fp-from-feedback.mjs <feedback.json> [--commit]");
  process.exit(1);
}

mkdirSync("reports", { recursive: true });
const training = resolve("reports/fp-training.json");
const outModel = commit
  ? resolve("packages/fp-ranker/models/assertiveness.json")
  : resolve("reports/assertiveness.fitted.json");

const convert = spawnSync(
  process.execPath,
  [resolve("scripts/feedback-to-fp-training.mjs"), resolve(inPath), training],
  { stdio: "inherit" },
);
if (convert.status !== 0) process.exit(convert.status ?? 1);

const cli = existsSync("packages/fp-ranker/dist/cli.js")
  ? resolve("packages/fp-ranker/dist/cli.js")
  : null;
if (!cli) {
  console.error("Build fp-ranker first: npm run build:fp-ranker");
  process.exit(1);
}

const train = spawnSync(process.execPath, [cli, "train", training, outModel], { stdio: "inherit" });
if (train.status !== 0) process.exit(train.status ?? 1);

console.log(commit ? `committed model → ${outModel}` : `review model → ${outModel} (re-run with --commit to activate)`);
console.log("Runtime loads fitted model when trainSize>0 (set HERO_RANKER_SEED=1 to force seed).");
