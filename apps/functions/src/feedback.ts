import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, repoRef } from "./lib/firebase.ts";

type Verdict = "false_positive" | "confirmed" | "fix_accepted" | "fix_rejected";

interface FlagFeedbackInput {
  orgId: string;
  projectId: string;
  repoId: string;
  fingerprint: string;
  verdict: Verdict;
  note?: string;
}

/**
 * Captures real-world signal on an issue: a developer flagging a false
 * positive, confirming a true positive, or an agent reporting whether an SDD
 * fix was accepted/rejected (the MCP `submit_fix_result` tool calls this).
 *
 * This is the ONLY way the rule catalog "keeps learning" from production
 * usage. It does not touch the rule itself — it writes a labeled example to
 * `ruleforgeFeedback`, which a human-reviewed batch job periodically merges
 * into packages/ruleforge/corpus/golden.json. From there, the exact same
 * deterministic evolve.ts search (see that file) decides whether a rule
 * change is warranted. No LLM call happens on this path; this endpoint is
 * cheap Firestore I/O regardless of how much telemetry flows through it.
 */
export const flagIssueFeedback = onCall<FlagFeedbackInput>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const { orgId, projectId, repoId, fingerprint, verdict, note } = request.data ?? ({} as FlagFeedbackInput);
  if (!orgId || !projectId || !repoId || !fingerprint || !verdict) {
    throw new HttpsError("invalid-argument", "orgId, projectId, repoId, fingerprint and verdict are required");
  }

  const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!member.exists) throw new HttpsError("permission-denied", "not a member of this org");

  const issueRef = repoRef(orgId, projectId, repoId).collection("issues").doc(fingerprint);
  const issueSnap = await issueRef.get();
  if (!issueSnap.exists) throw new HttpsError("not-found", "issue not found");
  const issue = issueSnap.data()!;

  const batch = db.batch();
  batch.update(issueRef, {
    feedback: FieldValue.arrayUnion({ verdict, note: note ?? null, uid, at: new Date().toISOString() }),
    status: verdict === "false_positive" ? "false_positive" : issue.status,
  });

  // Only false-positive/true-positive verdicts produce a labeled corpus
  // candidate (fix_accepted/fix_rejected feed the SDD template quality
  // instead — see docs/ARCHITECTURE.md).
  if (verdict === "false_positive" || verdict === "confirmed") {
    const feedbackRef = db.collection("orgs").doc(orgId).collection("ruleforgeFeedback").doc();
    batch.set(feedbackRef, {
      ruleId: issue.ruleId,
      code: issue.snippet,
      expectedLabel: verdict === "false_positive" ? "no_match" : "match",
      fingerprint,
      projectId,
      repoId,
      file: issue.file ?? null,
      severity: issue.severity ?? null,
      engine: issue.engine ?? null,
      findingSource: issue.findingSource ?? null,
      cyclomatic: issue.cyclomatic ?? null,
      cognitive: issue.cognitive ?? null,
      nesting: issue.nesting ?? null,
      reportedBy: uid,
      note: note ?? null,
      createdAt: FieldValue.serverTimestamp(),
      mergedIntoCorpus: false,
    });
  }

  await batch.commit();

  // Stats locais por regra (gate suppress + feature ruleRepoFpRate).
  if (verdict === "false_positive" || verdict === "confirmed") {
    const { bumpRuleFpStat } = await import("./lib/ruleFpStats.ts");
    await bumpRuleFpStat({
      orgId,
      projectId,
      repoId,
      ruleId: String(issue.ruleId ?? ""),
      verdict,
    });
  }

  return { ok: true };
});

/**
 * Token-guarded HTTP counterpart for agents (no Firebase Auth user session).
 * This is what hero-mcp's `submit_fix_result` tool calls after applying an
 * SDD-generated patch and re-running the scanner, reporting whether the fix
 * resolved the issue (AC1) without introducing new BLOCKER/CRITICAL findings
 * (AC2). This is telemetry about the FIX (feeds SDD template success-rate
 * metrics), not a verdict on the original detection — "rejected" can mean the
 * patch was wrong even though the issue was real, so unlike
 * `flagIssueFeedback` this does NOT write a ruleforgeFeedback/corpus label.
 * A human explicitly flagging false_positive/confirmed is the only
 * unambiguous corpus signal.
 */
export const submitFixResult = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const { orgId, projectId, repoId, fingerprint, specId, status } = req.body ?? {};
  if (!orgId || !projectId || !repoId || !fingerprint || !status) {
    res.status(400).json({ error: "orgId, projectId, repoId, fingerprint and status are required" });
    return;
  }

  const rRef = repoRef(orgId, projectId, repoId);
  const rSnap = await rRef.get();
  if (!rSnap.exists) {
    res.status(404).json({ error: "repo_not_found" });
    return;
  }
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token !== rSnap.get("ingestToken")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const issueRef = rRef.collection("issues").doc(String(fingerprint));
  const issueSnap = await issueRef.get();
  if (!issueSnap.exists) {
    res.status(404).json({ error: "issue_not_found" });
    return;
  }
  const issue = issueSnap.data()!;

  await issueRef.update({
    status: status === "applied" ? "resolved_pending_verification" : issue.status,
    fixHistory: FieldValue.arrayUnion({ specId: specId ?? null, status, at: new Date().toISOString() }),
  });

  // Feeds SDD template success-rate (per sddTemplateId), used to recalibrate
  // remediationEffortMin and to flag templates that consistently fail — see
  // docs/ARCHITECTURE.md "feedback loop". Independent of the corpus/rule loop.
  await db
    .collection("orgs")
    .doc(orgId)
    .collection("sddOutcomes")
    .add({
      specId: specId ?? null,
      sddTemplateId: issue.sddTemplateId ?? null,
      ruleId: issue.ruleId,
      status,
      projectId,
      repoId,
      createdAt: FieldValue.serverTimestamp(),
    });

  res.status(200).json({ ok: true });
});
