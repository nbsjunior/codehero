/**
 * Movimento 3 — ranqueador de assertividade (anti-falso-positivo).
 *
 * NÃO é uma rede que "acha bug". É um classificador treinado em
 * (achado → confirmado | descartado) que produz um score determinístico
 * (modelo versionado + features fixas). Gradient boosting de stumps em TS puro
 * — microssegundos, sem JVM/Python no hot path do scan.
 */

export type FeatureName =
  | "ruleRepoFpRate"
  | "isTestFile"
  | "isGenerated"
  | "isDistPath"
  | "cyclomaticNorm"
  | "cognitiveNorm"
  | "nestingNorm"
  | "fileChurnNorm"
  | "taintPathLenNorm"
  | "severityRank"
  | "isImported"
  | "isStructural";

export const FEATURE_NAMES: FeatureName[] = [
  "ruleRepoFpRate",
  "isTestFile",
  "isGenerated",
  "isDistPath",
  "cyclomaticNorm",
  "cognitiveNorm",
  "nestingNorm",
  "fileChurnNorm",
  "taintPathLenNorm",
  "severityRank",
  "isImported",
  "isStructural",
];

export type FeatureVector = Record<FeatureName, number>;

/** Rótulo: 1 = confirmado (assertivo / TP), 0 = falso positivo. */
export interface LabeledExample {
  id: string;
  features: FeatureVector;
  /** 1 = confirmed, 0 = false_positive */
  label: 0 | 1;
  ruleId?: string;
  repoId?: string;
}

export interface DecisionStump {
  feature: FeatureName;
  threshold: number;
  /** Residual contribution when feature < threshold */
  left: number;
  /** Residual contribution when feature >= threshold */
  right: number;
}

export interface RankerModel {
  version: string;
  algorithm: "gbm-stumps-v1";
  learningRate: number;
  baseScore: number;
  stumps: DecisionStump[];
  /** Metadata for reproducibility */
  trainedAt: string;
  trainSize: number;
  notes?: string;
}

export interface RankerScore {
  /** P(confirmed) — alto = mais assertivo / menos provável FP */
  assertiveness: number;
  /** 1 - assertiveness */
  fpLikelihood: number;
  modelVersion: string;
}

export interface FindingFeatureInput {
  ruleId: string;
  file: string;
  severity?: string;
  engine?: string | null;
  findingSource?: "native" | "imported" | null;
  /** Histórico: fração de feedbacks FP para esta regra neste repo (0–1). */
  ruleRepoFpRate?: number;
  cyclomatic?: number;
  cognitive?: number;
  nesting?: number;
  /** Commits tocando o arquivo no período (normalizado depois). */
  fileChurn?: number;
  taintPathLength?: number;
}

const SEV_RANK: Record<string, number> = {
  INFO: 0.1,
  MINOR: 0.3,
  MAJOR: 0.5,
  CRITICAL: 0.8,
  BLOCKER: 1,
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normMetric(v: number | undefined, cap: number): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return clamp01(v / cap);
}

export function extractFeatures(input: FindingFeatureInput): FeatureVector {
  const file = (input.file || "").replace(/\\/g, "/").toLowerCase();
  return {
    ruleRepoFpRate: clamp01(input.ruleRepoFpRate ?? 0),
    isTestFile: /\b(test|tests|__tests__|spec)\b/.test(file) || /\.(test|spec)\./.test(file) ? 1 : 0,
    isGenerated: /\b(generated|gen\/)\b/.test(file) || file.includes(".g.") ? 1 : 0,
    isDistPath: /(^|\/)(dist|build|out|target|node_modules)\//.test(file) ? 1 : 0,
    cyclomaticNorm: normMetric(input.cyclomatic, 30),
    cognitiveNorm: normMetric(input.cognitive, 30),
    nestingNorm: normMetric(input.nesting, 8),
    fileChurnNorm: normMetric(input.fileChurn, 50),
    taintPathLenNorm: normMetric(input.taintPathLength, 12),
    severityRank: SEV_RANK[(input.severity ?? "INFO").toUpperCase()] ?? 0.5,
    isImported: input.findingSource === "imported" ? 1 : 0,
    isStructural: input.engine === "structural" || input.engine === "cpg" ? 1 : 0,
  };
}

function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function stumpValue(s: DecisionStump, f: FeatureVector): number {
  return f[s.feature] < s.threshold ? s.left : s.right;
}

