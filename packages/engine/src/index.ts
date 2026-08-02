export type { EngineFinding, AnalyzeOptions } from "./types.ts";
export type { TaintSourceKind, TaintSinkKind, SecurityCategory } from "@codehero/contracts";
export { analyzeFile, analyzeFileCached, rulesForDeepPass } from "./analyze.ts";
export { ScanCache, rulesetHash } from "./cache.ts";
export { parseSource, supportsDeepAnalysis } from "./parse.ts";
export { runAstRules } from "./astRules.ts";
export { runTaintRules } from "./taint.ts";
export { buildCfg } from "./cfg.ts";
export { runForwardWorklist } from "./dataflow.ts";

// Métricas estruturais (tree-sitter WASM): ciclomática, cognitiva,
// aninhamento, tamanho de função e nº de parâmetros.
export { parseStructural, structuralLanguageFor } from "./structural/parser.ts";
export type { StructuralLanguage, ParsedFile } from "./structural/parser.ts";
export {
  computeFileMetrics,
  structuralFindings,
  DEFAULT_STRUCTURAL_THRESHOLDS,
} from "./structural/metrics.ts";
export type {
  FileMetrics,
  FunctionMetrics,
  StructuralFinding,
  StructuralThresholds,
} from "./structural/metrics.ts";

// Duplicação por hash de forma de subárvore (pega clone com renomeação).
export {
  candidatesFor,
  findDuplicates,
  summarizeDuplication,
} from "./structural/duplication.ts";
export type {
  DuplicateBlock,
  DuplicateCandidate,
  DuplicateGroup,
  DuplicationSummary,
} from "./structural/duplication.ts";

// Regras estruturais: avaliam a ÁRVORE, não o texto. Valem nas 6 linguagens.
export { matchStructural } from "./structural/rules.ts";
export type { StructuralMatch } from "./structural/rules.ts";
