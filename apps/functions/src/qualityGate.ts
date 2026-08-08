import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_QUALITY_GATE,
  mergeQualityGate,
  type QualityGateThresholds,
  type Rating,
} from "@codehero/contracts";
import { db } from "./lib/firebase.ts";
import { requireOrgRole, requireVerifiedEmail } from "./lib/authz.ts";
import { portalCallableOpts } from "./lib/httpSecurity.ts";

const RATINGS: Rating[] = ["A", "B", "C", "D", "E"];

function parseThresholds(raw: unknown): QualityGateThresholds {
  const o = (raw ?? {}) as Partial<QualityGateThresholds>;
  const maxSecurityRating = RATINGS.includes(o.maxSecurityRating as Rating)
    ? (o.maxSecurityRating as Rating)
    : DEFAULT_QUALITY_GATE.maxSecurityRating;
  const maxMaintainabilityRating = RATINGS.includes(o.maxMaintainabilityRating as Rating)
    ? (o.maxMaintainabilityRating as Rating)
    : DEFAULT_QUALITY_GATE.maxMaintainabilityRating;
  return mergeQualityGate({
    minNewCodeCoverage: Number(o.minNewCodeCoverage),
    minBranchCoverage: Number(o.minBranchCoverage ?? 0),
    maxNewCodeDuplication: Number(o.maxNewCodeDuplication),
    maxNewBlockerIssues: Number(o.maxNewBlockerIssues),
    maxSecurityRating,
    maxMaintainabilityRating,
  });
}

export const getProjectQualityGate = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const { orgId, projectId } = (request.data ?? {}) as { orgId?: string; projectId?: string };
  if (!orgId || !projectId) throw new HttpsError("invalid-argument", "orgId and projectId required");
  await requireOrgRole(orgId, uid, ["owner", "admin", "member"]);
  const snap = await db.doc(`orgs/${orgId}/projects/${projectId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "project not found");
  const thresholds = mergeQualityGate(
    (snap.get("qualityGate") as Partial<QualityGateThresholds> | undefined) ?? null,
  );
  return { thresholds, defaults: DEFAULT_QUALITY_GATE };
});

export const updateProjectQualityGate = onCall(portalCallableOpts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  await requireVerifiedEmail(uid);
  const { orgId, projectId, thresholds: raw } = (request.data ?? {}) as {
    orgId?: string;
    projectId?: string;
    thresholds?: unknown;
  };
  if (!orgId || !projectId) throw new HttpsError("invalid-argument", "orgId and projectId required");
  await requireOrgRole(orgId, uid, ["owner", "admin"]);

  const thresholds = parseThresholds(raw);
  if (
    thresholds.minNewCodeCoverage < 0 ||
    thresholds.minNewCodeCoverage > 100 ||
    (thresholds.minBranchCoverage ?? 0) < 0 ||
    (thresholds.minBranchCoverage ?? 0) > 100 ||
    thresholds.maxNewCodeDuplication < 0 ||
    thresholds.maxNewCodeDuplication > 100 ||
    thresholds.maxNewBlockerIssues < 0 ||
    thresholds.maxNewBlockerIssues > 1000
  ) {
    throw new HttpsError("invalid-argument", "threshold out of range");
  }

  await db.doc(`orgs/${orgId}/projects/${projectId}`).set(
    {
      qualityGate: thresholds,
      qualityGateUpdatedAt: FieldValue.serverTimestamp(),
      qualityGateUpdatedBy: uid,
    },
    { merge: true },
  );
  return { ok: true, thresholds };
});
