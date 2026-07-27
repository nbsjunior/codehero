import { FieldValue } from "firebase-admin/firestore";
import { aggregateProjectMetrics, type Rating } from "@codehero/contracts";
import { projectRef } from "./firebase.ts";

/**
 * Recomputes a project's rolled-up metrics from its repos subcollection and
 * writes them onto the project doc. Called after any repo-level metrics
 * change (ingestion, repo added/removed) so the dashboard/admin consolidation
 * views can read one cheap project doc instead of fanning out to repos on
 * every page load.
 */
export async function recomputeProjectAggregate(orgId: string, projectId: string): Promise<void> {
  const pRef = projectRef(orgId, projectId);
  const reposSnap = await pRef.collection("repos").get();

  const repos = reposSnap.docs.map((d) => {
    const data = d.data();
    return {
      debtMinutes: (data.debtMinutes as number) ?? 0,
      openIssues: (data.openIssues as number) ?? 0,
      maintainabilityRating: (data.maintainabilityRating as Rating) ?? "A",
      securityRating: (data.securityRating as Rating) ?? "A",
      qualityGateStatus: (data.qualityGateStatus as "PASSED" | "FAILED") ?? "PASSED",
    };
  });

  const aggregate = aggregateProjectMetrics(repos);
  await pRef.set(
    {
      repoCount: aggregate.repoCount,
      debtMinutes: aggregate.debtMinutes,
      openIssues: aggregate.openIssues,
      maintainabilityRating: aggregate.maintainabilityRating,
      securityRating: aggregate.securityRating,
      qualityGateStatus: aggregate.qualityGateStatus,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
