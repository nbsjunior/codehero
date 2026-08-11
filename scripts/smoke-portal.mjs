/**
 * Continuous portal smoke — Firebase Auth + HTTPS callables against prod/staging.
 *
 * Required env:
 *   FIREBASE_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY
 *   FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID  (default: apponti)
 *   CODEHERO_QA_PASSWORD                                  (default: CodeHeroQa!2026)
 *
 * Optional:
 *   SMOKE_REGION          default us-central1
 *   SMOKE_DEEP=1          include dress-code (LLM) + previewRepoScan (slow)
 *   SMOKE_GESTOR_EMAIL    default qa.repo.gestor@codehero.test
 *   SMOKE_PLATFORM_EMAIL  default qa.platform.admin@codehero.test
 *   SMOKE_ORG_ID / SMOKE_PROJECT_ID / SMOKE_REPO_ID
 *     — if omitted, discovers the QA org marked qa-repo-gestor via Admin SDK
 *       (needs Application Default Credentials) OR falls back to listOrgMembers
 *       after signing in as gestor and scanning membership via a known seed.
 *
 * Exit 0 = all passed; non-zero = failures.
 */
import assert from "node:assert/strict";

const API_KEY =
  process.env.FIREBASE_API_KEY?.trim() || process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
  "apponti";
const REGION = process.env.SMOKE_REGION?.trim() || "us-central1";
const PASSWORD = process.env.CODEHERO_QA_PASSWORD?.trim() || "CodeHeroQa!2026";
const DEEP =
  process.env.SMOKE_DEEP === "1" ||
  process.env.SMOKE_DEEP === "true" ||
  process.argv.includes("--deep");
const GESTOR_EMAIL = process.env.SMOKE_GESTOR_EMAIL?.trim() || "qa.repo.gestor@codehero.test";
const PLATFORM_EMAIL =
  process.env.SMOKE_PLATFORM_EMAIL?.trim() || "qa.platform.admin@codehero.test";

if (!API_KEY) {
  console.error("Missing FIREBASE_API_KEY (or NEXT_PUBLIC_FIREBASE_API_KEY).");
  process.exit(2);
}

/** @type {{ name: string; ok: boolean; detail?: string; ms: number }[]} */
const results = [];

async function signIn(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Browser API keys are often locked to HTTP referrers (codehero.web.app).
      Referer: "https://codehero.web.app/",
      Origin: "https://codehero.web.app",
    },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`signIn ${email}: ${body.error?.message || res.status}`);
  }
  return { idToken: body.idToken, localId: body.localId, email: body.email };
}

