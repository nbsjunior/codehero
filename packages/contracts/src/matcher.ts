import type { HeroRule } from "./rules.ts";

// ---------------------------------------------------------------------------
// Shared deterministic pattern matcher. This is the SINGLE source of truth
// for what "a rule matches a line" means — used by both the production
// scanner (hero-scanner) and the offline rule-evolution engine (hero-ruleforge).
//
// Why this matters: hero-ruleforge scores candidate rules against a golden
// corpus to decide whether to promote them. If ruleforge used different
// matching semantics than the scanner, a rule could look great in evaluation
// and behave differently in production. Sharing this module makes that
// impossible by construction.
// ---------------------------------------------------------------------------

export interface PatternMatch {
  line: number; // 1-indexed
  column: number; // 1-indexed
  endColumn: number;
  snippet: string;
}

/**
 * Compile a rule pattern into a JS RegExp. Rules may use a leading inline flag
 * group like `(?i)` (PCRE-style, portable with a future native engine); we
 * translate it into real JS flags since bare `(?i)` is not valid in JS regex.
 */
export function compilePattern(source: string, flags: string = ""): RegExp {
  let body = source;
  const inline = /^\(\?([a-z]+)\)/.exec(body);
  const collected = new Set(flags.split(""));
  if (inline?.[1]) {
    for (const f of inline[1]) if ("gimsuy".includes(f)) collected.add(f);
    body = body.slice(inline[0].length);
  }
  return new RegExp(body, [...collected].join(""));
}

/** Apply a rule's pattern (regex + optional `unless` guard) to source text. */
export function matchPattern(pattern: HeroRule["pattern"], source: string): PatternMatch[] {
  const re = compilePattern(pattern.regex, pattern.flags ?? "");
  const unless = pattern.unless ? compilePattern(pattern.unless, "") : null;
  const lines = source.split(/\r?\n/);
  const matches: PatternMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = re.exec(line);
    if (!m) continue;
    if (unless && unless.test(line)) continue;
    const col = (m.index ?? 0) + 1;
    matches.push({ line: i + 1, column: col, endColumn: col + m[0].length, snippet: line.trim() });
  }
  return matches;
}
