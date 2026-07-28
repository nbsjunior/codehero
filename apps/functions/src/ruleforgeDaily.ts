import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { loadCorpus } from "@codehero/ruleforge";
import { computeLintCoverage, formatLintGapDigest, lintGapWindowSeed } from "@codehero/contracts";
import { db } from "./lib/firebase.ts";
import { loadActiveRules } from "./lib/activeRules.ts";
import { ruleforgeDailyFlow, type RuleforgeDailyReport } from "./genkit/ruleforgeFlow.ts";
import { draftToEnqueue, proposeNewRulesBatch } from "./genkit/newRulesFlow.ts";
import { getCveDigestForPrompt } from "./lib/cveWatchlist.ts";
import { describeRouting } from "./genkit/models.ts";
import {
  enqueueEvolveProposalsFromReport,
  enqueueNewRuleProposals,
  loadFirestoreCorpusCases,
} from "./ruleProposals.ts";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function ensureGenkitApiKey(): void {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY secret is empty");
  process.env.GOOGLE_GENAI_API_KEY = key;
  process.env.GOOGLE_API_KEY = key;
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

async function loadFeedbackContext(): Promise<string> {
  try {
    const snap = await db.collectionGroup("ruleforgeFeedback").limit(40).get();
    if (snap.empty) return "Sem telemetria ruleforgeFeedback recente.";
    const lines = snap.docs.map((d) => {
      const data = d.data();
      return `- ${data.verdict ?? "?"} rule=${data.ruleId ?? "?"} :: ${String(data.snippet ?? data.note ?? "").slice(0, 120)}`;
    });
    return `Telemetria recente (ruleforgeFeedback):\n${lines.join("\n")}`;
  } catch (err) {
    logger.warn("ruleforge feedback context unavailable", err);
    return "Telemetria indisponível neste run.";
  }
}

/**
 * Coverage is computed against the ACTIVE catalog (core + approved overlays),
 * so a topic approved yesterday stops being proposed today.
 */
async function loadLintGapDigest(day: string): Promise<string> {
  try {
    const active = await loadActiveRules();
    const coverage = computeLintCoverage(active.rules);
    logger.info("lint knowledge base coverage", {
      covered: coverage.covered.length,
      uncovered: coverage.uncovered.length,
      activeRules: active.rules.length,
    });
    return formatLintGapDigest(coverage, 18, lintGapWindowSeed(day));
  } catch (err) {
    logger.warn("lint gap digest unavailable", err);
    return "Lacunas de lint/clean-code indisponíveis neste run.";
  }
}

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

async function runDaily(trigger: "schedule" | "manual"): Promise<
  RuleforgeDailyReport & { proposalsEnqueued: number; newRuleProposals: number }
> {
  ensureGenkitApiKey();
  const feedback = await loadFeedbackContext();
  const firestoreCorpus = await loadFirestoreCorpusCases();
  const packaged = loadCorpus();
  const corpus = [...packaged, ...firestoreCorpus];

  const context = `Daily CodeHero ruleforge (${trigger}). ${feedback}`;
  const report = await ruleforgeDailyFlow({ context, corpus });
  const path = await persistReport(report);

  const evolveQueued = await enqueueEvolveProposalsFromReport(report);

  let newRuleProposals = 0;
  try {
    const day = report.ranAt.slice(0, 10);
    const cveDigest = await getCveDigestForPrompt();
    const lintGapDigest = await loadLintGapDigest(day);
    const batch = await proposeNewRulesBatch(`${context}\n\n${cveDigest}\n\n${lintGapDigest}`);
    newRuleProposals = await enqueueNewRuleProposals(
      batch.drafts.map((d) => draftToEnqueue(d, day)),
      corpus,
    );
  } catch (err) {
    logger.warn("new rules proposal batch failed", err);
  }

  logger.info("model routing", {
    routes: describeRouting().map(
      (r) => `${r.role}=${r.resolved.provider}:${r.resolved.model}${r.isFallback ? " (fallback)" : ""}`,
    ),
  });

  logger.info("ruleforgeDaily complete", {
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
 * Once per day: Genkit proposes mutations + new rules → deterministic evolve
 * scores evolves → BOTH land as pending ruleProposals for human approval.
 * Approval writes platformDressRules + ruleforgeCorpus (all scan channels).
 */
export const ruleforgeDaily = onSchedule(
  {
    schedule: "5 6 * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
    secrets: [GEMINI_API_KEY],
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
    secrets: [GEMINI_API_KEY],
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
