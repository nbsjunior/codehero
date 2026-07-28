import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  RULES,
  computeLintCoverage,
  type HeroRule,
  type IssueType,
  type RuleLanguage,
} from "@codehero/contracts";
import { db } from "./lib/firebase.ts";

const GROUP_ORDER: IssueType[] = ["VULNERABILITY", "SECURITY_HOTSPOT", "BUG", "CODE_SMELL"];

const GROUP_LABEL: Record<IssueType, string> = {
  VULNERABILITY: "Segurança (vulnerabilidades)",
  SECURITY_HOTSPOT: "Hotspots de segurança",
  BUG: "Bugs",
  CODE_SMELL: "Code smells / manutenibilidade",
};

export type RuleSource = "core" | "platform" | "project";

export interface MotorRuleRow {
  id: string;
  name: string;
  message: string;
  severity: string;
  type: string;
  category: string | null;
  languages: string[];
  remediationEffortMin: number;
  patternRegex: string | null;
  source: RuleSource;
  sourceLabel: string;
  canDelete: boolean;
  orgId: string | null;
  projectId: string | null;
  orgName: string | null;
  projectName: string | null;
  dressCodeId: string | null;
  active: boolean;
}

export interface MotorRuleGroup {
  id: string;
  label: string;
  count: number;
  rules: MotorRuleRow[];
}

type OverlayRule = HeroRule & { dressCodeId?: string; active?: boolean };

async function isPlatformAdmin(uid: string): Promise<boolean> {
  return (await db.doc(`platformAdmins/${uid}`).get()).exists;
}

async function memberOrgIds(uid: string): Promise<string[]> {
  const snap = await db.collectionGroup("members").where("uid", "==", uid).get();
  const ids = new Set<string>();
  for (const d of snap.docs) {
    const orgId = d.ref.parent.parent?.id;
    if (orgId) ids.add(orgId);
  }
  return [...ids];
}

function toRow(
  r: OverlayRule,
  opts: {
    source: RuleSource;
    canDelete: boolean;
    orgId?: string | null;
    projectId?: string | null;
    orgName?: string | null;
    projectName?: string | null;
  },
): MotorRuleRow {
  const sourceLabel =
    opts.source === "core"
      ? "Core (motor)"
      : opts.source === "platform"
        ? "Plataforma (dress code)"
        : `Projeto${opts.projectName ? `: ${opts.projectName}` : ""}`;

  return {
    id: r.id,
    name: r.name,
    message: r.message,
    severity: r.severity,
    type: r.type,
    category: r.category ?? null,
    languages: r.languages ?? [],
    remediationEffortMin: r.remediationEffortMin ?? 0,
    patternRegex: r.pattern?.regex ?? null,
    source: opts.source,
    sourceLabel,
    canDelete: opts.canDelete,
    orgId: opts.orgId ?? null,
    projectId: opts.projectId ?? null,
    orgName: opts.orgName ?? null,
    projectName: opts.projectName ?? null,
    dressCodeId: r.dressCodeId ?? null,
    active: r.active !== false,
  };
}

function asHeroRule(data: Record<string, unknown>, id: string): OverlayRule | null {
  const pattern = data.pattern as HeroRule["pattern"] | undefined;
  if (!pattern?.regex && !data.id) return null;
  return {
    id: String(data.id ?? id),
    name: String(data.name ?? id),
    message: String(data.message ?? ""),
    severity: (data.severity as HeroRule["severity"]) ?? "MAJOR",
    type: (data.type as HeroRule["type"]) ?? "CODE_SMELL",
    languages: (data.languages as HeroRule["languages"]) ?? ["any"],
    remediationEffortMin: Number(data.remediationEffortMin ?? 10),
    cwe: (data.cwe as string[]) ?? [],
    owasp: (data.owasp as string[]) ?? [],
    sddTemplateId: String(data.sddTemplateId ?? "sdd.smell.remove-debug"),
    category: data.category as HeroRule["category"],
    pattern: pattern ?? { regex: "" },
    dressCodeId: data.dressCodeId ? String(data.dressCodeId) : undefined,
    active: data.active !== false,
  };
}

/**
 * Catalog: core RULES + dress overlays (platform + projects the user can see),
 * grouped by issue type. Core rules are never deletable.
 */
