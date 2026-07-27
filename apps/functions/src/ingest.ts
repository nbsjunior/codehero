import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import { type SarifLog } from "@codehero/contracts";
import { storage, STORAGE_BUCKET_NAME, repoRef } from "./lib/firebase.ts";
import { persistAnalysisResults } from "./lib/ingestCore.ts";

const IngestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  repoId: z.string().min(1),
  branch: z.string().default("main"),
  commit: z.string().optional(),
  linesOfCode: z.number().int().positive().default(1),
  newCodeFingerprints: z.array(z.string()).optional(),
  sarif: z.custom<SarifLog>((v) => !!v && typeof v === "object"),
});

/**
 * CI ingestion endpoint. Authenticated by a per-repo bearer token (each repo
 * in a project has its own — a project rolls up one or more repos). Parses a
 * SARIF report and delegates the actual persistence (issues, SQALE debt,
 * quality gate, analysis snapshot, project rollup) to the shared core also
 * used by the weekly auto-scan job, so a repo's numbers mean the same thing
 * regardless of how the scan ran.
 */
export const ingestAnalysis = onRequest({ cors: true, maxInstances: 10 }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const parsed = IngestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    return;
  }
  const { orgId, projectId, repoId, branch, commit, linesOfCode, newCodeFingerprints, sarif } = parsed.data;

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const rRef = repoRef(orgId, projectId, repoId);
  const rSnap = await rRef.get();
  if (!rSnap.exists) {
    res.status(404).json({ error: "repo_not_found" });
    return;
  }
  if (!token || token !== rSnap.get("ingestToken")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const results = sarif.runs?.[0]?.results ?? [];

  const { analysisId, summary } = await persistAnalysisResults({
    orgId,
    projectId,
    repoId,
    results,
    branch,
    commit: commit ?? null,
    linesOfCode,
    newCodeFingerprints,
    sarifPath: null,
    source: "github-action",
  });

  // Store the raw SARIF for later download / re-analysis, keyed by the same
  // analysisId the core just persisted. Non-fatal: a storage hiccup must not
  // lose the analysis metrics that were already computed.
  const sarifPath = `orgs/${orgId}/projects/${projectId}/repos/${repoId}/analyses/${analysisId}.sarif.json`;
  try {
    await storage.bucket(STORAGE_BUCKET_NAME).file(sarifPath).save(JSON.stringify(sarif), {
      contentType: "application/json",
    });
    await repoRef(orgId, projectId, repoId)
      .collection("analyses")
      .doc(analysisId)
      .set({ sarifPath }, { merge: true });
  } catch (err) {
    logger.warn("failed to persist SARIF artifact", { orgId, projectId, repoId, analysisId, err: String(err) });
  }

  logger.info("analysis ingested", { orgId, projectId, repoId, gate: summary.qualityGate.status });
  res.status(200).json({ analysisId, summary });
});
