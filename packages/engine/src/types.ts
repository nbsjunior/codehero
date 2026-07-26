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
}

export interface AnalyzeOptions {
  file: string;
  source: string;
  language: RuleLanguage;
  rules: HeroRule[];
  /** Skip AST/taint for non-JS/TS languages. */
  enableDeepAnalysis?: boolean;
}
