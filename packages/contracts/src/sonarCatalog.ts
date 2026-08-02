import { RULES_BY_ID, type HeroRule } from "./rules.ts";
import { SONAR_WAY_RULES } from "./sonarWayRules.ts";
import type { SarifResult } from "./sarif.ts";

/** sonarKey → catalog rule id (SONAR-js-S2068, …). */
const SONAR_KEY_INDEX: Map<string, HeroRule> = new Map();
for (const r of SONAR_WAY_RULES) {
  if (r.sonarKey) SONAR_KEY_INDEX.set(r.sonarKey, r);
}

const REPO_LANG_HINT: Record<string, string> = {
  javascript: "js",
  jssecurity: "js",
  typescript: "ts",
  tssecurity: "ts",
  python: "py",
  pythonsecurity: "py",
  java: "java",
  javasecurity: "java",
  csharpsquid: "cs",
  "roslyn.sonaranalyzer.security.cs": "cs",
  cobol: "cobol",
  tsql: "tsql",
  plsql: "plsql",
  vbnet: "cs",
};

/**
 * Map a SARIF/Sonar rule id onto the CodeHero catalog id when possible.
 * Accepts already-normalized SONAR-* ids, raw Sonar keys (javascript:S2068),
 * or short S-keys with a language hint from the tool driver.
 */
export function resolveCatalogRuleId(ruleId: string, langHint?: string): string {
  const raw = String(ruleId ?? "").trim();
  if (!raw) return raw;
  if (RULES_BY_ID[raw]) return raw;

  const byKey = SONAR_KEY_INDEX.get(raw);
  if (byKey) return byKey.id;

  // javascript:S2068 → try SONAR-js-S2068
  const colon = raw.lastIndexOf(":");
  if (colon > 0) {
    const repo = raw.slice(0, colon);
    const short = raw.slice(colon + 1).replace(/[^A-Za-z0-9._-]/g, "_");
    const lang = REPO_LANG_HINT[repo] ?? langHint;
    if (lang) {
      const guess = `SONAR-${lang}-${short}`;
      if (RULES_BY_ID[guess]) return guess;
    }
    // scan index by short key suffix
    for (const [k, rule] of SONAR_KEY_INDEX) {
      if (k.endsWith(`:${short}`) || k.endsWith(`:${raw.slice(colon + 1)}`)) return rule.id;
    }
  }

  return raw;
}

export function lookupCatalogRule(ruleId: string): HeroRule | undefined {
  return RULES_BY_ID[resolveCatalogRuleId(ruleId)];
}

/**
 * Rewrite SARIF results so ruleId matches the CodeHero Sonar way catalog and
 * fill severity / issueType / effort from the catalog when missing.
 */
export function normalizeSarifResultsToCatalog(results: SarifResult[]): SarifResult[] {
  return results.map((r) => {
    const catalogId = resolveCatalogRuleId(r.ruleId);
    const rule = RULES_BY_ID[catalogId];
    if (!rule) return { ...r, ruleId: catalogId };
    return {
      ...r,
      ruleId: catalogId,
      properties: {
        ...r.properties,
        severity: r.properties?.severity ?? rule.severity,
        issueType: r.properties?.issueType ?? rule.type,
        remediationEffortMin: r.properties?.remediationEffortMin ?? rule.remediationEffortMin,
        sddTemplateId: r.properties?.sddTemplateId ?? rule.sddTemplateId,
        cwe: r.properties?.cwe?.length ? r.properties.cwe : rule.cwe,
      },
    };
  });
}
