import { createHash } from "node:crypto";
import {
  RULES,
  RULES_BY_ID,
  matchPattern,
  buildLexicalMask,
  lexicalProfileFor,
  isAgentInstructionPath,
  isSkillMdPath,
  validateSkillMd,
  type HeroRule,
  type RuleLanguage,
} from "@codehero/contracts";
import { analyzeFileCached, ScanCache, supportsDeepAnalysis, runLineTaintRules } from "@codehero/engine";

export interface Finding {
  rule: HeroRule;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
  fingerprint: string;
  engine?: "pattern" | "ast" | "taint" | "structural";
  taintPath?: string[];
  /** Regras que compartilhavam o mesmo detector nesta posicao (ver dedupe). */
  alsoRuleIds?: string[];
}

const EXT_TO_LANG: Record<string, RuleLanguage> = {
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".java": "java",
  ".go": "go",
  ".cs": "csharp",
  ".vb": "vbnet",
  ".cbl": "cobol",
  ".cob": "cobol",
  ".cpy": "cobol",
  ".sql": "tsql",
  // SQL PL (DB2 z/OS e LUW). Sem estas três entradas o mapa não tinha NENHUMA
  // extensão apontando para `db2sql`, e as 12 regras que declaram essa
  // linguagem eram código morto: existiam no catálogo e não podiam disparar.
  ".db2": "db2sql",
  ".sqlpl": "db2sql",
  ".spl": "db2sql",
  ".md": "markdown",
  ".mdc": "markdown",
};

export function languageForFile(path: string): RuleLanguage | null {
  // Instruções de agente primeiro: AGENTS.md / SKILL.md / .cursor/rules / AIDLC.
  // README e docs genéricos NÃO entram (isAgentInstructionPath filtra).
  if (isAgentInstructionPath(path)) return "markdown";

  const base = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (base === ".cursorrules" || base === "cursorrules") return "markdown";

  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot).toLowerCase();
  // .md genérico (README, docs) fica de fora do scan — só agent paths acima.
  if (ext === ".md") return null;
  return EXT_TO_LANG[ext] ?? null;
}

export { isAgentInstructionPath };

function ruleApplies(rule: HeroRule, lang: RuleLanguage): boolean {
  return rule.languages.includes("any") || rule.languages.includes(lang);
}

function fingerprint(ruleId: string, file: string, snippet: string): string {
  const normalized = snippet.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(`${ruleId}::${file}::${normalized}`).digest("hex").slice(0, 16);
}

let sharedCache: ScanCache | null = null;

export function enableScanCache(dir = ".codehero-cache"): void {
  sharedCache = new ScanCache(dir);
}

export function analyzeSource(file: string, source: string, rules: HeroRule[] = RULES): Finding[] {
  const lang = languageForFile(file);
  if (!lang) return [];
  const active = rules.filter((r) => ruleApplies(r, lang) && r.implementation !== "stub");
  const findings = runRulesAgainstSource(active, file, source, lang);

  // Estrutura de SKILL.md (frontmatter + secções) — barato, sempre no scan do arquivo.
  if (isSkillMdPath(file)) {
    for (const sf of validateSkillMd(source)) {
      const rule =
        RULES_BY_ID[sf.ruleId] ??
        active.find((r) => r.id === sf.ruleId) ??
        rules.find((r) => r.id === sf.ruleId);
      if (!rule) continue;
      const snippet = sf.snippet || sf.message;
      findings.push({
        rule: { ...rule, message: sf.message },
        file,
        startLine: sf.startLine,
        startColumn: 1,
        endColumn: Math.max(2, snippet.length + 1),
        snippet,
        fingerprint: fingerprint(sf.ruleId, file, snippet),
        engine: "structural",
      });
    }
  }

  return findings;
}

export function runRulesAgainstSource(
  rules: HeroRule[],
  file: string,
  source: string,
  language?: RuleLanguage,
): Finding[] {
  const lang = language ?? languageForFile(file) ?? "javascript";

  if (supportsDeepAnalysis(lang)) {
    const { findings } = analyzeFileCached(
      { file, source, language: lang, rules, enableDeepAnalysis: true },
      sharedCache,
    );
    const out: Finding[] = [];
    for (const f of findings) {
      const rule = rules.find((r) => r.id === f.ruleId) ?? RULES.find((r) => r.id === f.ruleId);
      if (!rule) continue;
      out.push({
        rule,
        file: f.file,
        startLine: f.startLine,
        startColumn: f.startColumn,
        endColumn: f.endColumn,
        snippet: f.snippet,
        fingerprint: fingerprint(rule.id, f.file, f.snippet),
        engine: f.engine,
        taintPath: f.taintPath,
        alsoRuleIds: f.alsoRuleIds,
      });
    }
    return out;
  }

  // Máscara léxica UMA vez por arquivo, com o perfil do próprio arquivo.
  //
  // Antes daqui a chamada era `matchPattern(rule.pattern, source)` — sem opções.
  // Isso tinha dois efeitos, ambos ruins: o perfil caía no padrão `clike` para
  // TODA linguagem que não é JS/TS (só elas passam pela rota de análise
  // profunda, que já fazia certo), então `#` do Python, `--` do SQL e o `*` na
  // coluna 7 do COBOL de formato fixo nunca eram reconhecidos como comentário;
  // e a máscara era reconstruída uma vez POR REGRA, varrendo o arquivo inteiro
  // centenas de vezes.
  const mask = buildLexicalMask(source, lexicalProfileFor(file));

  const findings: Finding[] = [];
  for (const rule of rules) {
    for (const m of matchPattern(rule.pattern, source, { mask })) {
      findings.push({
        rule,
        file,
        startLine: m.line,
        startColumn: m.column,
        endColumn: m.endColumn,
        snippet: m.snippet,
        fingerprint: fingerprint(rule.id, file, m.snippet),
        engine: "pattern",
      });
    }
  }

  // L2 sem parser: rastreia variável por linha (Java, Python, C#, Go...).
  // Resgata o padrão concat-em-variável + sink-depois que a regex L0
  // single-line não casa — era o que zerava o recall do OWASP Benchmark.
  const { findings: taintFindings } = runLineTaintRules(file, source, rules, lang);
  for (const f of taintFindings) {
    const rule = rules.find((r) => r.id === f.ruleId) ?? RULES.find((r) => r.id === f.ruleId);
    if (!rule) continue;
    findings.push({
      rule,
      file,
      startLine: f.startLine,
      startColumn: f.startColumn,
      endColumn: f.endColumn,
      snippet: f.snippet,
      fingerprint: fingerprint(rule.id, f.file, f.snippet),
      engine: "taint",
      taintPath: f.taintPath,
      alsoRuleIds: f.alsoRuleIds,
    });
  }
  return findings;
}
