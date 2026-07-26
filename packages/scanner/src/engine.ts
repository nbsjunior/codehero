import { createHash } from "node:crypto";
import { RULES, matchPattern, type HeroRule, type RuleLanguage } from "@codehero/contracts";

export interface Finding {
  rule: HeroRule;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
  fingerprint: string;
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
};

export function languageForFile(path: string): RuleLanguage | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_LANG[path.slice(dot).toLowerCase()] ?? null;
}

function ruleApplies(rule: HeroRule, lang: RuleLanguage): boolean {
  return rule.languages.includes("any") || rule.languages.includes(lang);
}

/** Stable fingerprint: independent of line number so a finding keeps its
 *  identity as surrounding code shifts. */
function fingerprint(ruleId: string, file: string, snippet: string): string {
  const normalized = snippet.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(`${ruleId}::${file}::${normalized}`).digest("hex").slice(0, 16);
}

/** Run the production rule set against a single file's source. */
export function analyzeSource(file: string, source: string): Finding[] {
  const lang = languageForFile(file);
  if (!lang) return [];
  const active = RULES.filter((r) => ruleApplies(r, lang));
  return runRulesAgainstSource(active, file, source);
}

/**
 * Run an arbitrary set of rules against source (used by the production
 * scanner and, unmodified, by hero-ruleforge's corpus evaluator — the two
 * MUST share this exact code path so an evolved rule scores identically to
 * how it will behave once promoted).
 */
export function runRulesAgainstSource(rules: HeroRule[], file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    for (const m of matchPattern(rule.pattern, source)) {
      findings.push({
        rule,
        file,
        startLine: m.line,
        startColumn: m.column,
        endColumn: m.endColumn,
        snippet: m.snippet,
        fingerprint: fingerprint(rule.id, file, m.snippet),
      });
    }
  }
  return findings;
}
