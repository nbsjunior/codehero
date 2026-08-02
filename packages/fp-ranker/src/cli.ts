#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  trainRanker,
  precisionAtK,
  accuracy,
  extractFeatures,
  scoreFinding,
  type LabeledExample,
  type RankerModel,
  type FindingFeatureInput,
} from "./index.ts";
import { DEFAULT_MODEL } from "./defaultModel.ts";

function loadExamples(path: string): LabeledExample[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("training file must be a JSON array");
  return raw.map((row, i) => {
    const r = row as {
      id?: string;
      label: 0 | 1 | "confirmed" | "false_positive";
      features?: LabeledExample["features"];
      finding?: FindingFeatureInput;
    };
    const label: 0 | 1 =
      r.label === 1 || r.label === "confirmed" ? 1 : r.label === 0 || r.label === "false_positive" ? 0 : 0;
    const features = r.features ?? extractFeatures(r.finding ?? { ruleId: "?", file: "?" });
    return { id: r.id ?? `ex-${i}`, features, label };
  });
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "train") {
  const inPath = rest[0];
  const outPath = rest[1] ?? "packages/fp-ranker/models/assertiveness.json";
  if (!inPath) {
    process.stderr.write("usage: hero-fp-ranker train <examples.json> [out.json]\n");
    process.exit(1);
  }
  const examples = loadExamples(resolve(inPath));
  const model = trainRanker(examples, {
    version: `gbm-${new Date().toISOString().slice(0, 10)}`,
    notes: `trained on ${examples.length} feedback labels`,
  });
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify(model, null, 2));
  const pAt10 = precisionAtK(model, examples, Math.min(10, examples.length));
  const acc = accuracy(model, examples);
  process.stdout.write(
    `trained ${model.stumps.length} stumps → ${outPath}\naccuracy=${acc.toFixed(3)} precision@10=${pAt10.toFixed(3)}\n`,
  );
} else if (cmd === "eval") {
  const modelPath = rest[0];
  const examplesPath = rest[1];
  if (!modelPath || !examplesPath) {
    process.stderr.write("usage: hero-fp-ranker eval <model.json> <examples.json>\n");
    process.exit(1);
  }
  const model = JSON.parse(readFileSync(resolve(modelPath), "utf8")) as RankerModel;
  const examples = loadExamples(resolve(examplesPath));
  process.stdout.write(
    JSON.stringify(
      {
        modelVersion: model.version,
        n: examples.length,
        accuracy: accuracy(model, examples),
        precisionAt10: precisionAtK(model, examples, 10),
        precisionAt50: precisionAtK(model, examples, 50),
      },
      null,
      2,
    ) + "\n",
  );
} else if (cmd === "score") {
  const file = rest[0] ?? "?";
  const ruleId = rest[1] ?? "HERO-DEMO";
  const s = scoreFinding(DEFAULT_MODEL, { ruleId, file, severity: "MAJOR" });
  process.stdout.write(JSON.stringify(s, null, 2) + "\n");
} else {
  process.stderr.write("usage: hero-fp-ranker <train|eval|score> …\n");
  process.exit(1);
}
