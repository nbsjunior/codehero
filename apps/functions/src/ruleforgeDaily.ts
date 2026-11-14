import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { evolveAllRules, loadCorpus, type CorpusCase } from "@codehero/ruleforge";
import { db } from "./lib/firebase.ts";
import { enqueueEvolveProposalsFromReport, loadFirestoreCorpusCases } from "./ruleProposals.ts";

import type { RuleforgeDailyReport } from "./genkit/ruleforgeFlow.ts";

async function persistReport(report: RuleforgeDailyReport): Promise<string> {
  const day = report.ranAt.slice(0, 10);
  const ref = db.collection("ruleforgeRuns").doc(day);
  await ref.set(
    {
      ...report,
      updatedAt: FieldValue.serverTimestamp(),
      source: "genkit-ruleforgeDaily",
    },
    { merge: true },
  );
  return ref.path;
}

async function runEvolveOnly(corpus: CorpusCase[]): Promise<RuleforgeDailyReport> {
  const report = await evolveAllRules({ corpus });
  return {
    ranAt: report.ranAt,
    seed: report.seed,
    promotedCount: report.promotedCount,
    rejectedCount: report.rejectedCount,
    rules: report.rules.map((r) => ({
      ruleId: r.outcome.ruleId,
      decision: r.outcome.decision,
      reason: r.outcome.reason,
      baselineF1: r.outcome.baseline.f1,
      bestF1: r.outcome.best.f1,
      mutationIds: r.outcome.mutationIds,
      proposedMutationIds: r.proposedMutationIds,
      promotedPattern: r.promotedPattern,
    })),
  };
}

/**
 * Sem LLM: o batch chamava o Gemini uma vez por regra (~300 chamadas/dia) e
 * custava mais do que entregava. Fica só o evolve determinístico com o pool
 * escrito à mão; promoção continua passando por aprovação humana.
 */
async function runDaily(trigger: "schedule" | "manual"): Promise<
  RuleforgeDailyReport & { proposalsEnqueued: number; newRuleProposals: number }
> {
  const firestoreCorpus = await loadFirestoreCorpusCases();
  const packaged = loadCorpus();
  const corpus = [...packaged, ...firestoreCorpus];

  const report = await runEvolveOnly(corpus);
  const path = await persistReport(report);

  const evolveQueued = await enqueueEvolveProposalsFromReport(report);
  const newRuleProposals = 0;

  logger.info("ruleforgeDaily complete", {
    trigger,
    path,
    promoted: report.promotedCount,
    rejected: report.rejectedCount,
    seed: report.seed,
    evolveQueued,
    newRuleProposals,
    corpusExtra: firestoreCorpus.length,
  });

  return { ...report, proposalsEnqueued: evolveQueued, newRuleProposals };
}

/**
 * Once per day: deterministic evolve scores the hand-authored mutation pool →
 * winners land as pending ruleProposals for human approval.
 * Approval writes platformDressRules + ruleforgeCorpus (all scan channels).
 */
export const ruleforgeDaily = onSchedule(
  {
    schedule: "5 6 * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    await runDaily("schedule");
  },
);

export const listRuleforgeRuns = onCall<{ limit?: number }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (!admin.exists) throw new HttpsError("permission-denied", "platform admin required");

  const limit = Math.min(90, Math.max(1, request.data?.limit ?? 30));
  const snap = await db.collection("ruleforgeRuns").orderBy("ranAt", "desc").limit(limit).get();
  return { runs: snap.docs.map((d) => ({ day: d.id, ...d.data() })) };
});

export const runRuleforgeDaily = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "sign-in required");
    const admin = await db.doc(`platformAdmins/${request.auth.uid}`).get();
    if (!admin.exists) throw new HttpsError("permission-denied", "platform admin required");
    return runDaily("manual");
  },
);
