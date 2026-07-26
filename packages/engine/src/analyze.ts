import type { HeroRule } from "@codehero/contracts";
import { matchPattern } from "@codehero/contracts";
import { runAstRules } from "./astRules.ts";
import { ScanCache, rulesetHash } from "./cache.ts";
import { parseSource, supportsDeepAnalysis } from "./parse.ts";
import { runTaintRules } from "./taint.ts";
import type { AnalyzeOptions, EngineFinding } from "./types.ts";

function patternFindings(opts: AnalyzeOptions, skipAstBacked: boolean): EngineFinding[] {
  const out: EngineFinding[] = [];
  for (const rule of opts.rules) {
    // Em JS/TS, regras com `ast` são avaliadas no L1 (mais precisas que regex).
    if (skipAstBacked && rule.ast) continue;
    if (rule.ast && !rule.pattern.regex) continue;
    for (const m of matchPattern(rule.pattern, opts.source)) {
      out.push({
        ruleId: rule.id,
        file: opts.file,
        startLine: m.line,
        startColumn: m.column,
        endColumn: m.endColumn,
        snippet: m.snippet,
        engine: "pattern",
      });
    }
  }
  return out;
}

/**
 * Full analysis: L0 pattern + L1 AST + L2 taint (JS/TS).
 * Dedupes by ruleId+line preferring taint > ast > pattern.
 */
export function analyzeFile(opts: AnalyzeOptions): EngineFinding[] {
  const enableDeep = opts.enableDeepAnalysis !== false && supportsDeepAnalysis(opts.language);
  const findings = patternFindings(opts, enableDeep);

  if (enableDeep) {
    const ast = parseSource(opts.source, opts.language);
    if (ast) {
      findings.push(...runAstRules(ast, opts.file, opts.source, opts.rules));
      findings.push(...runTaintRules(ast, opts.file, opts.source, opts.rules));
    }
  }

  return dedupe(findings);
}

export function analyzeFileCached(
  opts: AnalyzeOptions,
  cache: ScanCache | null,
): { findings: EngineFinding[]; cacheHit: boolean } {
  const rHash = rulesetHash(opts.rules);
  if (cache) {
    const hit = cache.get(opts.file, opts.source, rHash);
    if (hit) return { findings: hit, cacheHit: true };
  }
  const findings = analyzeFile(opts);
  cache?.set(opts.file, opts.source, rHash, findings);
  return { findings, cacheHit: false };
}

function dedupe(findings: EngineFinding[]): EngineFinding[] {
  const rank = { taint: 3, ast: 2, pattern: 1 } as const;
  const best = new Map<string, EngineFinding>();
  for (const f of findings) {
    const k = `${f.ruleId}:${f.startLine}`;
    const prev = best.get(k);
    if (!prev || rank[f.engine] > rank[prev.engine]) best.set(k, f);
  }
  return [...best.values()];
}

export function rulesForDeepPass(rules: HeroRule[]): HeroRule[] {
  return rules.filter((r) => r.ast || r.taint);
}
