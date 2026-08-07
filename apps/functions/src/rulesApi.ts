import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { projectRef, db } from "./lib/firebase.ts";
import { loadActiveRules, loadRulesCatalog } from "./lib/activeRules.ts";
import { hashIngestToken } from "./lib/ingestToken.ts";
import { httpCors } from "./lib/httpSecurity.ts";

/**
 * GET /getActiveRules?orgId=&projectId=
 *
 * Returns LIVE scan rules only (core + Sonar L0 ports + overlays).
 * Requires Bearer (ingest token or Firebase ID token) — patterns are not public.
 * For the full informational catalog (incl. Sonar stubs), use GET /getRulesCatalog.
 */
export const getActiveRules = onRequest({ cors: httpCors }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const orgId = String(req.query.orgId ?? "").trim() || undefined;
  const projectId = String(req.query.projectId ?? "").trim() || undefined;
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  let includeOverlays = false;
  if (orgId && projectId) {
    const allowed = await authorizeRulesAccess(orgId, projectId, authHeader);
    if (!allowed.ok) {
      res.status(allowed.status).json({ error: allowed.error });
      return;
    }
    includeOverlays = true;
  } else if (orgId || projectId) {
    res.status(400).json({ error: "orgId and projectId are required together" });
    return;
  } else {
    // Global live rules still require a valid Firebase ID token (portal identity).
    try {
      await getAuth().verifyIdToken(authHeader.replace(/^Bearer\s+/i, "").trim());
    } catch {
      // CI may send ingest token without org in query — reject unless ID token.
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const payload = await loadActiveRules(
    includeOverlays ? orgId : undefined,
    includeOverlays ? projectId : undefined,
  );
  const etag = `"${payload.version}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=60");

  const inm = req.headers["if-none-match"];
  if (inm && inm.replace(/W\//, "") === etag) {
    res.status(304).end();
    return;
  }

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  res.status(200).json(payload);
});

/**
 * GET /getRulesCatalog?orgId=&projectId=
 *
 * Full informational catalog (core + Sonar way live + stubs + overlays).
 * Metadata only — no regex patterns. Same auth model as getActiveRules.
 */
export const getRulesCatalog = onRequest({ cors: true, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const orgId = String(req.query.orgId ?? "").trim() || undefined;
  const projectId = String(req.query.projectId ?? "").trim() || undefined;
  const authHeader = req.headers.authorization;

  let includeOverlays = false;
  if (orgId && projectId && authHeader) {
    const allowed = await authorizeRulesAccess(orgId, projectId, authHeader);
    if (!allowed.ok) {
      res.status(allowed.status).json({ error: allowed.error });
      return;
    }
    includeOverlays = true;
  } else if (authHeader && (orgId || projectId)) {
    res.status(400).json({ error: "orgId and projectId are required together" });
    return;
  }

  const payload = await loadRulesCatalog(
    includeOverlays ? orgId : undefined,
    includeOverlays ? projectId : undefined,
  );
  const etag = `"cat-${payload.version}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=120");

  const inm = req.headers["if-none-match"];
  if (inm && inm.replace(/W\//, "") === etag) {
    res.status(304).end();
    return;
  }

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  res.status(200).json(payload);
});

/**
 * Callable for signed-in portal users (Firebase Auth).
 */
export const getActiveRulesCallable = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

  const orgId = String(request.data?.orgId ?? "").trim() || undefined;
  const projectId = String(request.data?.projectId ?? "").trim() || undefined;

  if (orgId && projectId) {
    const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
    const admin = await db.doc(`platformAdmins/${uid}`).get();
    if (!member.exists && !admin.exists) {
      throw new HttpsError("permission-denied", "not a member of this org");
    }
  } else if (orgId || projectId) {
    throw new HttpsError("invalid-argument", "orgId and projectId are required together");
  }

  return loadActiveRules(orgId, projectId);
});

async function authorizeRulesAccess(
  orgId: string,
  projectId: string,
  authHeader: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const pSnap = await projectRef(orgId, projectId).get();
  if (!pSnap.exists) return { ok: false, status: 404, error: "project_not_found" };

  const repoMatch = await pSnap.ref
    .collection("repos")
    .where("ingestTokenHash", "==", hashIngestToken(token))
    .limit(1)
    .get();
  if (!repoMatch.empty) return { ok: true };

  // Legacy plaintext field (pre-hash migration)
  const legacy = await pSnap.ref.collection("repos").where("ingestToken", "==", token).limit(1).get();
  if (!legacy.empty) return { ok: true };

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const member = await db.doc(`orgs/${orgId}/members/${decoded.uid}`).get();
    const admin = await db.doc(`platformAdmins/${decoded.uid}`).get();
    if (member.exists || admin.exists) return { ok: true };
    return { ok: false, status: 403, error: "forbidden" };
  } catch {
    return { ok: false, status: 401, error: "unauthorized" };
  }
}
