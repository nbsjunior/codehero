import { createHash } from "node:crypto";
import {
  RULES,
  CORE_RULES,
  CATALOG_RULES,
  matchPattern,
  isUnsafeRegex,
  type HeroRule,
} from "@codehero/contracts";
import { db } from "./firebase.ts";

export interface ActiveRulesPayload {
  version: string;
  generatedAt: string;
  canonicalCount: number;
  overlayCount: number;
  /** Live rules used for scanning (core + Sonar L0 ports). */
  liveCount: number;
  /** Full catalog size including Sonar stubs (informational). */
  catalogHint: string;
  scope: { orgId: string | null; projectId: string | null };
  rules: HeroRule[];
}

export interface CatalogRuleEntry {
  id: string;
  name: string;
  severity: string;
  type: string;
  implementation: "core" | "sonar-port" | "structural" | "stub" | "overlay" | null;
  sonarKey: string | null;
  /** True when this rule is included in IDE/CLI live scans. */
  scannable: boolean;
}

export interface RulesCatalogPayload {
  version: string;
  generatedAt: string;
  scope: { orgId: string | null; projectId: string | null };
  scanRuleCount: number;
  catalogCount: number;
  liveCount: number;
  stubCount: number;
  overlayCount: number;
  rules: CatalogRuleEntry[];
}

/**
 * Canonical package RULES (core + Sonar live ports) + active dress overlays.
 * Overlay regexes that fail to compile are skipped (same as preview).
 */
export async function loadActiveRules(orgId?: string, projectId?: string): Promise<ActiveRulesPayload> {
  const overlays = await loadOverlayRules(orgId, projectId);
  const rules = mergeRules(RULES, overlays);
  return {
    version: rulesVersion(rules),
    generatedAt: new Date().toISOString(),
    canonicalCount: CORE_RULES.length,
    overlayCount: overlays.length,
    liveCount: rules.length,
    catalogHint: "Use GET /getRulesCatalog for the full informational catalog (incl. Sonar stubs).",
    scope: { orgId: orgId ?? null, projectId: projectId ?? null },
    rules,
  };
}

/**
 * Full informational catalog for IDE compliance UI: core + all Sonar way
 * (live + stubs) + dress overlays. Patterns omitted — metadata only.
 */
export async function loadRulesCatalog(orgId?: string, projectId?: string): Promise<RulesCatalogPayload> {
  const overlays = await loadOverlayRules(orgId, projectId);
  const scanRules = mergeRules(RULES, overlays);
  const catalog = mergeRules(CATALOG_RULES, overlays);
  const scannableIds = new Set(scanRules.map((r) => r.id));

  const rules: CatalogRuleEntry[] = catalog.map((r) => {
    const impl =
      r.implementation ??
      (overlays.some((o) => o.id === r.id) ? ("overlay" as const) : ("core" as const));
    return {
      id: r.id,
      name: r.name,
      severity: r.severity,
      type: r.type,
      implementation: impl,
      sonarKey: r.sonarKey ?? null,
      scannable: scannableIds.has(r.id) && impl !== "stub",
    };
  });

  return {
    version: rulesVersion(catalog),
    generatedAt: new Date().toISOString(),
    scope: { orgId: orgId ?? null, projectId: projectId ?? null },
    scanRuleCount: scanRules.length,
    catalogCount: catalog.length,
    liveCount: rules.filter((r) => r.scannable).length,
    stubCount: rules.filter((r) => r.implementation === "stub").length,
    overlayCount: overlays.length,
    rules,
  };
}

export function rulesVersion(rules: HeroRule[]): string {
  const h = createHash("sha256");
  for (const r of rules) {
    h.update(r.id);
    h.update(r.pattern?.regex ?? "");
    h.update(r.pattern?.flags ?? "");
    h.update(r.pattern?.unless ?? "");
    h.update(JSON.stringify(r.ast ?? null));
    h.update(JSON.stringify(r.taint ?? null));
    h.update(r.severity);
    h.update(r.message);
  }
  return h.digest("hex").slice(0, 24);
}

function mergeRules(canonical: HeroRule[], overlays: HeroRule[]): HeroRule[] {
  const byId = new Map<string, HeroRule>();
  for (const r of canonical) byId.set(r.id, r);
  for (const r of overlays) byId.set(r.id, r); // overlays win on id collision
  return [...byId.values()];
}

async function loadOverlayRules(orgId?: string, projectId?: string): Promise<HeroRule[]> {
  const out: HeroRule[] = [];
  try {
    const globalSnap = await db.collection("platformDressRules").where("active", "==", true).limit(200).get();
    for (const d of globalSnap.docs) {
      const rule = normalizeOverlayRule(d.data());
      if (rule) out.push(rule);
    }
    if (orgId && projectId) {
      const projSnap = await db
        .collection(`orgs/${orgId}/projects/${projectId}/dressRules`)
        .where("active", "==", true)
        .limit(200)
        .get();
      for (const d of projSnap.docs) {
        const rule = normalizeOverlayRule(d.data());
        if (rule) out.push(rule);
      }
    }
  } catch (err) {
    console.error("loadOverlayRules failed", err);
  }
  return out;
}

function normalizeOverlayRule(raw: Record<string, unknown>): HeroRule | null {
  const pattern = raw.pattern as HeroRule["pattern"] | undefined;
  if (!pattern?.regex || typeof pattern.regex !== "string") return null;
  // Defense in depth: re-check every load, not just at submitDressCode time,
  // so a rule that predates this check (or was written another way) never
  // runs unsandboxed against scan input.
  if (isUnsafeRegex(pattern.regex) || (pattern.unless && isUnsafeRegex(pattern.unless))) {
    console.warn("skipping overlay rule with unsafe (ReDoS-shaped) regex", raw.id);
    return null;
  }
  try {
    matchPattern(pattern, "smoke");
  } catch {
    console.warn("skipping overlay rule with invalid regex", raw.id);
    return null;
  }
  return raw as unknown as HeroRule;
}