export const listMotorRules = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const admin = await isPlatformAdmin(uid);
  const rows: MotorRuleRow[] = RULES.map((r) => toRow(r, { source: "core", canDelete: false }));

  try {
    const globalSnap = await db.collection("platformDressRules").limit(500).get();
    for (const d of globalSnap.docs) {
      const rule = asHeroRule(d.data() as Record<string, unknown>, d.id);
      if (!rule) continue;
      rows.push(toRow(rule, { source: "platform", canDelete: admin }));
    }
  } catch (err) {
    console.error("listMotorRules platform overlays", err);
  }

  if (admin) {
    const orgsSnap = await db.collection("orgs").get();
    await Promise.all(
      orgsSnap.docs.map(async (orgDoc) => {
        const orgName = (orgDoc.data().name as string | undefined) ?? orgDoc.id;
        const projectsSnap = await orgDoc.ref.collection("projects").get();
        await Promise.all(
          projectsSnap.docs.map(async (p) => {
            const projectName = (p.data().name as string | undefined) ?? p.id;
            const rulesSnap = await p.ref.collection("dressRules").limit(200).get();
            for (const d of rulesSnap.docs) {
              const rule = asHeroRule(d.data() as Record<string, unknown>, d.id);
              if (!rule) continue;
              rows.push(
                toRow(rule, {
                  source: "project",
                  canDelete: true,
                  orgId: orgDoc.id,
                  projectId: p.id,
                  orgName,
                  projectName,
                }),
              );
            }
          }),
        );
      }),
    );
  } else {
    const orgIds = await memberOrgIds(uid);
    await Promise.all(
      orgIds.map(async (orgId) => {
        const orgSnap = await db.doc(`orgs/${orgId}`).get();
        const orgName = (orgSnap.data()?.name as string | undefined) ?? orgId;
        const projectsSnap = await db.collection(`orgs/${orgId}/projects`).get();
        await Promise.all(
          projectsSnap.docs.map(async (p) => {
            const projectName = (p.data().name as string | undefined) ?? p.id;
            const rulesSnap = await p.ref.collection("dressRules").limit(200).get();
            for (const d of rulesSnap.docs) {
              const rule = asHeroRule(d.data() as Record<string, unknown>, d.id);
              if (!rule) continue;
              rows.push(
                toRow(rule, {
                  source: "project",
                  canDelete: true,
                  orgId,
                  projectId: p.id,
                  orgName,
                  projectName,
                }),
              );
            }
          }),
        );
      }),
    );
  }

  const byId = new Map<string, MotorRuleRow>();
  for (const r of rows) {
    const prev = byId.get(r.id);
    if (!prev || (prev.source === "core" && r.source !== "core")) byId.set(r.id, r);
  }
  const unique = [...byId.values()].filter((r) => r.active);

  const groups: MotorRuleGroup[] = [];
  for (const type of GROUP_ORDER) {
    const rules = unique
      .filter((r) => r.type === type)
      .sort((a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id));
    if (rules.length === 0) continue;
    groups.push({
      id: type,
      label: GROUP_LABEL[type],
      count: rules.length,
      rules,
    });
  }
  const known = new Set<string>(GROUP_ORDER);
  const other = unique.filter((r) => !known.has(r.type));
  if (other.length) {
    groups.push({
      id: "OTHER",
      label: "Outras",
      count: other.length,
      rules: other.sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  // Same taxonomy that grounds the daily proposal prompt — surfacing it here
  // lets an admin see WHY the esteira is proposing what it proposes.
  const coverage = computeLintCoverage(
    unique.map((r) => ({
      id: r.id,
      name: r.name,
      message: r.message,
      languages: r.languages as RuleLanguage[],
    })),
  );

  return {
    groups,
    totals: {
      core: unique.filter((r) => r.source === "core").length,
      platform: unique.filter((r) => r.source === "platform").length,
      project: unique.filter((r) => r.source === "project").length,
      all: unique.length,
    },
    lintCoverage: {
      covered: coverage.covered.length,
      total: coverage.covered.length + coverage.uncovered.length,
      gaps: coverage.uncovered
        .filter((t) => t.regexFeasible)
        .map((t) => ({
          id: t.id,
          title: t.title,
          family: t.family,
          languages: t.languages,
        })),
    },
  };
});

/**
 * Delete an admin-created overlay rule. Core package RULES cannot be removed.
 */
export const deleteOverlayRule = onCall<{
  ruleId: string;
  source: "platform" | "project";
  orgId?: string;
  projectId?: string;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const ruleId = String(request.data?.ruleId ?? "").trim();
  const source = request.data?.source;
  if (!ruleId) throw new HttpsError("invalid-argument", "ruleId is required");
  if (source !== "platform" && source !== "project") {
    throw new HttpsError("invalid-argument", "source must be platform or project");
  }

  const admin = await isPlatformAdmin(uid);

  if (source === "platform") {
    if (!admin) throw new HttpsError("permission-denied", "platform admin required");
    const ref = db.doc(`platformDressRules/${ruleId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Regra de plataforma não encontrada.");
    await ref.delete();
    return { deleted: true, ruleId, source };
  }

  const orgId = String(request.data?.orgId ?? "").trim();
  const projectId = String(request.data?.projectId ?? "").trim();
  if (!orgId || !projectId) throw new HttpsError("invalid-argument", "orgId and projectId required");

  if (!admin) {
    const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
    if (!member.exists) throw new HttpsError("permission-denied", "not an org member");
  }

  const ref = db.doc(`orgs/${orgId}/projects/${projectId}/dressRules/${ruleId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Regra do projeto não encontrada.");
  await ref.delete();

  return { deleted: true, ruleId, source, orgId, projectId };
});
