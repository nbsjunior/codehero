import { FieldValue } from "firebase-admin/firestore";
import {
  ruleFpRate,
  ruleFpStatDocId,
  shouldSuppressInGate,
  type RuleFpStat,
  type GateSuppressOpts,
} from "@codehero/contracts";
import { repoRef } from "./firebase.ts";

/** Collection: orgs/.../repos/{repoId}/ruleFpStats/{docId} */
export function ruleFpStatsRef(orgId: string, projectId: string, repoId: string) {
  return repoRef(orgId, projectId, repoId).collection("ruleFpStats");
}

export async function bumpRuleFpStat(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  ruleId: string;
  verdict: "false_positive" | "confirmed";
}): Promise<RuleFpStat> {
  const docId = ruleFpStatDocId(input.ruleId);
  const ref = ruleFpStatsRef(input.orgId, input.projectId, input.repoId).doc(docId);
  await ref.set(
    {
      ruleId: input.ruleId,
      fp: FieldValue.increment(input.verdict === "false_positive" ? 1 : 0),
      tp: FieldValue.increment(input.verdict === "confirmed" ? 1 : 0),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  const snap = await ref.get();
  const d = snap.data() ?? {};
  const stat = ruleFpRate(Number(d.fp) || 0, Number(d.tp) || 0);
  await ref.set({ n: stat.n, rate: stat.rate }, { merge: true });
  return stat;
}

export async function loadRuleFpStats(
  orgId: string,
  projectId: string,
  repoId: string,
  ruleIds: string[],
): Promise<Map<string, RuleFpStat>> {
  const out = new Map<string, RuleFpStat>();
  const unique = [...new Set(ruleIds.filter(Boolean))];
  if (unique.length === 0) return out;
  const col = ruleFpStatsRef(orgId, projectId, repoId);
  // Firestore getAll limit — chunk by 100
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const refs = chunk.map((id) => col.doc(ruleFpStatDocId(id)));
    const snaps = await Promise.all(refs.map((r) => r.get()));
    for (let j = 0; j < snaps.length; j++) {
      const snap = snaps[j]!;
      const ruleId = chunk[j]!;
      if (!snap.exists) continue;
      const d = snap.data()!;
      out.set(ruleId, ruleFpRate(Number(d.fp) || 0, Number(d.tp) || 0));
    }
  }
  return out;
}

export function annotateGateSuppression(
  results: Array<{ ruleId: string; properties?: Record<string, unknown> | null }>,
  stats: Map<string, RuleFpStat>,
  opts?: GateSuppressOpts,
): { suppressed: number } {
  let suppressed = 0;
  for (const r of results) {
    const stat = stats.get(r.ruleId);
    if (!shouldSuppressInGate(stat, opts)) continue;
    r.properties = r.properties ?? {};
    r.properties.gateSuppressed = true;
    r.properties.gateSuppressReason = `ruleRepoFpRate=${stat!.rate.toFixed(2)} n=${stat!.n}`;
    r.properties.ruleRepoFpRate = stat!.rate;
    r.properties.ruleRepoFeedbackN = stat!.n;
    suppressed++;
  }
  return { suppressed };
}
