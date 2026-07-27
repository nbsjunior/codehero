import { onRequest } from "firebase-functions/v2/https";
import { SddSpecSchema, type Severity } from "@codehero/contracts";
import { repoRef } from "./lib/firebase.ts";
import { buildSpecFromIssue, type IssueData } from "./lib/sddBuilder.ts";

/** Verify the per-repo ingest token from the Authorization header. */
async function authorizeRepo(orgId: string, projectId: string, repoId: string, authHeader: string | undefined) {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "");
  const rSnap = await repoRef(orgId, projectId, repoId).get();
  if (!rSnap.exists) return { ok: false as const, status: 404, error: "repo_not_found" };
  if (!token || token !== rSnap.get("ingestToken")) return { ok: false as const, status: 401, error: "unauthorized" };
  return { ok: true as const };
}

/**
 * Token-guarded read API for agents/CI (the MCP server proxies this).
 * GET /listIssues?orgId=..&projectId=..&repoId=..&severity=CRITICAL&newCodeOnly=true
 */
export const listIssues = onRequest({ cors: true }, async (req, res) => {
  const orgId = String(req.query.orgId ?? "");
  const projectId = String(req.query.projectId ?? "");
  const repoId = String(req.query.repoId ?? "");
  const severity = req.query.severity ? (String(req.query.severity) as Severity) : null;
  const newCodeOnly = String(req.query.newCodeOnly ?? "false") === "true";

  if (!orgId || !projectId || !repoId) {
    res.status(400).json({ error: "orgId, projectId and repoId are required" });
    return;
  }
  const auth = await authorizeRepo(orgId, projectId, repoId, req.headers.authorization);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  let q = repoRef(orgId, projectId, repoId).collection("issues").where("status", "==", "open");
  if (severity) q = q.where("severity", "==", severity);
  if (newCodeOnly) q = q.where("isNewCode", "==", true);

  const snap = await q.limit(200).get();
  res.status(200).json({ issues: snap.docs.map((d) => d.data()) });
});

/**
 * Token-guarded SDD spec builder for agents/CI.
 * POST /sddSpec { orgId, projectId, repoId, fingerprint }
 */
export const sddSpec = onRequest({ cors: true }, async (req, res) => {
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
