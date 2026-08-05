/**
 * Política de gate: regras com histórico local de FP alto não reprovam o build.
 * O achado continua no portal (visibilidade), só deixa de contar no Quality Gate.
 *
 * Critério: feedbackCount ≥ minFeedback E fpRate ≥ minFpRate
 * (fpRate = FP / (FP+TP) no escopo do repositório).
 */
export interface RuleFpStat {
  fp: number;
  tp: number;
  /** fp + tp */
  n: number;
  /** fp / n when n > 0 */
  rate: number;
}

export interface GateSuppressOpts {
  /** Mínimo de rótulos FP+TP antes de confiar na taxa. Default 5. */
  minFeedback?: number;
  /** Fração FP/(FP+TP) a partir da qual a regra é suprimida no gate. Default 0.6. */
  minFpRate?: number;
}

export const DEFAULT_GATE_SUPPRESS: Required<GateSuppressOpts> = {
  minFeedback: 5,
  minFpRate: 0.6,
};

export function ruleFpRate(fp: number, tp: number): RuleFpStat {
  const n = Math.max(0, fp) + Math.max(0, tp);
  return {
    fp: Math.max(0, fp),
    tp: Math.max(0, tp),
    n,
    rate: n > 0 ? Math.max(0, fp) / n : 0,
  };
}

export function shouldSuppressInGate(
  stat: RuleFpStat | null | undefined,
  opts: GateSuppressOpts = {},
): boolean {
  const minFeedback = opts.minFeedback ?? DEFAULT_GATE_SUPPRESS.minFeedback;
  const minFpRate = opts.minFpRate ?? DEFAULT_GATE_SUPPRESS.minFpRate;
  if (!stat || stat.n < minFeedback) return false;
  return stat.rate >= minFpRate;
}

/** Firestore doc id seguro a partir de ruleId (EXT:codeql:…, HERO-…). */
export function ruleFpStatDocId(ruleId: string): string {
  return encodeURIComponent(ruleId).replace(/%/g, "_");
}
