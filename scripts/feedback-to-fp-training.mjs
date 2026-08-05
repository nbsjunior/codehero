#!/usr/bin/env node
/**
 * Convert ruleforgeFeedback export JSON → fp-ranker training examples.
 *
 * 1. Call exportRuleforgeFeedback (callable) or pass a dumped JSON array.
 * 2. node scripts/feedback-to-fp-training.mjs feedback.json training.json
 * 3. npm run fp-ranker:train -- training.json
 *
 * Expected input row shapes (flexible):
 *   { verdict: "false_positive"|"confirmed", ruleId, file?, snippet?, ... }
 *   { label: 0|1|"false_positive"|"confirmed", finding: { ruleId, file, ... } }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const inPath = process.argv[2];
const outPath = process.argv[3] ?? "reports/fp-training.json";
if (!inPath) {
  console.error("usage: node scripts/feedback-to-fp-training.mjs <feedback.json> [out.json]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(inPath), "utf8"));
const rows = Array.isArray(raw) ? raw : raw.items ?? raw.feedback ?? raw.examples ?? [];
const examples = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i] ?? {};
  const verdict = String(r.verdict ?? r.label ?? "").toLowerCase();
  let label = null;
  if (verdict === "confirmed" || verdict === "1" || verdict === "true_positive" || verdict === "tp") label = 1;
  if (
    verdict === "false_positive" ||
    verdict === "0" ||
    verdict === "fp" ||
    verdict === "discarded" ||
    verdict === "dismissed"
  ) {
    label = 0;
  }
  if (label === null && (r.label === 0 || r.label === 1)) label = r.label;
  if (label === null) continue;

  const finding = r.finding ?? {
    ruleId: r.ruleId ?? r.rule ?? "?",
    file: r.file ?? r.path ?? "?",
    severity: r.severity ?? "MAJOR",
    isTestFile: /test|spec|__tests__/i.test(String(r.file ?? r.path ?? "")),
    isImported: String(r.ruleId ?? "").startsWith("EXT:") || r.findingSource === "imported",
    isStructural: String(r.ruleId ?? "").includes("-ST-") || r.engine === "structural",
  };

  examples.push({
    id: r.id ?? `fb-${i}`,
    label,
    finding,
    ...(r.features ? { features: r.features } : {}),
  });
}

writeFileSync(resolve(outPath), JSON.stringify(examples, null, 2));
console.log(`wrote ${examples.length} labeled examples → ${outPath}`);
console.log(`next: npm run fp-ranker:train -- ${outPath}`);
