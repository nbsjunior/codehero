import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { isUnsafeRegex, matchPattern, RULES_BY_ID, type HeroRule, type IssueType, type Severity } from "@codehero/contracts";
import { evaluateRule, type CorpusCase } from "@codehero/ruleforge";
import { db } from "./lib/firebase.ts";
import type { RuleforgeDailyReport } from "./genkit/ruleforgeFlow.ts";

export type ProposalKind = "evolve" | "new_rule";
export type ProposalFamily = "security" | "dress" | "smell";
export type ProposalStatus = "pending" | "approved" | "rejected";

export interface CorpusCaseDraft {
  id: string;
  code: string;
  expected: "match" | "no_match";
  note?: string;
}

export interface RuleProposalDoc {
  id: string;
  kind: ProposalKind;
  family: ProposalFamily;
  status: ProposalStatus;
  title: string;
  rationale: string;
  ruleId: string;
  scope?: "global" | "project";
  orgId?: string | null;
  projectId?: string | null;
  /** For evolve: current vs proposed pattern. For new_rule: proposed rule. */
  baselinePattern?: HeroRule["pattern"] | null;
  proposedPattern?: HeroRule["pattern"] | null;
  proposedRule?: Partial<HeroRule> & {
    id: string;
    name: string;
    message: string;
    severity: Severity;
    type: IssueType;
    pattern: HeroRule["pattern"];
  };
  corpusCases?: CorpusCaseDraft[];
  metrics?: {
    // evolve (mutation of an existing rule)
    baselineF1?: number;
    bestF1?: number;
    mutationIds?: string[];
    // new_rule — scored the same way, but against a much smaller sample
    // (the LLM's own 1-2 examples) since there's no golden-corpus history
    // yet for a rule that doesn't exist. ownCases/crossCorpus* exist so the
    // reviewer sees exactly how thin that evidence is, not just a bare F1.
    ownPrecision?: number;
    ownRecall?: number;
    ownF1?: number;
    ownCases?: number;
    /** How many UNRELATED corpus cases (any rule) this pattern also matches — signal of an overly broad regex. */
    crossCorpusMatches?: number;
    crossCorpusSampleSize?: number;
  };
  source: string;
  runDay?: string | null;
  createdAt?: unknown;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
}

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "platform admin required");
}

function familyFromType(type: string, category?: string | null): ProposalFamily {
  if (type === "CODE_SMELL" || category === "code-smell") return "smell";
  if (category === "code-smell") return "dress";
  return "security";
}

function safePattern(p: HeroRule["pattern"] | null | undefined): HeroRule["pattern"] | null {
  if (!p?.regex) return null;
  if (isUnsafeRegex(p.regex) || (p.unless && isUnsafeRegex(p.unless))) return null;
  return p;
}

/**
 * Turn daily evolve PROMOTED rows into pending human-approval proposals.
 * Idempotent per day+ruleId.
 */