export function scoreFeatures(model: RankerModel, features: FeatureVector): RankerScore {
  let raw = model.baseScore;
  for (const s of model.stumps) raw += model.learningRate * stumpValue(s, features);
  const assertiveness = sigmoid(raw);
  return {
    assertiveness,
    fpLikelihood: 1 - assertiveness,
    modelVersion: model.version,
  };
}

export function scoreFinding(model: RankerModel, input: FindingFeatureInput): RankerScore {
  return scoreFeatures(model, extractFeatures(input));
}

/**
 * Treina boosting de stumps por residual (MSE em probabilidade).
 * Determinístico dado o mesmo dataset e hiperparâmetros.
 */
export function trainRanker(
  examples: LabeledExample[],
  opts?: { rounds?: number; learningRate?: number; version?: string; notes?: string },
): RankerModel {
  const rounds = opts?.rounds ?? 40;
  const learningRate = opts?.learningRate ?? 0.15;
  if (examples.length === 0) {
    return {
      version: opts?.version ?? "empty-0",
      algorithm: "gbm-stumps-v1",
      learningRate,
      baseScore: 0,
      stumps: [],
      trainedAt: new Date().toISOString(),
      trainSize: 0,
      notes: "empty training set",
    };
  }

  const labels = examples.map((e) => e.label as number);
  const mean = labels.reduce((a, b) => a + b, 0) / labels.length;
  // logit of mean as base
  const eps = 1e-6;
  const p = clamp01(mean);
  let preds = examples.map(() => Math.log((p + eps) / (1 - p + eps)));
  const stumps: DecisionStump[] = [];

  for (let r = 0; r < rounds; r++) {
    const residuals = examples.map((e, i) => e.label - sigmoid(preds[i]!));
    let best: DecisionStump | null = null;
    let bestLoss = Infinity;

    for (const feature of FEATURE_NAMES) {
      const values = [...new Set(examples.map((e) => e.features[feature]))].sort((a, b) => a - b);
      const thresholds =
        values.length <= 1
          ? [0.5]
          : values.slice(0, -1).map((v, i) => (v + values[i + 1]!) / 2);

      for (const threshold of thresholds) {
        let leftSum = 0;
        let leftN = 0;
        let rightSum = 0;
        let rightN = 0;
        for (let i = 0; i < examples.length; i++) {
          if (examples[i]!.features[feature] < threshold) {
            leftSum += residuals[i]!;
            leftN++;
          } else {
            rightSum += residuals[i]!;
            rightN++;
          }
        }
        if (leftN === 0 || rightN === 0) continue;
        const left = leftSum / leftN;
        const right = rightSum / rightN;
        let loss = 0;
        for (let i = 0; i < examples.length; i++) {
          const add = examples[i]!.features[feature] < threshold ? left : right;
          const err = residuals[i]! - add;
          loss += err * err;
        }
        if (loss < bestLoss) {
          bestLoss = loss;
          best = { feature, threshold, left, right };
        }
      }
    }

    if (!best) break;
    stumps.push(best);
    for (let i = 0; i < examples.length; i++) {
      preds[i]! += learningRate * stumpValue(best, examples[i]!.features);
    }
  }

  return {
    version: opts?.version ?? `gbm-${new Date().toISOString().slice(0, 10)}`,
    algorithm: "gbm-stumps-v1",
    learningRate,
    baseScore: Math.log((p + eps) / (1 - p + eps)),
    stumps,
    trainedAt: new Date().toISOString(),
    trainSize: examples.length,
    notes: opts?.notes,
  };
}

/** Precision@k: entre os k scores mais baixos (mais FP), quantos eram FP de fato. */
export function precisionAtK(model: RankerModel, examples: LabeledExample[], k: number): number {
  if (examples.length === 0 || k <= 0) return 0;
  const scored = examples
    .map((e) => ({ e, s: scoreFeatures(model, e.features) }))
    .sort((a, b) => b.s.fpLikelihood - a.s.fpLikelihood);
  const top = scored.slice(0, Math.min(k, scored.length));
  const fps = top.filter((x) => x.e.label === 0).length;
  return fps / top.length;
}

export function accuracy(model: RankerModel, examples: LabeledExample[], threshold = 0.5): number {
  if (!examples.length) return 0;
  let ok = 0;
  for (const e of examples) {
    const pred = scoreFeatures(model, e.features).assertiveness >= threshold ? 1 : 0;
    if (pred === e.label) ok++;
  }
  return ok / examples.length;
}

export { DEFAULT_MODEL } from "./defaultModel.ts";
