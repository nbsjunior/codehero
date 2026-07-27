import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.ts";

const SUMMARY_REF = db.doc("platformSummary/global");

/**
 * Incrementally maintained counts-by-bucket for the platform-wide admin KPI
 * cards. Only the categorical values that can't be answered by a safe
 * unfiltered Firestore aggregation query live here — "how many projects are
 * failing the gate" / "what's the worst security rating platform-wide" both
 * need a WHERE filter, and filtered collectionGroup queries need an explicit
 * field override to deploy (we hit exactly this class of index error once
 * already — see the firestore.indexes.json fix in this repo's history).
 * Updated as a delta whenever a project's aggregate rating/gate changes, so
 * answering these never requires fanning out to every project/repo doc.
 */
export async function applyPlatformSummaryDelta(input: {
  isNewProject: boolean;
  oldGate: string | null;
  newGate: string;
  oldSecurity: string | null;
  newSecurity: string;
}): Promise<void> {
  const inc: Record<string, FieldValue> = {};
  if (input.isNewProject) {
    inc.projectsTracked = FieldValue.increment(1);
  }
  if (input.oldGate !== input.newGate) {
    if (input.oldGate) inc[`byQualityGate.${input.oldGate}`] = FieldValue.increment(-1);
    inc[`byQualityGate.${input.newGate}`] = FieldValue.increment(1);
  }
  if (input.oldSecurity !== input.newSecurity) {
    if (input.oldSecurity) inc[`bySecurityRating.${input.oldSecurity}`] = FieldValue.increment(-1);
    inc[`bySecurityRating.${input.newSecurity}`] = FieldValue.increment(1);
  }
  if (Object.keys(inc).length === 0) return;
  await SUMMARY_REF.set(inc, { merge: true });
}

export async function getPlatformSummaryBuckets(): Promise<{
  byQualityGate: Record<string, number>;
  bySecurityRating: Record<string, number>;
}> {
  const snap = await SUMMARY_REF.get();
  const data = snap.data() ?? {};
  return {
    byQualityGate: (data.byQualityGate as Record<string, number>) ?? {},
    bySecurityRating: (data.bySecurityRating as Record<string, number>) ?? {},
  };
}
