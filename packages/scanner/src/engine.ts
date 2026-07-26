import { createHash } from "node:crypto";
import { RULES, type HeroRule, type RuleLanguage } from "@codehero/contracts";

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

/** Run the rule set against a single file's source. */
export function analyzeSource(file: string, source: string): Finding[] {
  const lang = languageForFile(file);
  if (!lang) return [];
  const active = RULES.filter((r) => ruleApplies(r, lang));
  const lines = source.split(/\r?\n/);
  const findings: Finding[] = [];

  for (const rule of active) {
    const re = compilePattern(rule.pattern.regex, rule.pattern.flags ?? "");
    const unless = rule.pattern.unless ? compilePattern(rule.pattern.unless, "") : null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = re.exec(line);
      if (!m) continue;
      if (unless && unless.test(line)) continue;
      const col = (m.index ?? 0) + 1;
      const snippet = line.trim();
      findings.push({
        rule,
        file,
        startLine: i + 1,
        startColumn: col,
        endColumn: col + m[0].length,
        snippet,
        fingerprint: fingerprint(rule.id, file, snippet),
      });
    }
  }
  return findings;
}

/**
 * Compile a rule pattern into a JS RegExp. Rules may use a leading inline flag
 * group like `(?i)` (PCRE-style) for portability with the future engine; we
 * translate it into real JS flags since bare `(?i)` is not valid in JS.
 */
function compilePattern(source: string, flags: string): RegExp {
  let body = source;
  const inline = /^\(\?([a-z]+)\)/.exec(body);
  const collected = new Set(flags.split(""));
  if (inline?.[1]) {
    for (const f of inline[1]) if ("gimsuy".includes(f)) collected.add(f);
    body = body.slice(inline[0].length);
  }
  return new RegExp(body, [...collected].join(""));
}