async function call(idToken, name, data = {}, { timeoutMs = 60_000 } = {}) {
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        Referer: "https://codehero.web.app/",
        Origin: "https://codehero.web.app",
      },
      body: JSON.stringify({ data }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (body.error) {
      const err = body.error;
      const msg = typeof err === "string" ? err : err.message || JSON.stringify(err);
      const code = err.status || err.code || res.status;
      const e = new Error(`${name}: ${code} ${msg}`);
      e.code = code;
      throw e;
    }
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return body.result;
  } finally {
    clearTimeout(t);
  }
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail == null ? undefined : String(detail), ms: Date.now() - started });
    console.log(`  ✓ ${name}${detail != null ? ` — ${detail}` : ""} (${Date.now() - started}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail: msg, ms: Date.now() - started });
    console.error(`  ✗ ${name} — ${msg} (${Date.now() - started}ms)`);
  }
}

async function discoverQaScope(idToken, gestorUid) {
  const orgId = process.env.SMOKE_ORG_ID?.trim();
  const projectId = process.env.SMOKE_PROJECT_ID?.trim();
  if (orgId && projectId) {
    return { orgId, projectId, repoId: process.env.SMOKE_REPO_ID?.trim() || null };
  }

  // Prefer Admin SDK lookup of the seeded QA marker when ADC is available.
  try {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const dbId = process.env.FIRESTORE_DATABASE_ID?.trim() || "codehero";
    const db = dbId !== "(default)" ? getFirestore(dbId) : getFirestore();
    const orgs = await db.collection("orgs").where("qaMarker", "==", "qa-repo-gestor").limit(1).get();
    if (!orgs.empty) {
      const o = orgs.docs[0];
      const projects = await o.ref.collection("projects").limit(1).get();
      const p = projects.docs[0];
      let repoId = null;
      if (p) {
        const repos = await p.ref.collection("repos").limit(1).get();
        repoId = repos.docs[0]?.id ?? null;
      }
      if (p) return { orgId: o.id, projectId: p.id, repoId };
    }
  } catch (err) {
    console.warn(`  (admin discover skipped: ${err instanceof Error ? err.message : err})`);
  }

  // Fallback: Firestore REST with the caller's ID token (collectionGroup members).
  try {
    const dbId = encodeURIComponent(process.env.FIRESTORE_DATABASE_ID?.trim() || "codehero");
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${dbId}/documents:runQuery`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "members", allDescendants: true }],
          where: {
            fieldFilter: {
              field: { fieldPath: "uid" },
              op: "EQUAL",
              value: { stringValue: gestorUid },
            },
          },
          limit: 5,
        },
      }),
    });
    const rows = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(rows).slice(0, 200));
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = row.document?.name; // .../documents/orgs/{orgId}/members/{uid}
      const m = typeof name === "string" ? name.match(/\/documents\/orgs\/([^/]+)\/members\//) : null;
      if (!m) continue;
      const foundOrg = m[1];
      const listUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${dbId}/documents/orgs/${foundOrg}/projects?pageSize=5`;
      const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${idToken}` } });
      const listBody = await listRes.json();
      const first = listBody.documents?.[0]?.name?.match(/\/projects\/([^/]+)$/)?.[1];
      if (first) return { orgId: foundOrg, projectId: first, repoId: null };
    }
  } catch (err) {
    console.warn(`  (rest discover skipped: ${err instanceof Error ? err.message : err})`);
  }

  throw new Error(
    `Cannot discover QA org/project for ${gestorUid}. Set SMOKE_ORG_ID and SMOKE_PROJECT_ID.`,
  );
}

async function runGestor(auth) {
  console.log(`\n[gestor] ${auth.email}`);
  let scope = { orgId: "", projectId: "", repoId: null };

  await step("gestor: checkPlatformAdmin == false", async () => {
    const r = await call(auth.idToken, "checkPlatformAdmin");
    assert.equal(r.isAdmin, false);
    return "isAdmin=false";
  });

  await step("gestor: discover QA workspace", async () => {
    scope = await discoverQaScope(auth.idToken, auth.localId);
    return `${scope.orgId}/${scope.projectId}`;
  });

  await step("gestor: listOrgMembers", async () => {
    if (!scope.orgId) throw new Error("no org");
    const r = await call(auth.idToken, "listOrgMembers", { orgId: scope.orgId });
    assert.ok(Array.isArray(r.members));
    assert.ok(r.members.some((m) => m.uid === auth.localId));
    return `${r.members.length} member(s)`;
  });

  await step("gestor: listProjectRepos", async () => {
    const r = await call(auth.idToken, "listProjectRepos", {
      orgId: scope.orgId,
      projectId: scope.projectId,
    });
    assert.ok(Array.isArray(r.repos));
    return `${r.repos.length} repo(s)`;
  });

  let gateBefore = null;
  await step("gestor: getProjectQualityGate", async () => {
    const r = await call(auth.idToken, "getProjectQualityGate", {
      orgId: scope.orgId,
      projectId: scope.projectId,
    });
    assert.ok(r.thresholds);
    assert.ok(typeof r.thresholds.minNewCodeCoverage === "number");
    gateBefore = r.thresholds;
    return `coverage=${r.thresholds.minNewCodeCoverage}`;
  });

  await step("gestor: updateProjectQualityGate (restore)", async () => {
    assert.ok(gateBefore);
    const r = await call(auth.idToken, "updateProjectQualityGate", {
      orgId: scope.orgId,
      projectId: scope.projectId,
      thresholds: gateBefore,
    });
    assert.equal(r.ok, true);
    return "ok";
  });

  await step("gestor: listDressCodes (project)", async () => {
    const r = await call(auth.idToken, "listDressCodes", {
      scope: "project",
      orgId: scope.orgId,
      projectId: scope.projectId,
    });
    assert.ok(Array.isArray(r.items));
    return `${r.items.length} item(s)`;
  });

  await step("gestor: listMotorRules", async () => {
    const r = await call(auth.idToken, "listMotorRules", {});
    assert.ok(Array.isArray(r.groups) || r.totals);
    const n = r.totals?.all ?? r.groups?.reduce((a, g) => a + (g.rules?.length ?? 0), 0) ?? 0;
    assert.ok(n > 0, "expected motor rules");
    return `rules≈${n}`;
  });

  if (DEEP) {
    await step("gestor: submitDressCode (project, approval)", async () => {
      const r = await call(
        auth.idToken,
        "submitDressCode",
        {
          naturalLanguage:
            "Proibido console.log em producao. Nao usar Math.random para tokens de autenticacao.",
          scope: "project",
          orgId: scope.orgId,
          projectId: scope.projectId,
          activate: false,
          requireApproval: true,
        },
        { timeoutMs: 120_000 },
      );
      assert.ok(r.summary || r.ruleCount != null || r.status);
      return `status=${r.status} rules=${r.ruleCount ?? "?"}`;
    });

    await step("gestor: previewRepoScan (public)", async () => {
      const r = await call(
        auth.idToken,
        "previewRepoScan",
        {
          repoUrl: "https://github.com/nbsjunior/codehero",
          orgId: scope.orgId,
          projectId: scope.projectId,
        },
        { timeoutMs: 300_000 },
      );
      const n = r.findings?.length ?? r.issueCount ?? r.openIssues ?? null;
      assert.ok(r.repo || r.findings || r.summary || r.gate);
      return `findings=${n ?? "ok"}`;
    });
  } else {
    console.log("  · deep steps skipped (set SMOKE_DEEP=1 for dress-code + preview)");
  }

  return scope;
}

