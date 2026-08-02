import { RULES_BY_ID, getCatalogRules, type HeroRule } from "./rules.ts";
import { getSonarWayRules } from "./sonarWayRules.ts";
import type { SarifResult } from "./sarif.ts";

/** sonarKey → catalog rule id (SONAR-js-S2068, …). Built on first catalog touch. */
let _sonarKeyIndex: Map<string, HeroRule> | null = null;

function sonarKeyIndex(): Map<string, HeroRule> {
  if (_sonarKeyIndex) return _sonarKeyIndex;
  _sonarKeyIndex = new Map();
  for (const r of getSonarWayRules()) {
    if (r.sonarKey) _sonarKeyIndex.set(r.sonarKey, r);
  }
  return _sonarKeyIndex;
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

function catalogById(id: string): HeroRule | undefined {
  if (RULES_BY_ID[id]) return RULES_BY_ID[id];
  return getCatalogRules().find((r) => r.id === id);
}

/**
 * Map a SARIF/Sonar rule id onto the CodeHero catalog id when possible.
 * Accepts already-normalized SONAR-* ids, raw Sonar keys (javascript:S2068),
 * or short S-keys with a language hint from the tool driver.
 */
export function resolveCatalogRuleId(ruleId: string, langHint?: string): string {
  const raw = String(ruleId ?? "").trim();
  if (!raw) return raw;
  // BYO / imported findings keep their EXT:<tool>:<id> identity.
  if (raw.startsWith("EXT:")) return raw;
  if (RULES_BY_ID[raw] || catalogById(raw)) return raw;

  const byKey = sonarKeyIndex().get(raw);
  if (byKey) return byKey.id;

  // javascript:S2068 → try SONAR-js-S2068
  const colon = raw.lastIndexOf(":");
  if (colon > 0) {
    const repo = raw.slice(0, colon);
    const short = raw.slice(colon + 1).replace(/[^A-Za-z0-9._-]/g, "_");
    const lang = REPO_LANG_HINT[repo] ?? langHint;
    if (lang) {
      const guess = `SONAR-${lang}-${short}`;
      if (catalogById(guess)) return guess;
    }
    // scan index by short key suffix
    for (const [k, rule] of sonarKeyIndex()) {
      if (k.endsWith(`:${short}`) || k.endsWith(`:${raw.slice(colon + 1)}`)) return rule.id;
    }
  }

  return raw;
}

export function lookupCatalogRule(ruleId: string): HeroRule | undefined {
  return catalogById(resolveCatalogRuleId(ruleId));
}

/**
 * Rewrite SARIF results so ruleId matches the CodeHero Sonar way catalog and
 * fill severity / issueType / effort from the catalog when missing.
 */
export function normalizeSarifResultsToCatalog(results: SarifResult[]): SarifResult[] {
  return results.map((r) => {
    const catalogId = resolveCatalogRuleId(r.ruleId);
    const rule = catalogById(catalogId);
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
