import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RankerModel } from "./index.ts";

/**
 * Seed model — priors honestos até existir corpus de feedback suficiente.
 * Treinar de verdade: `hero-fp-ranker train feedback.json models/assertiveness.json`
 * (trainSize > 0). Mesma entrada → mesma saída.
 */
export const SEED_MODEL: RankerModel = {
  version: "seed-priors-v2",
  algorithm: "gbm-stumps-v1",
  // learningRate 1, NAO 0.2.
  //
  // O `learningRate` e o encolhimento de cada rodada de boosting: um modelo
  // TREINADO tem stumps ajustados contando com ele, e aplica-lo ao pontuar e
  // correto. Estes stumps sao priors escritos a mao, ja na escala final —
  // encolhe-los comprimia tudo 5x e o modelo parava de separar:
  //
  //   CRITICAL em producao   0.641
  //   CRITICAL em dist/      0.579   <- deveria ser quase certamente falso
  //
  // Uma faixa de 0,06 torna qualquer limiar inutil, e e o numero absoluto que
  // vai para o SARIF. Com 1 a mesma comparacao da 0.786 contra 0.500.
  learningRate: 1,
  baseScore: 0.4,
  trainedAt: "2026-08-02T00:00:00.000Z",
  trainSize: 0,
  notes:
    "Prior stumps (not fitted). Low assertiveness for test/dist/generated and high ruleRepoFpRate.",
  stumps: [
    { feature: "isTestFile", threshold: 0.5, left: 0.15, right: -0.9 },
    { feature: "isDistPath", threshold: 0.5, left: 0.1, right: -1.2 },
    { feature: "isGenerated", threshold: 0.5, left: 0.1, right: -0.8 },
    { feature: "ruleRepoFpRate", threshold: 0.4, left: 0.2, right: -0.7 },
    { feature: "severityRank", threshold: 0.6, left: -0.1, right: 0.35 },
    { feature: "isImported", threshold: 0.5, left: 0.05, right: 0.15 },
    { feature: "taintPathLenNorm", threshold: 0.25, left: -0.05, right: 0.25 },
    // toolDepth: CodeQL/Joern (≈1) mais assertivo que oxlint (≈0.4).
    { feature: "toolDepth", threshold: 0.7, left: -0.1, right: 0.2 },
    // Outlier da família AST → mais suspeito; família grande → um pouco mais assertivo.
    { feature: "clusterOutlier", threshold: 0.6, left: 0.05, right: -0.25 },
    { feature: "clusterSizeNorm", threshold: 0.15, left: -0.1, right: 0.12 },
    { feature: "cognitiveNorm", threshold: 0.25, left: -0.15, right: 0.2 },
    { feature: "nestingNorm", threshold: 0.4, left: -0.05, right: 0.15 },
    { feature: "fileChurnNorm", threshold: 0.1, left: -0.2, right: 0.2 },
  ],
};

function tryLoadFitted(): RankerModel | null {
  // Opt-out: keep seed even if a fitted artifact exists (CI/tests).
  if (process.env.HERO_RANKER_SEED === "1") return null;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/ → ../models ; dist/ → ../models
    const candidates = [
      process.env.HERO_RANKER_MODEL,
      join(here, "../models/assertiveness.json"),
      join(here, "../../models/assertiveness.json"),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const raw = JSON.parse(readFileSync(p, "utf8")) as RankerModel;
      if (raw?.algorithm === "gbm-stumps-v1" && Array.isArray(raw.stumps) && (raw.trainSize ?? 0) > 0) {
        return raw;
      }
    }
  } catch {
    // fall through to seed
  }
  return null;
}

/** Runtime model: fitted artifact when trainSize>0, else seed priors. */
export const DEFAULT_MODEL: RankerModel = tryLoadFitted() ?? SEED_MODEL;
