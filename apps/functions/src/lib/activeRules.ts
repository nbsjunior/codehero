import { createHash } from "node:crypto";
import { RULES, matchPattern, isUnsafeRegex, type HeroRule } from "@codehero/contracts";
import { db } from "./firebase.ts";

export interface ActiveRulesPayload {
  version: string;
  generatedAt: string;
  canonicalCount: number;
  overlayCount: number;
  scope: { orgId: string | null; projectId: string | null };
  rules: HeroRule[];
}

/**
 * Canonical package RULES + active platform/project dress overlays.
 * Overlay regexes that fail to compile are skipped (same as preview).
 */
export async function loadActiveRules(orgId?: string, projectId?: string): Promise<ActiveRulesPayload> {
  const overlays = await loadOverlayRules(orgId, projectId);
  const rules = mergeRules(RULES, overlays);
  return {
    version: rulesVersion(rules),
    generatedAt: new Date().toISOString(),
    canonicalCount: RULES.length,
    overlayCount: overlays.length,
    scope: { orgId: orgId ?? null, projectId: projectId ?? null },
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
