import { createHash } from "node:crypto";
import { RULES, matchPattern, type HeroRule, type RuleLanguage } from "@codehero/contracts";
import { analyzeFileCached, ScanCache, supportsDeepAnalysis } from "@codehero/engine";

export interface Finding {
  rule: HeroRule;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
  fingerprint: string;
  engine?: "pattern" | "ast" | "taint";
  taintPath?: string[];
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
};

export function languageForFile(path: string): RuleLanguage | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_LANG[path.slice(dot).toLowerCase()] ?? null;
}

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
  return runRulesAgainstSource(active, file, source, lang);
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
      });
    }
    return out;
  }

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
        engine: "pattern",
      });
    }
  }
  return findings;
}
