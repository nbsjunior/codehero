import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CorpusCase } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS_PATH = join(__dirname, "..", "corpus", "golden.json");

/**
 * Loads the golden corpus. In production this file is grown over time by
 * merging `orgs/*\/ruleforgeFeedback` telemetry (false-positive flags and
 * fix-rejection signals collected from real usage — see
 * apps/functions/src/feedback.ts) via a human-reviewed PR, so the corpus
 * itself evolves alongside the rules it validates.
 */
export function loadCorpus(path: string = DEFAULT_CORPUS_PATH): CorpusCase[] {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function casesForRule(corpus: CorpusCase[], ruleId: string): CorpusCase[] {
  return corpus.filter((c) => c.ruleId === ruleId);
}
