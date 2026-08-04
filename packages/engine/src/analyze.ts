import type { HeroRule } from "@codehero/contracts";
import { matchPattern, buildLexicalMask, lexicalProfileFor } from "@codehero/contracts";
import { runAstRules } from "./astRules.ts";
import { ScanCache, rulesetHash } from "./cache.ts";
import { parseSource, supportsDeepAnalysis } from "./parse.ts";
import { runTaintRules } from "./taint.ts";
import type { AnalyzeOptions, EngineFinding } from "./types.ts";

function patternFindings(opts: AnalyzeOptions, skipAstBacked: boolean): EngineFinding[] {
  const out: EngineFinding[] = [];
  // UMA varredura léxica por arquivo, reusada nas 493 regras. Calcular por
  // regra seria varrer o mesmo texto 493 vezes.
  const mask = buildLexicalMask(opts.source, lexicalProfileFor(opts.file));
  for (const rule of opts.rules) {
    // Em JS/TS, regras com `ast` são avaliadas no L1 (mais precisas que regex).
    if (skipAstBacked && rule.ast) continue;
    if (rule.ast && !rule.pattern.regex) continue;
    for (const m of matchPattern(rule.pattern, opts.source, { mask })) {
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

  return dedupe(findings, opts.rules);
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

const SEV_ORDEM = ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"];

function dedupe(findings: EngineFinding[], rules: HeroRule[] = []): EngineFinding[] {
  const rank = { taint: 3, ast: 2, pattern: 1 } as const;
  const best = new Map<string, EngineFinding>();
  for (const f of findings) {
    const k = `${f.ruleId}:${f.startLine}`;
    const prev = best.get(k);
    if (!prev || rank[f.engine] > rank[prev.engine]) best.set(k, f);
  }
  return colapsaDetectorIgual([...best.values()], rules);
}

/**
 * Colapsa apontamentos que são a MESMA detecção usando regras diferentes.
 *
 * O catálogo tem 493 regras saindo de 133 detectores: várias compartilham a
 * regex. Quando isso acontece, todas disparam no mesmo ponto e o relatório
 * conta o mesmo problema N vezes. Medido no repo: uma única linha
 * `new RegExp(body, ...)` recebia 14 apontamentos de 14 regras Sonar com regex
 * idêntica. De 454 achados, 270 eram esse tipo de eco.
 *
 * O critério é: mesma posição EXATA (linha e coluna) E mesmo tipo de problema
 * (VULNERABILITY, CODE_SMELL, BUG). Regras de tipos diferentes no mesmo ponto
 * continuam separadas, porque aí são dois problemas de verdade.
 *
 * Nada se perde: os ids absorvidos vão para `alsoRuleIds` e seguem para o
 * SARIF.
 */
function colapsaDetectorIgual(findings: EngineFinding[], rules: HeroRule[]): EngineFinding[] {
  if (rules.length === 0) return findings;
  const porId = new Map(rules.map((r) => [r.id, r]));

  // DUAS passadas, porque os dois ecos têm causas diferentes e uma chave só não
  // pega as duas:
  //
  //  1. mesmo DETECTOR — 493 regras saem de 133 regexes, então várias disparam
  //     juntas. Uma linha `new RegExp(...)` recebia 14 apontamentos idênticos.
  //
  //  2. mesmo TIPO de problema — detectores diferentes para a mesma coisa.
  //     `console.log` é achado por `SONAR-*-S4507` e por
  //     `HERO-SMELL-0489-debug-statement`, com padrões distintos: 71 dos 170
  //     apontamentos do repo eram esse par.
  //
  // Usar só a chave de tipo DESFAZ a passada 1 quando regras com a mesma regex
  // têm tipos diferentes — foi medido, os achados subiram de 170 para 180.
  const passo1 = agrupa(
    findings,
    (f) => {
      const det = porId.get(f.ruleId)?.pattern?.regex;
      return det ? `d:${f.startLine}:${f.startColumn}:${f.engine}:${det}` : null;
    },
    porId,
  );
  return agrupa(
    passo1,
    (f) => {
      const t = porId.get(f.ruleId)?.type;
      return t ? `t:${f.startLine}:${f.startColumn}:${f.engine}:${t}` : null;
    },
    porId,
  );
}

/** Agrupa pela chave e mantém, de cada grupo, o achado mais severo. */
function agrupa(
  findings: EngineFinding[],
  chave: (f: EngineFinding) => string | null,
  porId: Map<string, HeroRule>,
): EngineFinding[] {
  const grupos = new Map<string, EngineFinding[]>();
  for (const f of findings) {
    // Sem chave (L1/L2 sem regex, regra desconhecida) o achado fica sozinho.
    const k = chave(f) ?? `@${f.ruleId}:${f.startLine}:${f.startColumn}`;
    const g = grupos.get(k);
    if (g) g.push(f);
    else grupos.set(k, [f]);
  }

  const out: EngineFinding[] = [];
  for (const g of grupos.values()) {
    if (g.length === 1) {
      out.push(g[0]!);
      continue;
    }
    // Fica a mais severa; empate resolve pelo id, para o resultado ser estável
    // entre execuções (o gate não pode oscilar).
    g.sort((a, b) => {
      const sa = SEV_ORDEM.indexOf(porId.get(a.ruleId)?.severity ?? "INFO");
      const sb = SEV_ORDEM.indexOf(porId.get(b.ruleId)?.severity ?? "INFO");
      return sb - sa || a.ruleId.localeCompare(b.ruleId);
    });
    const [principal, ...resto] = g;
    const absorvidos = [
      ...(principal!.alsoRuleIds ?? []),
      ...resto.flatMap((f) => [f.ruleId, ...(f.alsoRuleIds ?? [])]),
    ];
    out.push({ ...principal!, alsoRuleIds: [...new Set(absorvidos)] });
  }
  return out;
}

export function rulesForDeepPass(rules: HeroRule[]): HeroRule[] {
  return rules.filter((r) => r.ast || r.taint);
}
