import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebase.ts";
import { ruleforgeDailyFlow, type RuleforgeDailyReport } from "./genkit/ruleforgeFlow.ts";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function ensureGenkitApiKey(): void {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY secret is empty");
  // @genkit-ai/google-genai reads GOOGLE_GENAI_API_KEY / GOOGLE_API_KEY
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

async function runDaily(trigger: "schedule" | "manual"): Promise<RuleforgeDailyReport> {
  ensureGenkitApiKey();
  const context = `Daily CodeHero ruleforge (${trigger}). ${await loadFeedbackContext()}`;
  const report = await ruleforgeDailyFlow({ context });
  const path = await persistReport(report);
  logger.info("ruleforgeDaily complete", {
    path,
    promoted: report.promotedCount,
    rejected: report.rejectedCount,
    seed: report.seed,
  });
  return report;
}

/**
 * Once per day (06:05 America/Sao_Paulo): Genkit proposes mutations →
 * deterministic evolve scores them → results land in ruleforgeRuns/{yyyy-mm-dd}.
 * Promoted patterns are NOT auto-merged into contracts — humans open a PR.
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

/**
 * Lists recent daily reports for the admin UI's "Esteira de Inteligência
 * Agêntica (Genkit)" view. A callable (Admin SDK) rather than a client
 * Firestore query — deliberately, since Firestore refuses LIST queries whose
 * rule needs an exists()/get() lookup unless the collection is declared with
 * the top-level `{path=**}` collection-group pattern (verified empirically
 * elsewhere in this codebase); simplest and most robust is to just not rely
 * on client-side Firestore list rules for admin-only aggregate views.
 */
export const listRuleforgeRuns = onCall<{ limit?: number }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const admin = await db.doc(`platformAdmins/${uid}`).get();
  if (!admin.exists) throw new HttpsError("permission-denied", "platform admin required");

  const limit = Math.min(90, Math.max(1, request.data?.limit ?? 30));
  const snap = await db.collection("ruleforgeRuns").orderBy("ranAt", "desc").limit(limit).get();
  return { runs: snap.docs.map((d) => ({ day: d.id, ...d.data() })) };
});

/** Manual trigger for admins / CI smoke (Firebase Auth required). */
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
