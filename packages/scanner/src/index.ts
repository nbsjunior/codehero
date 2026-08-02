#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
  RULES,
  mergeCoverageReports,
  coveragePercent,
  type CoverageReport,
  technicalDebtMinutes,
  formatDebt,
  type HeroRule,
  type Severity,
} from "@codehero/contracts";
import { analyzeSource, enableScanCache, type Finding } from "./engine.ts";
import { collectFiles } from "./walk.ts";
import { loadIgnoreFile, makeIgnoreMatcher, IGNORE_FILE } from "./ignore.ts";
import { parseCoverageFile } from "./coverage.ts";
import { collectStructural, type StructuralSummary } from "./metrics.ts";
import { importSarifFiles, type ImportSummary } from "./importSarif.ts";
import { buildSarif } from "./sarif.ts";
import { loadRulesFile, resolveActiveRules } from "./fetchRules.ts";

interface CliOptions {
  paths: string[];
  out: string | null;
  format: "sarif" | "pretty";
  failOn: Severity | null;
  cache: boolean;
  rulesFile: string | null;
  fetchRules: boolean;
  serverUrl: string | null;
  token: string | null;
  orgId: string | null;
  projectId: string | null;
  ignore: string[];
  coverage: string[];
  metrics: boolean;
  importSarif: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    paths: [],
    out: null,
    format: "pretty",
    failOn: null,
    cache: false,
    rulesFile: null,
    fetchRules: true,
    serverUrl: null,
    token: null,
    orgId: null,
    projectId: null,
    ignore: [],
    coverage: [],
    metrics: false,
    importSarif: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") opts.out = argv[++i] ?? null;
    else if (a === "--format" || a === "-f") opts.format = (argv[++i] as CliOptions["format"]) ?? "pretty";
    else if (a === "--fail-on") opts.failOn = (argv[++i] as Severity) ?? null;
    else if (a === "--sarif") opts.format = "sarif";
    else if (a === "--cache") opts.cache = true;
    else if (a === "--metrics") opts.metrics = true;
    else if (a === "--import") {
      const v = argv[++i];
      if (v) opts.importSarif.push(v);
    }
    else if (a === "--rules-file") opts.rulesFile = argv[++i] ?? null;
    else if (a === "--no-fetch-rules") opts.fetchRules = false;
    else if (a === "--server") opts.serverUrl = argv[++i] ?? null;
    else if (a === "--token") opts.token = argv[++i] ?? null;
    else if (a === "--org") opts.orgId = argv[++i] ?? null;
    else if (a === "--project") opts.projectId = argv[++i] ?? null;
    else if (a === "--coverage") {
      const v = argv[++i];
      if (v) opts.coverage.push(v);
    }
    else if (a === "--ignore") {
      const v = argv[++i];
      if (v) opts.ignore.push(v);
    }
    else if (a?.startsWith("-")) continue;
    else if (a) opts.paths.push(a);
  }
  if (opts.paths.length === 0) opts.paths.push(".");
  return opts;
}

const SEV_ORDER: Severity[] = ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"];

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.cache) enableScanCache();

  const { rules, meta } = await loadRules(opts);
  const cwd = process.cwd();
  // CLI patterns stack on top of .codeheroignore rather than replacing it.
  const ignorePatterns = [...loadIgnoreFile(cwd), ...opts.ignore];
  const files = collectFiles(opts.paths, makeIgnoreMatcher(ignorePatterns));
  const findings: Finding[] = [];
  let linesOfCode = 0;

  // Guardado só quando --metrics: manter o fonte de todo o repo na memória sem
  // necessidade seria desperdício num scan de 20 mil arquivos.
  const paraMetricas: Array<{ path: string; source: string }> = [];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    linesOfCode += source.length ? source.split("\n").length : 0;
    const rel = relative(cwd, file) || file;
    for (const f of analyzeSource(rel, source, rules)) findings.push(f);
    if (opts.metrics) paraMetricas.push({ path: rel, source });
  }

  const structural: StructuralSummary | null = opts.metrics
    ? await collectStructural(paraMetricas)
    : null;

  // Cobertura é INGERIDA, não calculada: cada caminho é um relatório que o
  // test runner já produziu. Vários são aceitos (monorepo com um por pacote).
  const coverageReports = opts.coverage
    .map((p) => parseCoverageFile(p))
    .filter((r): r is CoverageReport => r !== null);
  if (opts.coverage.length > 0 && coverageReports.length === 0) {
    process.stderr.write(
      `CodeHero: nenhum relatório de cobertura pôde ser lido de ${opts.coverage.join(", ")}
`,
    );
  }
  const coverage = mergeCoverageReports(coverageReports);

  // Terceiros: CodeQL/Semgrep cobrem fluxo entre arquivos que o L0 nao alcanca;
  // osv-scanner/trivy cobrem dependencia, eixo que analise de codigo nao ve.
  const imported: ImportSummary | null =
    opts.importSarif.length > 0 ? importSarifFiles(opts.importSarif) : null;
  if (imported?.failed.length) {
    process.stderr.write(
      `CodeHero: nao foi possivel ler como SARIF: ${imported.failed.join(", ")}
`,
    );
  }

  const sarif = buildSarif(findings, coverage, linesOfCode, structural, imported?.findings);

  if (opts.format === "sarif") {
    const json = JSON.stringify(sarif, null, 2);
    if (opts.out) writeFileSync(opts.out, json);
    else process.stdout.write(json + "\n");
  } else {
    printPretty(
      findings,
      files.length,
      rules.length,
      meta,
      ignorePatterns.length,
      coverage,
      structural,
      imported,
    );
    if (opts.out) writeFileSync(opts.out, JSON.stringify(sarif, null, 2));
  }

  if (opts.failOn) {
    const threshold = SEV_ORDER.indexOf(opts.failOn);
    // Achado importado PARTICIPA do gate: ingerir CodeQL sem deixar o
    // resultado reprovar o build nao serviria para nada.
    const worst = [
      ...findings.map((f) => f.rule.severity),
      ...(imported?.findings.map((f) => f.severity) ?? []),
    ].reduce((acc, sev) => Math.max(acc, SEV_ORDER.indexOf(sev)), -1);
    if (worst >= threshold) process.exitCode = 1;
  }
}

