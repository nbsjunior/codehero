import type { RankerModel } from "./index.ts";

/**
 * Seed model — priors honestos até existir corpus de feedback suficiente.
 * Treinar de verdade: `hero-fp-ranker train feedback.json models/assertiveness.json`
 * e versionar o artefato. Mesma entrada → mesma saída.
 */
export const DEFAULT_MODEL: RankerModel = {
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
    // Complexidade e churn: sem estes três stumps os atributos existem, são
    // calculados pelo scanner e NÃO movem nada — o modelo dava só 2 valores
    // distintos em 196 achados. Peso baixo de propósito: são priors, e o sinal
    // forte tem de vir do treino com feedback real.
    //
    // Direção: código complexo e código que muda muito concentram defeito de
    // verdade; achado em função trivial e arquivo parado é mais suspeito.
    { feature: "cognitiveNorm", threshold: 0.25, left: -0.15, right: 0.2 },
    { feature: "nestingNorm", threshold: 0.4, left: -0.05, right: 0.15 },
    { feature: "fileChurnNorm", threshold: 0.1, left: -0.2, right: 0.2 },
  ],
};