async function runPlatform(auth) {
  console.log(`\n[platform] ${auth.email}`);

  await step("platform: checkPlatformAdmin == true", async () => {
    const r = await call(auth.idToken, "checkPlatformAdmin");
    assert.equal(r.isAdmin, true);
    return "isAdmin=true";
  });

  await step("platform: adminGetPlatformSummary", async () => {
    const r = await call(auth.idToken, "adminGetPlatformSummary", {}, { timeoutMs: 90_000 });
    assert.ok(typeof r.orgCount === "number" || typeof r.projectCount === "number");
    return `orgs=${r.orgCount} projects=${r.projectCount}`;
  });

  await step("platform: listFeatureFlags", async () => {
    const r = await call(auth.idToken, "listFeatureFlags");
    assert.ok(Array.isArray(r.flags));
    return `${r.flags.length} flag(s)`;
  });

  await step("platform: listRuleforgeRuns", async () => {
    const r = await call(auth.idToken, "listRuleforgeRuns", { limit: 5 });
    assert.ok(Array.isArray(r.runs));
    return `${r.runs.length} run(s)`;
  });

  await step("platform: listRuleProposals", async () => {
    const r = await call(auth.idToken, "listRuleProposals", { limit: 10 });
    assert.ok(Array.isArray(r.items));
    return `${r.items.length} proposal(s), pending=${r.counts?.pending ?? "?"}`;
  });

  await step("platform: listDressCodes (global)", async () => {
    const r = await call(auth.idToken, "listDressCodes", { scope: "global" });
    assert.ok(Array.isArray(r.items));
    return `${r.items.length} item(s)`;
  });

  await step("platform: listMotorRules", async () => {
    const r = await call(auth.idToken, "listMotorRules", {});
    assert.ok(Array.isArray(r.groups) || r.totals);
    const n = r.totals?.all ?? 0;
    return `rules≈${n}`;
  });

  if (DEEP) {
    await step("platform: submitDressCode (global, approval)", async () => {
      const r = await call(
        auth.idToken,
        "submitDressCode",
        {
          naturalLanguage:
            "Em qualquer repositorio da plataforma: proibir eval() e Function(string).",
          scope: "global",
          activate: false,
          requireApproval: true,
        },
        { timeoutMs: 120_000 },
      );
      assert.ok(r.summary || r.ruleCount != null || r.status);
      return `status=${r.status} rules=${r.ruleCount ?? "?"}`;
    });
  }
}

async function main() {
  console.log(`CodeHero portal smoke → ${PROJECT_ID}/${REGION}${DEEP ? " (DEEP)" : ""}`);

  const gestor = await signIn(GESTOR_EMAIL, PASSWORD);
  await runGestor(gestor);

  const platform = await signIn(PLATFORM_EMAIL, PASSWORD);
  await runPlatform(platform);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error("Failures:");
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
