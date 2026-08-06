// Uploads the SARIF report to the CodeHero ingest endpoint and enforces the
// quality gate. Pure Node (>=18) — uses the built-in fetch, no dependencies.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
// `execFileSync` para tudo que interpola valor; `execSync` fica só para o
// pipeline abaixo, que é comando literal fixo e precisa mesmo de shell.
import { execFileSync, execSync } from "node:child_process";

const SEVERITY_ORDER = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];

/** Normalize paths so git diff names match SARIF uris (posix, no file://). */
function normPath(p) {
  return String(p || "")
    .replace(/^file:\/\/\/?/i, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

/**
 * Parse `git diff -U0` into Map<path, Set<line>> for line-level new-code.
 * Falls back to empty map on failure.
 */
function changedLinesByFile(base) {
  /** @type {Map<string, Set<number>>} */
  const map = new Map();
  try {
    // execFileSync com argumentos em ARRAY: nao passa por shell, entao `base`
    // — que vem do contexto do GitHub — nao pode injetar comando. Era
    // `execSync(`git diff -U0 ${base}...HEAD`)`, template interpolado direto
    // no shell, e o proprio CodeHero apontou.
    const diff = execFileSync("git", ["diff", "-U0", `${base}...HEAD`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    let file = "";
    for (const line of diff.split("\n")) {
      const af = line.match(/^\+\+\+ b\/(.+)$/);
      if (af) {
        file = normPath(af[1]);
        if (!map.has(file)) map.set(file, new Set());
        continue;
      }
      // @@ -old,count +newStart,newCount @@
      const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunk && file) {
        const start = parseInt(hunk[1], 10);
        const count = hunk[2] !== undefined ? parseInt(hunk[2], 10) : 1;
        const set = map.get(file) ?? new Set();
        for (let i = 0; i < count; i++) set.add(start + i);
        map.set(file, set);
      }
    }
  } catch {
    /* best-effort */
  }
  return map;
}

function pathMatchesChanged(uri, changedSet) {
  const u = normPath(uri);
  if (!u) return false;
  if (changedSet.has(u)) return true;
  for (const c of changedSet) {
    if (u === c || u.endsWith("/" + c) || c.endsWith("/" + u)) return true;
  }
  return false;
}

function lineInChangedFile(uri, line, lineMap) {
  const u = normPath(uri);
  if (!u || !line) return false;
  for (const [path, lines] of lineMap) {
    if (u === path || u.endsWith("/" + path) || path.endsWith("/" + u)) {
      return lines.has(Number(line));
    }
  }
  return false;
}

/**
 * One Markdown report per run, one section per finding, built straight from
 * the SARIF `properties` the scanner already computed (risk/reason/how to
 * fix/before-after example) — no extra API call. Meant to be handed to an AI
 * coding agent (Copilot/Claude/Cursor) as the autofix worklist for this run.
 */
function renderFindingsMarkdown(sarif, repoLabel) {
  const results = [...(sarif.runs?.[0]?.results ?? [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.properties?.severity ?? "INFO") - SEVERITY_ORDER.indexOf(b.properties?.severity ?? "INFO"),
  );
  const lines = [
    `# CodeHero — apontamentos para autofix (${repoLabel})`,
    ``,
    `${results.length} apontamento(s) aberto(s) nesta análise. Cada seção abaixo é uma unidade de trabalho`,
    `independente: aplique a correção descrita em "Como corrigir", preservando as restrições listadas.`,
    ``,
  ];
  for (const r of results) {
    const p = r.properties ?? {};
    const loc = r.locations?.[0]?.physicalLocation;
    const file = loc?.artifactLocation?.uri ?? "?";
    const line = loc?.region?.startLine ?? "?";
    const tool = p.tool || (String(r.ruleId || "").startsWith("EXT:") ? String(r.ruleId).split(":")[1] : null);
    lines.push(
      `## [${p.severity ?? "INFO"}] ${r.ruleId} — \`${file}:${line}\``,
      ``,
    );
    if (tool) lines.push(`**Procedência:** via ${tool}`, ``);
    lines.push(
      `**Risco:** ${p.risk ?? "—"}`,
      ``,
      `**Motivo:** ${p.reason ?? r.message?.text ?? "—"}`,
      ``,
      `**Como corrigir:** ${p.howToFix ?? "—"}`,
      ``,
    );
    if (p.snippet) lines.push("```", p.snippet, "```", ``);
    if (p.referenceExample) {
      lines.push(`**Antes:**`, "```", p.referenceExample.before, "```", ``, `**Depois:**`, "```", p.referenceExample.after, "```", ``);
    }
    if (p.constraints?.length) {
      lines.push(`**Restrições:**`, ...p.constraints.map((c) => `- ${c}`), ``);
    }
    lines.push(`---`, ``);
  }
  return lines.join("\n");
}

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

// New-code fingerprints: prefer LINE-level (git diff -U0); fall back to file-level.
let newCodeFingerprints = [];
try {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1";
  const lineMap = changedLinesByFile(base);
  const results = sarif.runs?.[0]?.results ?? [];
  if (lineMap.size > 0) {
    newCodeFingerprints = results
      .filter((r) => {
        const loc = r.locations?.[0]?.physicalLocation;
        return lineInChangedFile(
          loc?.artifactLocation?.uri,
          loc?.region?.startLine,
          lineMap,
        );
      })
      .map((r) => r.partialFingerprints?.["heroHash/v1"])
      .filter(Boolean);
    console.log(`CodeHero: new-code line-level → ${newCodeFingerprints.length} fingerprint(s) in ${lineMap.size} file(s)`);
  } else {
    const changed = new Set(
      execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map(normPath),
    );
    newCodeFingerprints = results
      .filter((r) => pathMatchesChanged(r.locations?.[0]?.physicalLocation?.artifactLocation?.uri, changed))
      .map((r) => r.partialFingerprints?.["heroHash/v1"])
      .filter(Boolean);
    console.log(`CodeHero: new-code file-level fallback → ${newCodeFingerprints.length} fingerprint(s)`);
  }
} catch {
  /* best-effort */
}

const findingsMdPath = "codehero-findings.md";
writeFileSync(findingsMdPath, renderFindingsMarkdown(sarif, `${ORG_ID}/${PROJECT_ID}/${REPO_ID}`));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `findings-md=${findingsMdPath}\n`);
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
