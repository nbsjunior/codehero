import { onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import { type SarifLog } from "@codehero/contracts";
import { storage, STORAGE_BUCKET_NAME, repoRef } from "./lib/firebase.ts";
import {
  persistAnalysisResults,
  enqueueIssueUpsertJob,
  upsertIssuesFromResults,
  coverageFromSarif,
  duplicationFromSarif,
} from "./lib/ingestCore.ts";
import { ingestIdempotencyKey, findRecentIngest } from "./lib/ingestIdempotency.ts";
import { assertBuildQuota, incrementBuildQuota } from "./lib/quotas.ts";
import { getPlatformOpsConfig } from "./lib/platformOps.ts";
import { verifyIngestToken } from "./lib/ingestToken.ts";
import { httpCors } from "./lib/httpSecurity.ts";
import { consumeRateLimit } from "./lib/authz.ts";
import { observe } from "./lib/observability.ts";

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
 * CI ingestion endpoint. Authenticated by a per-repo bearer token.
 *
 * Scale path:
 * 1. Quota + idempotency (24h) so retries do not duplicate work
 * 2. Persist SARIF to Storage first
 * 3. Write analysis summary + gate sync (Action needs exit code)
 * 4. Enqueue issue upserts via ingestJobs (Firestore trigger worker)
 */
export const ingestAnalysis = onRequest(
  { cors: httpCors, maxInstances: 200, memory: "1GiB", timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    const parsed = IngestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      return;
    }
    const { orgId, projectId, repoId, branch, commit, linesOfCode, newCodeFingerprints, sarif } =
      parsed.data;

    const rRef = repoRef(orgId, projectId, repoId);
    const auth = await verifyIngestToken(rRef, req.headers.authorization);
    if (!auth.ok) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      await consumeRateLimit(`ingest:${orgId}:${repoId}`, 120);
    } catch (err) {
      if (err instanceof HttpsError && err.code === "resource-exhausted") {
        res.status(429).json({ error: "rate_limited", message: err.message });
        return;
      }
      throw err;
    }

    try {
      await assertBuildQuota(orgId);
    } catch (err) {
      if (err instanceof HttpsError && err.code === "resource-exhausted") {
        observe("ingest.quota_exceeded", { orgId, projectId, repoId });
        res.status(429).json({ error: "quota_exceeded", message: err.message });
        return;
      }
      throw err;
    }

    // NOTA: a normalizacao de rule-id para o catalogo Sonar way vive numa
    // alteracao ainda nao versionada (sonarCatalog.ts). Volta junto com ela.
    const results = sarif.runs?.[0]?.results ?? [];
    // Keep tool-reported rule ids in stored SARIF; persistence uses normalized `results`.
    const idempotencyKey = ingestIdempotencyKey({
      orgId,
      projectId,
      repoId,
      commit: commit ?? null,
      branch,
      results,
    });

    const recent = await findRecentIngest(orgId, projectId, repoId, idempotencyKey);
    if (recent) {
      observe("ingest.deduplicated", {
        orgId,
        projectId,
        repoId,
        analysisId: recent.analysisId,
      });
      res.status(200).json({
        analysisId: recent.analysisId,
        summary: recent.summary,
        deduplicated: true,
      });
      return;
    }

    const analysisId = `${Date.now()}`;
    const sarifPath = `orgs/${orgId}/projects/${projectId}/repos/${repoId}/analyses/${analysisId}.sarif.json`;

    try {
      await storage.bucket(STORAGE_BUCKET_NAME).file(sarifPath).save(JSON.stringify(sarif), {
        contentType: "application/json",
      });
    } catch (err) {
      logger.error("failed to persist SARIF before metrics", {
        orgId,
        projectId,
        repoId,
        analysisId,
        err: String(err),
      });
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }

    const ops = await getPlatformOpsConfig();
    const deferIssues = ops.deferIssueWrites;

    const { summary } = await persistAnalysisResults({
      orgId,
      projectId,
      repoId,
      results,
      branch,
      commit: commit ?? null,
      linesOfCode,
      newCodeFingerprints,
      coveragePercent: coverageFromSarif(sarif),
      duplicationPercent: duplicationFromSarif(sarif),
      sarifPath,
      source: "github-action",
      idempotencyKey,
      analysisId,
      deferIssueWrites: deferIssues,
    });

    if (deferIssues) {
      try {
        await enqueueIssueUpsertJob({
          orgId,
          projectId,
          repoId,
          analysisId,
          sarifPath,
          branch,
          source: "github-action",
          newCodeFingerprints,
        });
        observe("ingest.job_enqueued", { orgId, projectId, repoId, analysisId });
      } catch (err) {
        logger.error("failed to enqueue ingest job — falling back to sync upsert", {
          analysisId,
          err: String(err),
        });
        await upsertIssuesFromResults({
          orgId,
          projectId,
          repoId,
          results,
          branch,
          source: "github-action",
          analysisId,
          newCodeFingerprints,
        });
      }
    }

    try {
      await incrementBuildQuota(orgId);
    } catch (err) {
      logger.warn("quota increment failed", { orgId, err: String(err) });
    }

    observe("ingest.accepted", {
      orgId,
      projectId,
      repoId,
      analysisId,
      findings: results.length,
      gate: summary.qualityGate.status,
      deferredIssues: deferIssues,
    });
    res.status(200).json({ analysisId, summary, deferredIssues: deferIssues });
  },
);
