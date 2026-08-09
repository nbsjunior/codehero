#!/usr/bin/env node
/**
 * Esteira de engenharia Sonar way — os 4 pontos:
 *
 *  1. Priorizar VULN stubs (não os 1.4k smells)
 *  2. Promover stub→live só com detector + golden + portão F1 (P≥0.85)
 *  3. Smells: só alto ROI; resto fica stub (Presence/SARIF)
 *  4. Relatório live scannable (não stub)
 *
 * Uso:
 *   npm run sonar:engenharia              # prioritize + smell-policy + report
 *   npm run sonar:engenharia -- prioritize
 *   npm run sonar:engenharia -- promote    # gera + promove VULNs que passam F1
 *   npm run sonar:engenharia -- report
 *   npm run sonar:engenharia -- all        # prioritize → generate → promote → live → compare
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "packages", "contracts", "src", "data");
const SEEDS = join(ROOT, "scripts", "data", "sonar-port-golden-seeds.json");
const OUT = join(ROOT, "reports");
const GOLDEN = join(ROOT, "packages", "ruleforge", "corpus", "golden.json");

const SEV_RANK = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 3, INFO: 4 };
const SMELL_MIN_EFFORT = 15;
const SMELL_ALLOWLIST = new Set([
  "todo-fixme",
  "debug-log",
  "empty-catch",
  "debugger-statement",
]);
const P_MIN = 0.85;

function nodeScript(relPath) {
  execFileSync(process.execPath, [join(ROOT, relPath)], { cwd: ROOT, stdio: "inherit" });
}

function buildContracts() {
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  execFileSync(process.execPath, [tsc, "-p", join(ROOT, "packages", "contracts", "tsconfig.json")], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function prioritize() {
  const catalog = await loadJson(join(DATA, "sonarWayRules.json"));
  const curation = await loadJson(join(DATA, "sonarWayCuration.json"));
  const seeds = await loadJson(SEEDS);
  const seededTemplates = new Set(Object.keys(seeds.byTemplate ?? {}));
  const selected = new Set(curation.selecao);

  const stubs = catalog.filter(
    (r) => r.type === "VULNERABILITY" && r.implementation === "stub",
  );
  const genLiveNotCurated = catalog.filter(
    (r) =>
      r.type === "VULNERABILITY" &&
      r.implementation === "sonar-port" &&
      !selected.has(r.id),
  );

  const backlog = [...stubs, ...genLiveNotCurated]
    .map((r) => ({
      id: r.id,
      sonarKey: r.sonarKey,
      name: r.name,
      severity: r.severity,
      languages: r.languages,
      implementation: r.implementation,
      inCuration: selected.has(r.id),
      /** Heurística: nome sugere template wave2 já semeado. */
      seedHint: Object.keys(seeds.byTemplate ?? {}).find((t) =>
        nameMatchesTemplateHint(r.name, t),
      ) ?? null,
      priority: SEV_RANK[r.severity] ?? 9,
    }))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const bySev = {};
  for (const b of backlog) bySev[b.severity] = (bySev[b.severity] ?? 0) + 1;

  const report = {
    generatedAt: new Date().toISOString(),
    policy: {
      focus: "VULNERABILITY stubs first",
      smellMinEffort: SMELL_MIN_EFFORT,
      smellAllowlist: [...SMELL_ALLOWLIST],
      promoteGate: `P≥${P_MIN} ∧ ≥1 match ∧ ≥1 no_match`,
      seededTemplates: [...seededTemplates],
    },
    summary: {
      vulnStub: stubs.length,
      vulnGenLiveNotInCuration: genLiveNotCurated.length,
      backlogTotal: backlog.length,
      bySeverity: bySev,
      withSeedHint: backlog.filter((b) => b.seedHint).length,
    },
    backlog,
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "sonar-way-vuln-backlog.json"), JSON.stringify(report, null, 2));
  await writeFile(join(OUT, "sonar-way-vuln-backlog.md"), renderBacklogMd(report));
  console.log(
    `Backlog VULN: ${report.summary.backlogTotal} (stub ${stubs.length} + live-não-curado ${genLiveNotCurated.length}) → reports/sonar-way-vuln-backlog.*`,
  );
  return report;
}

function nameMatchesTemplateHint(name, templateId) {
  const n = String(name).toLowerCase();
  const hints = {
    "custom-crypto": /custom cryptographic/,
    "sql-dynamic-format": /dynamically formatted/,
    "requested-session-id": /getrequestedsessionid/,
    "securerandom-predictable": /secure random number generators should not output predictable/,
    "aws-long-term-keys": /long-term aws/,
    "xml-signature-validate": /xml signatures? should be validated/,
    "log-injection": /logging should not be vulnerable to injection/,
    "ssrf-forging": /server-side requests should not be vulnerable to (forging|traversing)/,
    "redirect-forging": /redirections should not be open to forging/,
    "cmd-args-user-input": /system command arguments constructed from user input/,
    "connection-string-inject": /connection strings should not be vulnerable/,
    "xslt-injection": /xslt transformations should not be vulnerable/,
    "bean-untrusted": /populated from untrusted/,
    "db-query-injection": /database queries should not be vulnerable to injection/,
    "template-injection": /server-side templates should not be vulnerable/,
    "env-untrusted": /environment variables should not be defined from untrusted/,
    "cobol-dynamic-call": /subprogram to be called should not be programmatically/,
  };
  return hints[templateId]?.test(n) ?? false;
}