async function loadRules(opts: CliOptions): Promise<{ rules: HeroRule[]; meta: string }> {
  if (opts.rulesFile) {
    return { rules: loadRulesFile(opts.rulesFile), meta: `file:${opts.rulesFile}` };
  }
  if (!opts.fetchRules) {
    return { rules: RULES, meta: "bundled (fetch disabled)" };
  }
  const bundle = await resolveActiveRules({
    serverUrl: opts.serverUrl ?? undefined,
    token: opts.token ?? undefined,
    orgId: opts.orgId ?? undefined,
    projectId: opts.projectId ?? undefined,
  });
  return {
    rules: bundle.rules,
    meta: `${bundle.source} v=${bundle.version} overlays=${bundle.overlayCount ?? "?"}`,
  };
}

function printPretty(
  findings: Finding[],
  fileCount: number,
  ruleCount: number,
  meta: string,
  ignoreCount = 0,
  coverage: CoverageReport | null = null,
  structural: StructuralSummary | null = null,
  imported: ImportSummary | null = null,
): void {
  const bySev = new Map<Severity, number>();
  for (const f of findings) bySev.set(f.rule.severity, (bySev.get(f.rule.severity) ?? 0) + 1);

  for (const f of findings) {
    process.stdout.write(
      `${sevBadge(f.rule.severity)} ${f.file}:${f.startLine}:${f.startColumn}  ${f.rule.id}\n` +
        `    ${f.rule.message}\n` +
        `    > ${f.snippet}\n`,
    );
  }

  const debtMin = technicalDebtMinutes(
    findings.filter((f) => f.rule.type === "CODE_SMELL").map((f) => f.rule.remediationEffortMin),
  );

  process.stdout.write(`\n${"─".repeat(60)}\n`);
  process.stdout.write(
    `CodeHero — ${findings.length} finding(s) em ${fileCount} arquivo(s) | ${ruleCount} regra(s) | ${meta}\n`,
  );
  const summary = [...bySev.entries()]
    .sort((a, b) => SEV_ORDER.indexOf(b[0]) - SEV_ORDER.indexOf(a[0]))
    .map(([s, n]) => `${s}: ${n}`)
    .join("  ");
  if (summary) process.stdout.write(summary + "\n");
  process.stdout.write(`Débito técnico (code smells): ${formatDebt(debtMin)}\n`);
  if (coverage) {
    const branch = coverage.branches ? ` · branch ${coveragePercent(coverage.branches)}%` : "";
    process.stdout.write(
      `Cobertura (${coverage.format}): linha ${coveragePercent(coverage.lines)}%` +
        `${branch} em ${coverage.files.length} arquivo(s)\n`,
    );
  }
  if (structural) {
    const t = structural.totals;
    process.stdout.write(
      `Complexidade: ${t.functions} função(ões) | ciclomática média ${t.avgCyclomatic}` +
        ` (máx ${t.maxCyclomatic}) | cognitiva média ${t.avgCognitive}` +
        ` | aninhamento máx ${t.maxNesting} | comentários ${t.commentDensity}%\n`,
    );
    if (structural.ruleFindings.length > 0) {
      const porRegra = new Map<string, number>();
      for (const f of structural.ruleFindings)
        porRegra.set(f.rule.id, (porRegra.get(f.rule.id) ?? 0) + 1);
      process.stdout.write(
        `Regras estruturais (avaliam a arvore): ${structural.ruleFindings.length} apontamento(s)
`,
      );
      for (const [id, n] of [...porRegra].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${String(n).padStart(4)}  ${id}
`);
      }
    }
    const d = structural.duplication;
    process.stdout.write(
      `Duplicação: ${d.percent}% (${d.duplicatedLines} de ${d.totalLines} linhas)` +
        ` em ${d.groups.length} bloco(s) repetido(s)\n`,
    );
    if (structural.skippedLanguages > 0) {
      process.stdout.write(
        `  (${structural.skippedLanguages} arquivo(s) sem gramática estrutural — COBOL, T-SQL, DB2, VB.Net)\n`,
      );
    }
    if (structural.parseErrors.length > 0) {
      process.stdout.write(
        `  (${structural.parseErrors.length} arquivo(s) com erro de sintaxe — métrica omitida)\n`,
      );
    }
  }
  if (imported && imported.findings.length > 0) {
    const porFerramenta = Object.entries(imported.byTool)
      .map(([t, n]) => `${t}: ${n}`)
      .join(" · ");
    const dep = imported.findings.filter((f) => f.isDependency).length;
    process.stdout.write(
      `Importado de terceiros: ${imported.findings.length} apontamento(s) — ${porFerramenta}\n`,
    );
    if (dep > 0) {
      process.stdout.write(`  dos quais ${dep} em dependência (SCA), não em código autoral\n`);
    }
  }
}

function sevBadge(sev: Severity): string {
  const map: Record<Severity, string> = {
    BLOCKER: "[BLOCKER]",
    CRITICAL: "[CRITICAL]",
    MAJOR: "[MAJOR ]",
    MINOR: "[MINOR ]",
    INFO: "[INFO  ]",
  };
  return map[sev];
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
