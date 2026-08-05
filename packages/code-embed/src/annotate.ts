/**
 * Anota SARIF com família (cluster) não supervisionada.
 * Offline — nunca é o único critério do gate.
 */
import type { ClusterReport } from "./cluster.ts";
import { findFamilyForLine, indexByFile } from "./cluster.ts";

export interface SarifLike {
  runs?: Array<{
    results?: Array<{
      ruleId?: string;
      locations?: Array<{
        physicalLocation?: {
          artifactLocation?: { uri?: string };
          region?: { startLine?: number };
        };
      }>;
      properties?: Record<string, unknown>;
    }>;
  }>;
}

export function annotateSarifWithClusters(sarif: SarifLike, report: ClusterReport): {
  annotated: number;
  sarif: SarifLike;
} {
  const byFile = indexByFile(report);
  let annotated = 0;
  for (const run of sarif.runs ?? []) {
    for (const r of run.results ?? []) {
      const loc = r.locations?.[0]?.physicalLocation;
      const file = loc?.artifactLocation?.uri ?? "";
      const line = loc?.region?.startLine ?? 0;
      const fam = findFamilyForLine(byFile, file, line);
      if (!fam) continue;
      r.properties = r.properties ?? {};
      r.properties.clusterId = fam.clusterId;
      r.properties.clusterIndex = fam.clusterIndex;
      r.properties.familySize = fam.familySize;
      r.properties.outlierScore = Math.round(fam.outlierScore * 1000) / 1000;
      r.properties.functionName = fam.name;
      r.properties.embedModel = report.version;
      annotated++;
    }
  }
  return { annotated, sarif };
}