function renderBacklogMd(report) {
  const lines = [
    "# Backlog Sonar way — VULN (esteira de engenharia)",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Política",
    "",
    `- Foco: **VULNERABILITY** stubs (não CODE_SMELL em massa)`,
    `- Smells: effort ≥ ${report.policy.smellMinEffort} ou allowlist; senão stub + SARIF`,
    `- Promoção: ${report.policy.promoteGate}`,
    "",
    "## Resumo",
    "",
    `- Backlog total: **${report.summary.backlogTotal}**`,
    `- Stub: ${report.summary.vulnStub}`,
    `- sonar-port ainda fora da curadoria: ${report.summary.vulnGenLiveNotInCuration}`,
    `- Com seed de golden (wave2): ${report.summary.withSeedHint}`,
    "",
    "## Por severidade",
    "",
  ];
  for (const [sev, n] of Object.entries(report.summary.bySeverity).sort(
    (a, b) => (SEV_RANK[a[0]] ?? 9) - (SEV_RANK[b[0]] ?? 9),
  )) {
    lines.push(`- **${sev}**: ${n}`);
  }
  lines.push("", "## Top 80", "", "| Sev | Id | Key | Seed | Nome |", "|-----|----|-----|------|------|");
  for (const b of report.backlog.slice(0, 80)) {
    lines.push(
      `| ${b.severity} | \`${b.id}\` | \`${b.sonarKey}\` | ${b.seedHint ?? "—"} | ${b.name.replace(/\|/g, "/").slice(0, 70)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function smellPolicy() {
  const catalog = await loadJson(join(DATA, "sonarWayRules.json"));
  const curation = await loadJson(join(DATA, "sonarWayCuration.json"));
  const selected = new Set(curation.selecao);

  const smells = catalog.filter((r) => r.type === "CODE_SMELL");
  const liveSmells = smells.filter((r) => selected.has(r.id));
  const highRoiCandidates = smells.filter(
    (r) =>
      r.implementation === "stub" &&
      (r.remediationEffortMin ?? 0) >= SMELL_MIN_EFFORT,
  );

  const lowRoiLive = liveSmells.filter((r) => (r.remediationEffortMin ?? 0) < SMELL_MIN_EFFORT);

  const report = {
    generatedAt: new Date().toISOString(),
    policy: {
      smellMinEffort: SMELL_MIN_EFFORT,
      smellAllowlist: [...SMELL_ALLOWLIST],
      note: "Novas promoções automáticas NÃO incluem CODE_SMELL. Stubs de smell ficam para Presence/SARIF. Live smells abaixo do ROI ficam listados para revisão humana — não são demovidos automaticamente (preserva curadoria).",
    },
    summary: {
      smellTotal: smells.length,
      smellStub: smells.filter((r) => r.implementation === "stub").length,
      smellLiveCurated: liveSmells.length,
      highRoiStubCandidates: highRoiCandidates.length,
      lowRoiStillLive: lowRoiLive.length,
    },
    highRoiStubSample: highRoiCandidates.slice(0, 40).map((r) => ({
      id: r.id,
      effort: r.remediationEffortMin,
      name: r.name,
    })),
    lowRoiLiveSample: lowRoiLive.slice(0, 40).map((r) => ({
      id: r.id,
      effort: r.remediationEffortMin,
      name: r.name,
    })),
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "sonar-way-smell-policy.json"), JSON.stringify(report, null, 2));
  console.log(
    `Smell policy: live curated ${liveSmells.length} · stub ${report.summary.smellStub} · high-ROI stub candidates ${highRoiCandidates.length} (não auto-promovidos)`,
  );
  return report;
}

async function loadMatchPattern() {
  const mod = await import(
    pathToFileURL(join(ROOT, "packages", "contracts", "dist", "index.js")).href
  );
  return mod.matchPattern;
}

function scoreCases(matchPattern, pattern, cases) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const c of cases) {
    const hit =
      matchPattern(pattern, c.code, { profile: c.profile ?? "clike" }).length > 0;
    if (c.expected === "match") {
      if (hit) tp++;
      else fn++;
    } else if (hit) fp++;
    else tn++;
  }
  const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
  const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  return { tp, fp, tn, fn, prec, rec, f1, ok: prec >= P_MIN && tp >= 1 && tn >= 1 };
}

async function promoteFixed() {
  try {
    await readFile(join(ROOT, "packages", "contracts", "dist", "index.js"));
  } catch {
    console.log("build:contracts…");
    buildContracts();
  }

  console.log("sonar:generate…");
  nodeScript("scripts/generate-sonar-way-rules.mjs");

  const catalog = await loadJson(join(DATA, "sonarWayRules.json"));
  const curation = await loadJson(join(DATA, "sonarWayCuration.json"));
  const seeds = await loadJson(SEEDS);
  const matchPattern = await loadMatchPattern();
  const selected = new Set(curation.selecao);
  const golden = await loadJson(GOLDEN);
  const goldenIds = new Set(golden.map((c) => c.id));

  const candidates = catalog.filter(
    (r) =>
      r.type === "VULNERABILITY" &&
      r.implementation === "sonar-port" &&
      !selected.has(r.id),
  );

  const promoted = [];
  const rejected = [];
  const newGolden = [];

  for (const rule of candidates) {
    let chosen = null;
    let chosenCases = null;

    for (const [tid, cases] of Object.entries(seeds.byTemplate)) {
      const nameHit = nameMatchesTemplateHint(rule.name, tid);
      const s = scoreCases(matchPattern, rule.pattern, cases);
      if (!s.ok) continue;
      // Prefer name-aligned template; else accept high F1 infer
      if (nameHit || s.f1 >= 0.99) {
        chosen = { tid, ...s };
        chosenCases = cases;
        if (nameHit) break;
      }
    }

    if (!chosen) {
      rejected.push({ id: rule.id, name: rule.name, reason: "sem seed com P≥0.85" });
      continue;
    }

    selected.add(rule.id);
    promoted.push({
      id: rule.id,
      sonarKey: rule.sonarKey,
      template: chosen.tid,
      prec: Number(chosen.prec.toFixed(3)),
      f1: Number(chosen.f1.toFixed(3)),
    });

    for (const [i, c] of chosenCases.entries()) {
      const id = `sonar-${rule.id}-${c.expected}-${i + 1}`;
      if (goldenIds.has(id)) continue;
      goldenIds.add(id);
      newGolden.push({
        id,
        ruleId: rule.id,
        expected: c.expected,
        code: c.code,
        ...(c.profile ? { profile: c.profile } : {}),
        note: `esteira sonar:engenharia · template ${chosen.tid}`,
      });
    }
  }

  curation.selecao = [...selected].sort((a, b) => a.localeCompare(b));
  await writeFile(join(DATA, "sonarWayCuration.json"), JSON.stringify(curation, null, 2) + "\n");

  if (newGolden.length) {
    await writeFile(GOLDEN, JSON.stringify([...golden, ...newGolden], null, 2) + "\n");
  }

  console.log("sonar:live…");
  nodeScript("scripts/build-sonar-live.mjs");

  // rebuild contracts so RULES includes new live ports for golden tests
  console.log("build:contracts…");
  buildContracts();

  const result = {
    generatedAt: new Date().toISOString(),
    promoted: promoted.length,
    rejected: rejected.length,
    promotedIds: promoted,
    rejectedSample: rejected.slice(0, 50),
    goldenAdded: newGolden.length,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "sonar-way-promote.json"), JSON.stringify(result, null, 2));
  console.log(
    `Promote: +${promoted.length} VULN na curadoria · ${rejected.length} rejeitadas · +${newGolden.length} casos golden`,
  );
  return result;
}

async function liveReport() {
  const catalog = await loadJson(join(DATA, "sonarWayRules.json"));
  const curation = await loadJson(join(DATA, "sonarWayCuration.json"));
  const selected = new Set(curation.selecao);

  const tally = (pred) => {
    const rows = catalog.filter(pred);
    const live = rows.filter((r) => selected.has(r.id));
    const genPort = rows.filter((r) => r.implementation === "sonar-port");
    return {
      total: rows.length,
      stub: rows.filter((r) => r.implementation === "stub").length,
      genSonarPort: genPort.length,
      liveCurated: live.length,
      livePct: rows.length ? Math.round((live.length / rows.length) * 1000) / 10 : 0,
    };
  };

  const report = {
    generatedAt: new Date().toISOString(),
    note: "live scannable = id ∈ sonarWayCuration.selecao (o que o motor carrega). Stub no catálogo não conta.",
    all: tally(() => true),
    vulnerability: tally((r) => r.type === "VULNERABILITY"),
    bug: tally((r) => r.type === "BUG"),
    codeSmell: tally((r) => r.type === "CODE_SMELL"),
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "sonar-way-live-scannable.json"), JSON.stringify(report, null, 2));
  console.log(
    `Live scannable: all ${report.all.liveCurated}/${report.all.total} (${report.all.livePct}%) · VULN ${report.vulnerability.liveCurated}/${report.vulnerability.total} (${report.vulnerability.livePct}%)`,
  );
  return report;
}

async function all() {
  await prioritize();
  await smellPolicy();
  await promoteFixed();
  await liveReport();
  console.log("sonar:compare…");
  nodeScript("scripts/compare-sonar-way.mjs");
}

const arg = process.argv[2] ?? "default";

const runners = {
  prioritize,
  "smell-policy": smellPolicy,
  promote: promoteFixed,
  report: liveReport,
  all,
  default: async () => {
    await prioritize();
    await smellPolicy();
    await liveReport();
  },
};

const run = runners[arg];
if (!run) {
  console.error(`uso: sonar-way-engenharia.mjs [${Object.keys(runners).join("|")}]`);
  process.exit(2);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
