import type { HeroRule, RuleLanguage } from "@codehero/contracts";

export interface EngineFinding {
  ruleId: string;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
  engine: "pattern" | "ast" | "taint";
  taintPath?: string[];
  /**
   * Regras absorvidas por compartilharem o MESMO detector nesta posição.
   *
   * 493 regras saem de 133 detectores, então várias disparam juntas no mesmo
   * ponto — uma linha do repo chegou a receber 14 apontamentos de 14 regras
   * Sonar com regex idêntica. Fica a mais severa e as demais vêm aqui, para
   * quem precisa do rastro de conformidade não perder nada.
   */
  alsoRuleIds?: string[];
}

export interface AnalyzeOptions {
  file: string;
  source: string;
  language: RuleLanguage;
  rules: HeroRule[];
  /** Skip AST/taint for non-JS/TS languages. */
  enableDeepAnalysis?: boolean;
}
