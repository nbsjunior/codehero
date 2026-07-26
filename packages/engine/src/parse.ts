import { parse } from "@babel/parser";
import type { File } from "@babel/types";
import type { RuleLanguage } from "@codehero/contracts";

const JS_LANGS = new Set<RuleLanguage>(["javascript", "typescript"]);

export function supportsDeepAnalysis(lang: RuleLanguage): boolean {
  return JS_LANGS.has(lang);
}

export function parseSource(source: string, language: RuleLanguage): File | null {
  if (!supportsDeepAnalysis(language)) return null;
  const plugins: Array<"typescript" | "jsx"> = [];
  if (language === "typescript") plugins.push("typescript");
  plugins.push("jsx");
  try {
    return parse(source, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins,
    });
  } catch {
    return null;
  }
}

/** 1-indexed line/column from babel loc. */
export function locOf(node: { loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null }): {
  startLine: number;
  startColumn: number;
  endColumn: number;
} {
  const start = node.loc?.start;
  const end = node.loc?.end;
  return {
    startLine: start?.line ?? 1,
    startColumn: (start?.column ?? 0) + 1,
    endColumn: (end?.column ?? (start?.column ?? 0) + 1) + 1,
  };
}

export function snippetAt(source: string, line: number): string {
  const lines = source.split(/\r?\n/);
  return (lines[line - 1] ?? "").trim();
}
