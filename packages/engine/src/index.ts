export type { EngineFinding, AnalyzeOptions } from "./types.ts";
export type { TaintSourceKind, TaintSinkKind, SecurityCategory } from "@codehero/contracts";
export { analyzeFile, analyzeFileCached, rulesForDeepPass } from "./analyze.ts";
export { ScanCache, rulesetHash } from "./cache.ts";
export { parseSource, supportsDeepAnalysis } from "./parse.ts";
export { runAstRules } from "./astRules.ts";
export { runTaintRules } from "./taint.ts";
export { buildCfg } from "./cfg.ts";
export { runForwardWorklist } from "./dataflow.ts";
