#!/usr/bin/env node
import { RULES_BY_ID, RULES } from "@codehero/contracts";
import { loadCorpus, casesForRule } from "./corpus.ts";
import { evaluateRule } from "./evaluate.ts";
import { evolveRule } from "./evolve.ts";

function printEvalTable(): void {
  const corpus = loadCorpus();
  console.log("Regra".padEnd(38), "casos", "TP", "FP", "FN", "TN", "  P    R    F1");
  console.log("-".repeat(90));
  for (const rule of RULES) {
    const cases = casesForRule(corpus, rule.id);
    if (cases.length === 0) continue;
    const r = evaluateRule(rule.pattern, cases);
    console.log(
      rule.id.padEnd(38),
      String(r.cases).padEnd(5),
      String(r.truePositive).padEnd(2),
      String(r.falsePositive).padEnd(2),
      String(r.falseNegative).padEnd(2),
      String(r.trueNegative).padEnd(2),
      r.precision.toFixed(2),
      r.recall.toFixed(2),
      r.f1.toFixed(2),
    );
    for (const f of r.failures) {
      console.log(`   ⚠ ${f.caseId}: esperado=${f.expected} obtido=${f.actual} :: ${f.code}${f.note ? `  (${f.note})` : ""}`);
    }
  }
}

function printEvolve(ruleId: string): void {
  const rule = RULES_BY_ID[ruleId];
  if (!rule) {
    console.error(`regra desconhecida: ${ruleId}`);
    process.exitCode = 1;
    return;
  }
  const corpus = loadCorpus();
  const cases = casesForRule(corpus, ruleId);
  const outcome = evolveRule(rule, cases);

  console.log(`\n=== hero-ruleforge :: evoluindo ${ruleId} ===`);
  console.log(
    `baseline: P=${outcome.baseline.precision.toFixed(2)} R=${outcome.baseline.recall.toFixed(2)} F1=${outcome.baseline.f1.toFixed(2)} (FP=${outcome.baseline.falsePositive} FN=${outcome.baseline.falseNegative})`,
  );
  for (const g of outcome.generationLog) {
    console.log(`  geração ${g.generation}: melhor F1 até agora = ${g.bestF1.toFixed(3)} (mask=${g.bestMask})`);
  }
  console.log(
    `melhor candidato: P=${outcome.best.precision.toFixed(2)} R=${outcome.best.recall.toFixed(2)} F1=${outcome.best.f1.toFixed(2)} (FP=${outcome.best.falsePositive} FN=${outcome.best.falseNegative})`,
  );
  console.log(`mutações ativas: [${outcome.mutationIds.join(", ") || "nenhuma"}]`);
  console.log(`DECISÃO: ${outcome.decision} — ${outcome.reason}`);
}

const [, , cmd, arg] = process.argv;
if (cmd === "evaluate") printEvalTable();
else if (cmd === "evolve" && arg) printEvolve(arg);
else if (cmd === "evolve-all") {
  for (const rule of RULES) printEvolve(rule.id);
} else {
  console.log("uso: hero-ruleforge evaluate | evolve <ruleId> | evolve-all");
  process.exitCode = 1;
}
