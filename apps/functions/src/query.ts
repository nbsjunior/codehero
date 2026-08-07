import { onRequest } from "firebase-functions/v2/https";
import { SddSpecSchema, type Severity } from "@codehero/contracts";
import { repoRef } from "./lib/firebase.ts";
import { buildSpecFromIssue, type IssueData } from "./lib/sddBuilder.ts";
import { verifyIngestToken } from "./lib/ingestToken.ts";
import { httpCors } from "./lib/httpSecurity.ts";

/** Verify the per-repo ingest token from the Authorization header. */
async function authorizeRepo(orgId: string, projectId: string, repoId: string, authHeader: string | undefined) {
  return verifyIngestToken(repoRef(orgId, projectId, repoId), authHeader);
}

/**
 * Token-guarded read API for agents/CI (the MCP server proxies this).
 * GET /listIssues?orgId=..&projectId=..&repoId=..&severity=CRITICAL&newCodeOnly=true&limit=100&cursor=<docId>
 */
export const listIssues = onRequest({ cors: httpCors, maxInstances: 100 }, async (req, res) => {
  const orgId = String(req.query.orgId ?? "");
  const projectId = String(req.query.projectId ?? "");
  const repoId = String(req.query.repoId ?? "");
  const severity = req.query.severity ? (String(req.query.severity) as Severity) : null;
  const newCodeOnly = String(req.query.newCodeOnly ?? "false") === "true";
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Math.min(500, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
  const cursor = req.query.cursor ? String(req.query.cursor) : null;

  if (!orgId || !projectId || !repoId) {
    res.status(400).json({ error: "orgId, projectId and repoId are required" });
    return;
  }
  const auth = await authorizeRepo(orgId, projectId, repoId, req.headers.authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  let q: FirebaseFirestore.Query = repoRef(orgId, projectId, repoId)
    .collection("issues")
    .where("status", "==", "open");
  if (severity) q = q.where("severity", "==", severity);
  if (newCodeOnly) q = q.where("isNewCode", "==", true);
  q = q.orderBy("__name__");

  if (cursor) {
    const cursorSnap = await repoRef(orgId, projectId, repoId).collection("issues").doc(cursor).get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap);
  }

  const snap = await q.limit(limit).get();
  const issues = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1]!.id : null;

  res.status(200).json({ issues, nextCursor, limit });
});

/**
 * Token-guarded SDD spec builder for agents/CI.
 * POST /sddSpec { orgId, projectId, repoId, fingerprint }
 */
export const sddSpec = onRequest({ cors: httpCors }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const { orgId, projectId, repoId, fingerprint } = req.body ?? {};
  if (!orgId || !projectId || !repoId || !fingerprint) {
    res.status(400).json({ error: "orgId, projectId, repoId and fingerprint are required" });
    return;
  }
  const auth = await authorizeRepo(orgId, projectId, repoId, req.headers.authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const issueSnap = await repoRef(orgId, projectId, repoId).collection("issues").doc(String(fingerprint)).get();
  if (!issueSnap.exists) {
    res.status(404).json({ error: "issue_not_found" });
    return;
  }

  const spec = SddSpecSchema.parse(buildSpecFromIssue(issueSnap.data() as IssueData, String(fingerprint)));
  res.status(200).json(spec);
});