export async function enqueueEvolveProposalsFromReport(report: RuleforgeDailyReport): Promise<number> {
  const day = report.ranAt.slice(0, 10);
  let n = 0;

  for (const r of report.rules) {
    if (r.decision !== "PROMOTED" || !r.promotedPattern) continue;
    const pattern = safePattern(r.promotedPattern);
    if (!pattern) continue;

    const id = `evolve-${day}-${r.ruleId}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ref = db.doc(`ruleProposals/${id}`);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.status === "approved") continue;

    const baseline = RULES_BY_ID[r.ruleId]?.pattern ?? null;
    const family = familyFromType(RULES_BY_ID[r.ruleId]?.type ?? "VULNERABILITY", RULES_BY_ID[r.ruleId]?.category);

    await ref.set(
      {
        id,
        kind: "evolve" as const,
        family,
        status: "pending" as const,
        title: `Evoluir ${r.ruleId}`,
        rationale: r.reason || "Melhoria de F1 no corpus golden sem regressões.",
        ruleId: r.ruleId,
        baselinePattern: baseline,
        proposedPattern: pattern,
        proposedRule: null,
        corpusCases: [],
        metrics: {
          baselineF1: r.baselineF1,
          bestF1: r.bestF1,
          mutationIds: r.mutationIds ?? [],
        },
        source: "genkit-ruleforgeDaily",
        runDay: day,
        scope: "global",
        orgId: null,
        projectId: null,
        createdAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    n++;
  }
  return n;
}

/**
 * Scores a brand-new rule candidate the same way an `evolve` mutation is
 * scored — deterministically, via the exact production matcher — instead of
 * trusting the LLM's own self-provided examples on faith. Two numbers:
 * (1) precision/recall/F1 on the LLM's own examples (necessarily a tiny
 * sample — there's no history for a rule that doesn't exist yet, so this is
 * disclosed as `ownCases`, not dressed up as a real corpus score), and
 * (2) a cross-corpus false-positive scan — how many cases belonging to
 * OTHER rules this new pattern also matches. Any hit there is a strong
 * overly-broad-regex signal, since the pattern has no business firing on
 * code written to test a different rule entirely.
 */
function scoreNewRuleProposal(
  pattern: HeroRule["pattern"],
  ownCases: CorpusCaseDraft[],
  existingCorpus: CorpusCase[],
): NonNullable<RuleProposalDoc["metrics"]> {
  const asCorpusCases: CorpusCase[] = ownCases.map((c) => ({
    id: c.id,
    ruleId: "__proposed__",
    code: c.code,
    expected: c.expected,
    note: c.note,
  }));
  const ownEval = asCorpusCases.length > 0 ? evaluateRule(pattern, asCorpusCases) : null;

  let crossCorpusMatches = 0;
  for (const c of existingCorpus) {
    try {
      if (matchPattern(pattern, c.code).length > 0) crossCorpusMatches++;
    } catch {
      /* unmatchable code sample — ignore */
    }
  }

  return {
    ownPrecision: ownEval?.precision,
    ownRecall: ownEval?.recall,
    ownF1: ownEval?.f1,
    ownCases: asCorpusCases.length,
    crossCorpusMatches,
    crossCorpusSampleSize: existingCorpus.length,
  };
}

export async function enqueueNewRuleProposals(
  drafts: Array<{
    family: ProposalFamily;
    title: string;
    rationale: string;
    rule: {
      id: string;
      name: string;
      message: string;
      severity: Severity;
      type: IssueType;
      category?: string;
      languages?: string[];
      pattern: HeroRule["pattern"];
      remediationEffortMin?: number;
    };
    corpusCases?: CorpusCaseDraft[];
    source: string;
    runDay?: string;
    scope?: "global" | "project";
    orgId?: string | null;
    projectId?: string | null;
  }>,
  existingCorpus: CorpusCase[] = [],
): Promise<number> {
  let n = 0;
  for (const d of drafts) {
    const pattern = safePattern(d.rule.pattern);
    if (!pattern) continue;
    const id = `new-${d.rule.id}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ref = db.doc(`ruleProposals/${id}`);
    const existing = await ref.get();
    if (existing.exists && (existing.data()?.status === "approved" || existing.data()?.status === "pending")) {
      continue;
    }
    const metrics = scoreNewRuleProposal(pattern, d.corpusCases ?? [], existingCorpus);
    await ref.set(
      {
        id,
        kind: "new_rule" as const,
        family: d.family,
        status: "pending" as const,
        title: d.title,
        rationale: d.rationale,
        ruleId: d.rule.id,
        baselinePattern: null,
        proposedPattern: pattern,
        proposedRule: {
          ...d.rule,
          pattern,
          remediationEffortMin: d.rule.remediationEffortMin ?? 10,
          cwe: [],
          owasp: [],
          sddTemplateId: d.family === "smell" || d.family === "dress" ? "sdd.smell.remove-debug" : "sdd.secret.externalize",
          languages: d.rule.languages ?? ["any"],
        },
        corpusCases: d.corpusCases ?? [],
        metrics,
        source: d.source,
        runDay: d.runDay ?? null,
        scope: d.scope ?? "global",
        orgId: d.orgId ?? null,
        projectId: d.projectId ?? null,
        createdAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    n++;
  }
  return n;
}

/** Load approved corpus cases from Firestore (extends packaged golden.json). */
export async function loadFirestoreCorpusCases(): Promise<
  Array<{ id: string; ruleId: string; code: string; expected: "match" | "no_match"; note?: string }>
> {
  try {
    const snap = await db.collection("ruleforgeCorpus").where("active", "==", true).limit(2000).get();
    return snap.docs.map((d) => {
      const data = d.data();
      const expected: "match" | "no_match" = data.expected === "no_match" ? "no_match" : "match";
      return {
        id: String(data.id ?? d.id),
        ruleId: String(data.ruleId ?? ""),
        code: String(data.code ?? ""),
        expected,
        note: data.note ? String(data.note) : undefined,
      };
    }).filter((c) => c.ruleId && c.code);
  } catch (err) {
    console.warn("loadFirestoreCorpusCases failed", err);
    return [];
  }
}

async function activateOverlayRule(
  rule: HeroRule,
  meta: Record<string, unknown>,
  scope: { orgId?: string | null; projectId?: string | null } = {},
): Promise<void> {
  const path =
    scope.orgId && scope.projectId
      ? `orgs/${scope.orgId}/projects/${scope.projectId}/dressRules/${rule.id}`
      : `platformDressRules/${rule.id}`;
  await db.doc(path).set(
    {
      ...rule,
      active: true,
      engine: "pattern",
      updatedAt: FieldValue.serverTimestamp(),
      ...meta,
    },
    { merge: true },
  );
}

async function writeCorpusCases(ruleId: string, cases: CorpusCaseDraft[], proposalId: string): Promise<void> {
  if (!cases.length) return;
  const batch = db.batch();
  for (const c of cases) {
    const id = c.id || `${ruleId}-${Math.random().toString(36).slice(2, 8)}`;
    batch.set(
      db.doc(`ruleforgeCorpus/${id}`),
      {
        id,
        ruleId,
        code: c.code,
        expected: c.expected,
        note: c.note ?? null,
        active: true,
        sourceProposalId: proposalId,
        approvedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
}

export const listRuleProposals = onCall<{
  status?: ProposalStatus | "all";
  limit?: number;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const status = (request.data?.status ?? "pending") as ProposalStatus | "all";
  const limit = Math.min(100, Math.max(1, Number(request.data?.limit ?? 50) || 50));

  // Avoid composite index: fetch recent and filter in memory.
  const snap = await db.collection("ruleProposals").orderBy("createdAt", "desc").limit(120).get();
  const all = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: String(data.status ?? "pending") as ProposalStatus,
      kind: data.kind,
      family: data.family,
      title: data.title,
      rationale: data.rationale,
      ruleId: data.ruleId,
      scope: data.scope ?? "global",
      orgId: data.orgId ?? null,
      projectId: data.projectId ?? null,
      baselinePattern: data.baselinePattern ?? null,
      proposedPattern: data.proposedPattern ?? null,
      proposedRule: data.proposedRule ?? null,
      corpusCases: data.corpusCases ?? [],
      metrics: data.metrics ?? {},
      source: data.source,
      runDay: data.runDay ?? null,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      reviewedAt: data.reviewedAt ?? null,
      reviewedBy: data.reviewedBy ?? null,
    };
  });
  const pendingCount = all.filter((i) => i.status === "pending").length;
  let items = status === "all" ? all : all.filter((i) => i.status === status);
  items = items.slice(0, limit);

  return {
    items,
    counts: {
      pending: pendingCount,
      shown: items.length,
    },
  };
});

export const reviewRuleProposal = onCall<{
  proposalId: string;
  decision: "approved" | "rejected";
  note?: string;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requirePlatformAdmin(uid);

  const proposalId = String(request.data?.proposalId ?? "").trim();
  const decision = request.data?.decision;
  if (!proposalId) throw new HttpsError("invalid-argument", "proposalId required");
  if (decision !== "approved" && decision !== "rejected") {
    throw new HttpsError("invalid-argument", "decision must be approved or rejected");
  }

  const ref = db.doc(`ruleProposals/${proposalId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Proposta não encontrada.");
  const data = snap.data() as RuleProposalDoc;
  if (data.status !== "pending") {
    throw new HttpsError("failed-precondition", `Proposta já está ${data.status}.`);
  }

  if (decision === "rejected") {
    await ref.set(
      {
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: uid,
        reviewNote: String(request.data?.note ?? "").trim() || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { proposalId, status: "rejected" as const };
  }

  // Approve → active overlay (all channels via getActiveRules) + corpus cases
  const scopeOrg = data.orgId ?? null;
  const scopeProject = data.projectId ?? null;

  if (data.kind === "evolve") {
    const base = RULES_BY_ID[data.ruleId];
    const pattern = safePattern(data.proposedPattern);
    if (!base || !pattern) throw new HttpsError("failed-precondition", "Padrão inválido para evolução.");
    const rule: HeroRule = { ...base, pattern };
    await activateOverlayRule(
      rule,
      {
        dressCodeId: null,
        approvedProposalId: proposalId,
        proposalKind: "evolve",
      },
      { orgId: null, projectId: null },
    );
    await writeCorpusCases(data.ruleId, data.corpusCases ?? [], proposalId);
  } else {
    const draft = data.proposedRule;
    const pattern = safePattern(draft?.pattern ?? data.proposedPattern);
    if (!draft || !pattern) throw new HttpsError("failed-precondition", "Regra proposta inválida.");
    if (isUnsafeRegex(pattern.regex) || (pattern.unless && isUnsafeRegex(pattern.unless))) {
      throw new HttpsError("failed-precondition", "Regex inseguro na proposta.");
    }
    const rule: HeroRule = {
      id: draft.id,
      name: draft.name,
      message: draft.message,
      severity: draft.severity,
      type: draft.type,
      languages: (draft.languages as HeroRule["languages"]) ?? ["any"],
      remediationEffortMin: draft.remediationEffortMin ?? 10,
      cwe: draft.cwe ?? [],
      owasp: draft.owasp ?? [],
      sddTemplateId: draft.sddTemplateId ?? "sdd.smell.remove-debug",
      category: draft.category,
      pattern,
    };
    await activateOverlayRule(
      rule,
      {
        dressCodeId: null,
        approvedProposalId: proposalId,
        proposalKind: "new_rule",
        family: data.family,
      },
      { orgId: scopeOrg, projectId: scopeProject },
    );
    await writeCorpusCases(rule.id, data.corpusCases ?? [], proposalId);
  }

  await ref.set(
    {
      status: "approved",
      reviewedAt: new Date().toISOString(),
      reviewedBy: uid,
      reviewNote: String(request.data?.note ?? "").trim() || null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { proposalId, status: "approved" as const, ruleId: data.ruleId };
});
