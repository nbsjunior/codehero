import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.ts";

/**
 * Grounds the daily rule-proposal prompt in REAL, current security advisories
 * instead of the LLM's frozen training memory. Source: GitHub's public
 * Security Advisories REST API — unauthenticated, no secret to manage,
 * structured (CWE ids, ecosystem, severity), and rate-limited generously
 * enough (60 req/hour unauthenticated) for a weekly batch of a handful of
 * ecosystem queries. Bulk sources like the full OSV.dev export exist but are
 * overkill for "what's new this week" — this is the same data, queried
 * directly by recency instead of downloading and diffing a multi-GB archive.
 *
 * Ecosystem coverage matches the languages CodeHero's rule catalog targets
 * with a package ecosystem at all: npm (JS/TS), pip (Python), maven (Java),
 * nuget (C#/VB.Net), go. COBOL/T-SQL/DB2 have no equivalent package-advisory
 * feed — those languages' rule coverage stays driven by clean-code/lint
 * knowledge (phase 3), not CVE feeds.
 */

const ECOSYSTEM_TO_LANGUAGE: Record<string, string> = {
  npm: "javascript/typescript",
  pip: "python",
  maven: "java",
  nuget: "csharp/vbnet",
  go: "go",
};

const RETENTION_DAYS = 90;
const PER_ECOSYSTEM_LIMIT = 25;

export interface CveWatchlistEntry {
  ghsaId: string;
  cveId: string | null;
  ecosystem: string;
  language: string;
  severity: string;
  summary: string;
  cweIds: string[];
  publishedAt: string;
}

interface GithubAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string;
  published_at: string;
  cwes?: Array<{ cwe_id: string }>;
}

async function fetchAdvisoriesForEcosystem(ecosystem: string): Promise<CveWatchlistEntry[]> {
  const url = `https://api.github.com/advisories?ecosystem=${encodeURIComponent(ecosystem)}&per_page=${PER_ECOSYSTEM_LIMIT}&sort=published&direction=desc`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "CodeHero-cveWatchlistSync",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub advisories fetch failed for ${ecosystem}: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const advisories = (await res.json()) as GithubAdvisory[];
  return advisories.map((a) => ({
    ghsaId: a.ghsa_id,
    cveId: a.cve_id,
    ecosystem,
    language: ECOSYSTEM_TO_LANGUAGE[ecosystem] ?? ecosystem,
    severity: (a.severity || "unknown").toUpperCase(),
    summary: (a.summary || "").slice(0, 300),
    cweIds: (a.cwes ?? []).map((c) => c.cwe_id),
    publishedAt: a.published_at,
  }));
}

/** Fetches recent advisories for every tracked ecosystem and upserts them into Firestore. */
export async function syncCveWatchlist(): Promise<{ fetched: number; ecosystems: string[] }> {
  const ecosystems = Object.keys(ECOSYSTEM_TO_LANGUAGE);
  let fetched = 0;
  const batch = db.batch();
  let batchOps = 0;

  for (const eco of ecosystems) {
    let entries: CveWatchlistEntry[] = [];
    try {
      entries = await fetchAdvisoriesForEcosystem(eco);
    } catch (err) {
      console.warn("cveWatchlist: fetch failed", { ecosystem: eco, err: String(err) });
      continue;
    }
    for (const entry of entries) {
      const ref = db.doc(`cveWatchlist/${entry.ghsaId}`);
      batch.set(
        ref,
        {
          ...entry,
          fetchedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      fetched++;
      batchOps++;
      // Firestore batch caps at 500 writes; flush defensively (5 ecosystems ×
      // 25 is well under that today, but stay safe if limits ever grow).
      if (batchOps >= 400) {
        await batch.commit();
        batchOps = 0;
      }
    }
  }
  if (batchOps > 0) await batch.commit();

  await pruneStaleEntries();
  return { fetched, ecosystems };
}

async function pruneStaleEntries(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const snap = await db.collection("cveWatchlist").where("publishedAt", "<", cutoff).limit(200).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const d of snap.docs) batch.delete(d.ref);
  await batch.commit();
}

/** Builds a compact digest of the most severe recent advisories for the Genkit prompt. */
export async function getCveDigestForPrompt(maxItems = 15): Promise<string> {
  const severityRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 };
  const snap = await db.collection("cveWatchlist").orderBy("publishedAt", "desc").limit(200).get();
  if (snap.empty) return "Sem CVEs recentes monitorados (watchlist ainda não sincronizada ou vazia).";

  const entries = snap.docs
    .map((d) => d.data() as CveWatchlistEntry)
    .sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0))
    .slice(0, maxItems);

  const lines = entries.map(
    (e) =>
      `- [${e.severity}] ${e.cveId ?? e.ghsaId} (${e.language}, CWE: ${e.cweIds.join(",") || "?"}): ${e.summary}`,
  );
  return `CVEs/advisories recentes (últimos ${RETENTION_DAYS} dias, GitHub Security Advisories):\n${lines.join("\n")}`;
}

export async function listCveWatchlistEntries(limit = 100): Promise<CveWatchlistEntry[]> {
  const snap = await db.collection("cveWatchlist").orderBy("publishedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data() as CveWatchlistEntry);
}
