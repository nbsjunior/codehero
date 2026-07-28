#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
  RULES,
  technicalDebtMinutes,
  formatDebt,
  type HeroRule,
  type Severity,
} from "@codehero/contracts";
import { analyzeSource, enableScanCache, type Finding } from "./engine.ts";
import { collectFiles } from "./walk.ts";
import { loadIgnoreFile, makeIgnoreMatcher, IGNORE_FILE } from "./ignore.ts";
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
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") opts.out = argv[++i] ?? null;
    else if (a === "--format" || a === "-f") opts.format = (argv[++i] as CliOptions["format"]) ?? "pretty";
    else if (a === "--fail-on") opts.failOn = (argv[++i] as Severity) ?? null;
    else if (a === "--sarif") opts.format = "sarif";
    else if (a === "--cache") opts.cache = true;
    else if (a === "--rules-file") opts.rulesFile = argv[++i] ?? null;
    else if (a === "--no-fetch-rules") opts.fetchRules = false;
    else if (a === "--server") opts.serverUrl = argv[++i] ?? null;
    else if (a === "--token") opts.token = argv[++i] ?? null;
    else if (a === "--org") opts.orgId = argv[++i] ?? null;
    else if (a === "--project") opts.projectId = argv[++i] ?? null;
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

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(cwd, file) || file;
    for (const f of analyzeSource(rel, source, rules)) findings.push(f);
  }

  const sarif = buildSarif(findings);

  if (opts.format === "sarif") {
    const json = JSON.stringify(sarif, null, 2);
    if (opts.out) writeFileSync(opts.out, json);
    else process.stdout.write(json + "\n");
  } else {
    printPretty(findings, files.length, rules.length, meta, ignorePatterns.length);
    if (opts.out) writeFileSync(opts.out, JSON.stringify(sarif, null, 2));
  }

  if (opts.failOn) {
    const threshold = SEV_ORDER.indexOf(opts.failOn);
    const worst = findings.reduce(
      (acc, f) => Math.max(acc, SEV_ORDER.indexOf(f.rule.severity)),
      -1,
    );
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
