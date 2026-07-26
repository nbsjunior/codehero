import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import {
  technicalDebtMinutes,
  technicalDebtRatio,
  maintainabilityRating,
  ratingFromWorstSeverity,
  evaluateQualityGate,
  SEVERITIES,
  type Severity,
  type SarifLog,
} from "@codehero/contracts";
import { db, storage, projectRef } from "./lib/firebase.ts";

const IngestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  branch: z.string().default("main"),
  commit: z.string().optional(),
  linesOfCode: z.number().int().positive().default(1),
  newCodeFingerprints: z.array(z.string()).optional(),
  sarif: z.custom<SarifLog>((v) => !!v && typeof v === "object"),
});

/**
 * CI ingestion endpoint. Authenticated by a per-project bearer token stored on
 * the project doc. Parses a SARIF report, upserts issues, computes SQALE debt
 * and the quality gate, and records an analysis snapshot.
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
  const { orgId, projectId, branch, commit, linesOfCode, newCodeFingerprints, sarif } = parsed.data;

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const pRef = projectRef(orgId, projectId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) {
    res.status(404).json({ error: "project_not_found" });
    return;
  }
  if (!token || token !== pSnap.get("ingestToken")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const results = sarif.runs?.[0]?.results ?? [];
  const newSet = new Set(newCodeFingerprints ?? []);
  const analysisId = `${Date.now()}`;
  const now = FieldValue.serverTimestamp();

  // Store the raw SARIF for later download / re-analysis. Non-fatal: a storage
  // hiccup must not lose the analysis metrics that were already computed.
  const sarifPath = `orgs/${orgId}/projects/${projectId}/analyses/${analysisId}.sarif.json`;
  let sarifStored = false;
  try {
    await storage.bucket().file(sarifPath).save(JSON.stringify(sarif), { contentType: "application/json" });
    sarifStored = true;
  } catch (err) {
    logger.warn("failed to persist SARIF artifact", { orgId, projectId, analysisId, err: String(err) });
  }

  // Upsert issues + accumulate metrics.
  const bySeverity: Record<Severity, number> = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  const codeSmellEfforts: number[] = [];
  const presentSeverities: Severity[] = [];
  let newBlockerIssues = 0;

  // A single WriteBatch caps at 500 operations — a large legacy repo (COBOL/
  // Java monoliths routinely exceed this per analysis) would silently throw
  // past that limit. BulkWriter auto-batches/paginates and retries, and is
  // the Admin SDK's recommended path for high-volume writes of this kind.
  const bulkWriter = db.bulkWriter();
  for (const r of results) {
    const fp = r.partialFingerprints?.["heroHash/v1"] ?? `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const loc = r.locations?.[0]?.physicalLocation;
    const isNewCode = newSet.has(fp);

    if (SEVERITIES.includes(sev)) {
      bySeverity[sev] += 1;
      presentSeverities.push(sev);
    }
    if (issueType === "CODE_SMELL") codeSmellEfforts.push(r.properties?.remediationEffortMin ?? 0);
    if (sev === "BLOCKER" && isNewCode) newBlockerIssues += 1;

    const issueRef = pRef.collection("issues").doc(fp);
    bulkWriter.set(
      issueRef,
      {
        fingerprint: fp,
        ruleId: r.ruleId,
        severity: sev,
        issueType,
        message: r.message?.text ?? "",
        file: loc?.artifactLocation?.uri ?? "",
        line: loc?.region?.startLine ?? 0,
        column: loc?.region?.startColumn ?? 0,
        snippet: r.properties?.snippet ?? loc?.region?.snippet?.text ?? "",
        remediationEffortMin: r.properties?.remediationEffortMin ?? 0,
        sddTemplateId: r.properties?.sddTemplateId ?? null,
        status: "open",
        isNewCode,
        branch,
        lastSeen: now,
        lastAnalysisId: analysisId,
        firstSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await bulkWriter.close();

  // SQALE metrics.
  const debtMin = technicalDebtMinutes(codeSmellEfforts);
  const debtRatio = technicalDebtRatio(debtMin, linesOfCode);
  const maintRating = maintainabilityRating(debtRatio);
  const securityRating = ratingFromWorstSeverity(
    presentSeverities.filter((_, i) => (results[i]?.properties?.issueType ?? "") === "VULNERABILITY"),
  );
  const gate = evaluateQualityGate({
    newCodeCoverage: 100, // coverage not yet wired — treated as passing for MVP
    newCodeDuplication: 0,
    newBlockerIssues,
    securityRating,
    maintainabilityRating: maintRating,
  });

  const summary = {
    total: results.length,
    bySeverity,
    debtMinutes: debtMin,
    debtRatio,
    maintainabilityRating: maintRating,
    securityRating,
    qualityGate: gate,
  };

  await pRef.collection("analyses").doc(analysisId).set({
    analysisId,
    branch,
    commit: commit ?? null,
    createdAt: now,
    sarifPath: sarifStored ? sarifPath : null,
    linesOfCode,
    summary,
  });

  await pRef.set(
    {
      lastAnalysisId: analysisId,
      lastAnalyzedAt: now,
      debtMinutes: debtMin,
      maintainabilityRating: maintRating,
      securityRating,
      qualityGateStatus: gate.status,
      openIssues: results.length,
    },
    { merge: true },
  );

  logger.info("analysis ingested", { orgId, projectId, analysisId, gate: gate.status });
  res.status(200).json({ analysisId, summary });
});
