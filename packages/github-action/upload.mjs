// Uploads the SARIF report to the CodeHero ingest endpoint and enforces the
// quality gate. Pure Node (>=18) — uses the built-in fetch, no dependencies.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const { HERO_URL, HERO_TOKEN, ORG_ID, PROJECT_ID, REPO_ID } = process.env;
if (!HERO_URL || !HERO_TOKEN || !ORG_ID || !PROJECT_ID || !REPO_ID) {
  console.error("CodeHero: missing HERO_URL/HERO_TOKEN/ORG_ID/PROJECT_ID/REPO_ID");
  process.exit(1);
}

const sarif = JSON.parse(readFileSync("codehero.sarif", "utf8"));

// Approximate LOC of tracked source for the debt ratio.
let linesOfCode = 1;
try {
  const out = execSync("git ls-files | xargs wc -l 2>/dev/null | tail -1", { encoding: "utf8" });
  linesOfCode = Math.max(1, parseInt(out.trim().split(/\s+/)[0] || "1", 10));
} catch {
  /* best-effort */
}

// New-code fingerprints = issues whose file changed in this PR/push.
let newCodeFingerprints = [];
try {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1";
  const changed = new Set(
    execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean),
  );
  newCodeFingerprints = (sarif.runs?.[0]?.results ?? [])
    .filter((r) => changed.has(r.locations?.[0]?.physicalLocation?.artifactLocation?.uri))
    .map((r) => r.partialFingerprints?.["heroHash/v1"])
    .filter(Boolean);
} catch {
  /* best-effort */
}

const res = await fetch(`${HERO_URL}/ingestAnalysis`, {
  method: "POST",
  headers: { Authorization: `Bearer ${HERO_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    repoId: REPO_ID,
    branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "main",
    commit: process.env.GITHUB_SHA,
    linesOfCode,
    newCodeFingerprints,
    sarif,
  }),
});

if (!res.ok) {
  console.error(`CodeHero ingest failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const { analysisId, summary } = await res.json();
console.log(`CodeHero analysis ${analysisId}: gate=${summary.qualityGate.status}, debt=${summary.debtMinutes}min`);
console.log(JSON.stringify(summary.bySeverity));

if (summary.qualityGate.status === "FAILED") {
  console.error("Quality Gate FAILED:");
  for (const c of summary.qualityGate.failedConditions) console.error(`  - ${c}`);
  process.exit(1);
}
