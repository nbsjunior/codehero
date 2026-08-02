import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import type { SarifLog } from "@codehero/contracts";
import { normalizeSarifResultsToCatalog } from "@codehero/contracts/catalog";
import { db, storage, STORAGE_BUCKET_NAME, FIRESTORE_DATABASE_ID, repoRef } from "./lib/firebase.ts";
import { upsertIssuesFromResults } from "./lib/ingestCore.ts";

/**
 * Worker that finishes deferred issue writes after ingest returned the quality
 * gate to CI. Reads SARIF from Storage (already uploaded by ingestAnalysis).
 */
export const processIngestJob = onDocumentCreated(
  {
    document: "ingestJobs/{jobId}",
    database: FIRESTORE_DATABASE_ID,
    memory: "1GiB",
    timeoutSeconds: 540,
    maxInstances: 50,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const job = snap.data();
    if (!job || job.status !== "pending") return;

    const {
      orgId,
      projectId,
      repoId,
      analysisId,
      sarifPath,
      branch,
      source,
      newCodeFingerprints,
    } = job as {
      orgId: string;
      projectId: string;
      repoId: string;
      analysisId: string;
      sarifPath: string;
      branch: string;
      source: string;
      newCodeFingerprints?: string[];
    };

    await snap.ref.set({ status: "running", attempts: FieldValue.increment(1) }, { merge: true });

    try {
      const [buf] = await storage.bucket(STORAGE_BUCKET_NAME).file(sarifPath).download();
      const sarif = JSON.parse(buf.toString("utf8")) as SarifLog;
      const results = normalizeSarifResultsToCatalog(sarif.runs?.[0]?.results ?? []);

      await upsertIssuesFromResults({
        orgId,
        projectId,
        repoId,
        results,
        branch,
        source,
        analysisId,
        newCodeFingerprints,
      });

      await repoRef(orgId, projectId, repoId)
        .collection("analyses")
        .doc(analysisId)
        .set({ issuesPending: false, issuesWrittenAt: FieldValue.serverTimestamp() }, { merge: true });

      await snap.ref.set({ status: "done", finishedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.info("processIngestJob done", { orgId, projectId, repoId, analysisId, count: results.length });
    } catch (err) {
      logger.error("processIngestJob failed", { jobId: snap.id, err: String(err) });
      await snap.ref.set(
        { status: "failed", error: String(err).slice(0, 500), finishedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
  },
);

/** Drop finished ingest jobs older than 7 days (ops hygiene). */
export async function cleanupIngestJobs(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const snap = await db
    .collection("ingestJobs")
    .where("createdAt", "<", cutoff)
    .limit(400)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const d of snap.docs) batch.delete(d.ref);
  await batch.commit();
  return snap.size;
}
