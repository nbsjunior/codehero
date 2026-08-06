#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
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
import { buildCopybookIndex } from "./copybooks.ts";
import { buildSemanticIndex, EMPTY_SEMANTIC_INDEX, expandCopybooks } from "@codehero/engine";
import { importSarifFiles, type ImportSummary, type ImportedFinding } from "./importSarif.ts";
import { buildSarif } from "./sarif.ts";
import { loadRulesFile, resolveActiveRules } from "./fetchRules.ts";
import { runJoernScan } from "@codehero/cpg-joern";
import { scoreFinding, DEFAULT_MODEL } from "@codehero/fp-ranker";
import { collectExternalSarifs } from "./externalTools.ts";
import { colapsaEcoEntreFerramentas } from "./dedupeCrossTool.ts";

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
  semantic: boolean;
  copybooks: string[];
  importSarif: string[];
  /** Opt-in CPG via Joern (JVM/Docker). */
  joern: boolean;
  withOxlint: boolean;
  withEslint: boolean;
  withSemgrep: boolean;
  withOpengrep: boolean;
  withPmd: boolean;
  withSpotbugs: boolean;
  spotbugsClasses: string | null;
  withSca: boolean;
  scaTool: "trivy" | "osv";
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
    semantic: false,
    copybooks: [],
    importSarif: [],
    joern: false,
    withOxlint: false,
    withEslint: false,
    withSemgrep: false,
    withOpengrep: false,
    withPmd: false,
    withSpotbugs: false,
    spotbugsClasses: null,
    withSca: false,
    scaTool: "trivy",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") opts.out = argv[++i] ?? null;
    else if (a === "--format" || a === "-f") opts.format = (argv[++i] as CliOptions["format"]) ?? "pretty";
    else if (a === "--fail-on") opts.failOn = (argv[++i] as Severity) ?? null;
    else if (a === "--sarif") opts.format = "sarif";
    else if (a === "--cache") opts.cache = true;
    else if (a === "--metrics") opts.metrics = true;
    else if (a === "--semantic") { opts.semantic = true; opts.metrics = true; }
    else if (a === "--joern") opts.joern = true;
    else if (a === "--with-oxlint") opts.withOxlint = true;
    else if (a === "--with-eslint") opts.withEslint = true;
    else if (a === "--with-pmd") opts.withPmd = true;
    else if (a === "--with-spotbugs") opts.withSpotbugs = true;
    else if (a === "--spotbugs-classes") opts.spotbugsClasses = argv[++i] ?? null;
    else if (a === "--with-semgrep") opts.withSemgrep = true;
    else if (a === "--with-opengrep") opts.withOpengrep = true;
    else if (a === "--with-sca") opts.withSca = true;
    else if (a === "--sca-tool") {
      const v = (argv[++i] ?? "trivy").toLowerCase();
      opts.scaTool = v === "osv" ? "osv" : "trivy";
    }
    else if (a === "--copybook") {
      const v = argv[++i];
      if (v) opts.copybooks.push(v);
    }
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

  // Copybook: sem expandir, o analisador ve `COPY CLIENTE.` e mais nada. Ele
  // nao esta analisando o programa, esta analisando um pedaco — e nao sabe qual
  // pedaco falta. Qualquer numero tirado dai (campo nao usado, tipo de host
  // variable) seria ficcao.
  const copybooks = buildCopybookIndex(opts.copybooks);
  const copyStats = { arquivos: 0, resolvidos: 0, ausentes: new Set<string>(), linhas: 0, ciclos: 0 };
  const origensPorArquivo = new Map<string, Array<{ file: string; line: number; depth: number }>>();

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    linesOfCode += source.length ? source.split("\n").length : 0;
    const rel = relative(cwd, file) || file;

    if (/\.(cbl|cob|cpy)$/i.test(file)) {
      const exp = expandCopybooks(source, { file: rel, resolver: copybooks });
      copyStats.arquivos++;
      copyStats.resolvidos += exp.resolved.length;
      for (const m of exp.missing) copyStats.ausentes.add(m);
      copyStats.linhas += exp.expandedLines;
      copyStats.ciclos += exp.cycles.length;

      for (const f of analyzeSource(rel, exp.source, rules)) {
        // Remapeia para a origem: sem isto o achado apontaria para a linha
        // DESLOCADA, e "campo na linha 380" num programa de 200 linhas destroi
        // a confianca no relatorio inteiro.
        const o = exp.origins[f.startLine - 1];
        findings.push(o ? { ...f, file: o.file, startLine: o.line } : f);
      }
      if (opts.metrics) {
        paraMetricas.push({ path: rel, source: exp.source });
        // O mapa precisa sobreviver ate DEPOIS das metricas: as analises COBOL
        // rodam sobre o fonte EXPANDIDO, e sem remapear elas apontariam para a
        // linha deslocada — mesmo defeito que o mapa existe para evitar.
        // Chave normalizada: `computeFileMetrics` troca `\` por `/`, e no
        // Windows o caminho relativo vem com `\` — sem normalizar dos dois
        // lados a busca nunca casa e o remapeamento vira no-op silencioso.
        origensPorArquivo.set(rel.split("\\").join("/"), exp.origins);
      }
      continue;
    }

    for (const f of analyzeSource(rel, source, rules)) findings.push(f);
    if (opts.metrics) paraMetricas.push({ path: rel, source });
  }

  if (copyStats.arquivos > 0 && copyStats.ausentes.size > 0) {
    process.stderr.write(
      `CodeHero: ${copyStats.ausentes.size} copybook(s) nao encontrado(s) — a analise esta INCOMPLETA: ` +
        `${[...copyStats.ausentes].slice(0, 8).join(", ")}${copyStats.ausentes.size > 8 ? "..." : ""}\n` +
        `  Informe o diretorio com --copybook <dir>\n`,
    );
  }

  // Camada semântica: resolve TIPO, não forma. Custa segundos (monta o Program
  // do TypeScript inteiro), contra milissegundos do tree-sitter — por isso é
  // pedida explicitamente e nunca ligada por padrão.
  const semantic =
    opts.metrics && opts.semantic
      ? await buildSemanticIndex(
          paraMetricas.map((f) => f.path),
          { cwd },
        )
      : EMPTY_SEMANTIC_INDEX;
  if (opts.semantic && semantic.stats.files === 0) {
    process.stderr.write(
      "CodeHero: camada semantica indisponivel (typescript ausente ou nenhum arquivo TS/JS); regras que exigem tipo ficarao em silencio\n",
    );
  }

  const structural: StructuralSummary | null = opts.metrics
    ? await collectStructural(paraMetricas, undefined, semantic)
    : null;

  // Remapeia os achados que sairam do fonte EXPANDIDO para o arquivo de origem.
  // Sem isto, "campo morto na linha 9" aponta para o meio do programa quando o
  // campo esta na linha 4 de um copybook.
  if (structural) {
    const remapear = <T extends { file: string; startLine: number }>(f: T): T => {
      const origens = origensPorArquivo.get(f.file.split("\\").join("/"));
      const o = origens?.[f.startLine - 1];
      return o ? { ...f, file: o.file, startLine: o.line } : f;
    };
    structural.cobolFindings = structural.cobolFindings.map(remapear);
    structural.ruleFindings = structural.ruleFindings.map(remapear);
  }

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
  // Presence Pack: --with-oxlint / --with-opengrep / --with-semgrep / --with-sca (soft-fail).
  // --joern (opt-in): CPG interprocedural via Joern → mesmo caminho --import.
  const importPaths = [...opts.importSarif];
  const querAlgumExterno =
    opts.withOxlint ||
    opts.withEslint ||
    opts.withOpengrep ||
    opts.withSemgrep ||
    opts.withPmd ||
    opts.withSpotbugs ||
    opts.withSca;
  if (querAlgumExterno) {
    const ext = collectExternalSarifs({
      oxlint: opts.withOxlint,
      eslint: opts.withEslint,
      opengrep: opts.withOpengrep,
      semgrep: opts.withSemgrep,
      pmd: opts.withPmd,
      spotbugs: opts.withSpotbugs,
      spotbugsClasses: opts.spotbugsClasses ?? undefined,
      sca: opts.withSca,
      scaTool: opts.scaTool,
      // O ALVO do scan, nao o diretorio de trabalho. Passar `cwd` fazia toda
      // ferramenta externa analisar a raiz do repositorio enquanto o CodeHero
      // analisava o subcaminho pedido — e o ESLint chegava a nao rodar por nao
      // achar config no lugar errado. O `--joern` ja usava paths[0]; o Presence
      // Pack nao.
      cwd: resolve(opts.paths[0] ?? "."),
    });
    for (const log of ext.logs) {
      if (log.ok) {
        process.stderr.write(`CodeHero: ${log.tool} → ${log.sarifPath}\n`);
      } else {
        process.stderr.write(
          `CodeHero: ${log.tool} indisponível — ${log.hint ?? log.stderr ?? "falha"}\n`,
        );
      }
    }
    importPaths.push(...ext.paths);
  }
  if (opts.joern) {
    const root = opts.paths[0] ?? ".";
    const jr = runJoernScan({ sourceRoot: root });
    if (!jr.ok || !jr.sarifPath) {
      process.stderr.write(
        `CodeHero: --joern falhou (${jr.backend}): ${jr.hint ?? jr.stderr}\n`,
      );
    } else {
      process.stderr.write(
        `CodeHero: Joern CPG (${jr.backend}) → ${jr.findingsApprox} finding(s)\n`,
      );
      importPaths.push(jr.sarifPath);
    }
  }

  const imported: ImportSummary | null =
    importPaths.length > 0 ? importSarifFiles(importPaths) : null;
  if (imported?.failed.length) {
    process.stderr.write(
      `CodeHero: nao foi possivel ler como SARIF: ${imported.failed.join(", ")}
`,
    );
  }

  // ECO ENTRE FERRAMENTAS. A dedup do motor cobre so os achados nativos; os
  // importados entravam por fora e o mesmo problema aparecia duas vezes.
  // Medido: `eval()` reportado por SONAR-js-S5334 e por EXT:eslint:no-eval, e
  // o mesmo `==` nas colunas 8 e 9 — 5 apontamentos para 3 problemas.
  //
  // Granularidade de LINHA, nao de coluna: ferramentas diferentes ancoram o
  // mesmo problema em colunas diferentes (o operador, o token anterior, o
  // inicio da expressao). Exigir coluna igual nao colapsaria nada.
  //
  // Nada se perde: quem sobrevive carrega os ids absorvidos, entao o rastro de
  // conformidade continua completo. Orquestrar sem isto so multiplica ruido —
  // e ai juntar ferramentas piora o produto em vez de melhorar.
  const importadosFiltrados = colapsaEcoEntreFerramentas(findings, imported?.findings ?? [], cwd);
  if (imported && importadosFiltrados.absorvidos > 0) {
    process.stderr.write(
      `CodeHero: ${importadosFiltrados.absorvidos} apontamento(s) de terceiros ja cobertos por regra propria na mesma linha\n`,
    );
  }

  const sarif = buildSarif(findings, coverage, linesOfCode, structural, importadosFiltrados.restantes);

  // Assertividade (ranqueador FP): anota properties no SARIF — determinístico.
  //
  // O modelo tem 12 atributos e o scanner informava 6: complexidade e churn
  // ficavam sempre em zero, então metade dos stumps era constante. Os de
  // complexidade saem das métricas estruturais (quando --metrics), o churn sai
  // do git numa passada só.
  const churn = fileChurn(cwd);
  const metricasPorArquivo = new Map(
    (structural?.files ?? []).map((m) => [m.file.replace(/\\/g, "/"), m]),
  );

  for (const run of sarif.runs ?? []) {
    for (const r of run.results ?? []) {
      const file = r.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "";
      const linha = r.locations?.[0]?.physicalLocation?.region?.startLine ?? 0;
      const fm = metricasPorArquivo.get(file);
      // A função que CONTÉM o achado descreve melhor o entorno que a média do
      // arquivo: um achado numa função trivial dentro de um arquivo complexo
      // não herda a complexidade do vizinho.
      const fn = fm?.functions.find((f) => linha >= f.startLine && linha <= f.endLine);
      const score = scoreFinding(DEFAULT_MODEL, {
        ruleId: r.ruleId,
        file,
        severity: r.properties?.severity,
        engine: r.properties?.engine ?? null,
        tool: r.properties?.tool ?? (String(r.ruleId || "").startsWith("EXT:") ? String(r.ruleId).split(":")[1] : null),
        findingSource: r.properties?.source === "imported" ? "imported" : "native",
        cyclomatic: fn?.cyclomatic,
        cognitive: fn?.cognitive,
        nesting: fn?.maxNesting,
        fileChurn: churn.get(file),
        taintPathLength: Array.isArray((r.properties as { taintPath?: string[] } | undefined)?.taintPath)
          ? ((r.properties as { taintPath: string[] }).taintPath.length)
          : typeof (r.properties as { taintPathLength?: number } | undefined)?.taintPathLength === "number"
            ? (r.properties as { taintPathLength: number }).taintPathLength
            : undefined,
        outlierScore:
          typeof r.properties?.outlierScore === "number" ? r.properties.outlierScore : undefined,
        familySize: typeof r.properties?.familySize === "number" ? r.properties.familySize : undefined,
      });
      r.properties = {
        ...r.properties,
        assertiveness: Math.round(score.assertiveness * 1000) / 1000,
        fpLikelihood: Math.round(score.fpLikelihood * 1000) / 1000,
        rankerModel: score.modelVersion,
      };
    }
  }

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
      semantic.stats,
      copyStats,
    );
    if (opts.out) writeFileSync(opts.out, JSON.stringify(sarif, null, 2));
  }

  if (opts.failOn) {
    const threshold = SEV_ORDER.indexOf(opts.failOn);
    // Achado importado PARTICIPA do gate: ingerir CodeQL sem deixar o
    // resultado reprovar o build nao serviria para nada.
    // SECURITY_HOTSPOT nao reprova o build — e a mesma semantica do Sonar.
    //
    // Hotspot e a classificacao para "precisa de revisao humana, a ferramenta
    // NAO tem como decidir". `new RegExp(variavel)` e ReDoS quando a variavel
    // vem de fora e operacao normal quando vem de configuracao confiavel; o L0
    // nao distingue. Reprovar o build nesses casos treina o time a ignorar o
    // vermelho, que e pior do que nao ter gate.
    //
    // Eles continuam no relatorio e no SARIF: some do gate, nao da vista.
    const worst = [
      ...findings.filter((f) => f.rule.type !== "SECURITY_HOTSPOT").map((f) => f.rule.severity),
      ...(imported?.findings.map((f) => f.severity) ?? []),
    ].reduce((acc, sev) => Math.max(acc, SEV_ORDER.indexOf(sev)), -1);
    if (worst >= threshold) process.exitCode = 1;
  }
}

/**
 * Commits que tocaram cada arquivo no ultimo ano.
 *
 * Arquivo que muda toda semana concentra achado real; arquivo parado ha anos
 * que dispara uma regra nova costuma ser falso positivo. E o unico atributo do
 * ranqueador que nao esta no codigo — esta na historia dele.
 *
 * Uma chamada de git para o repo inteiro, nao uma por arquivo. Se nao houver
 * git (tarball, container sem .git), devolve vazio e o atributo fica em zero —
 * degradar e melhor que falhar o scan por causa de metrica auxiliar.
 */
function fileChurn(cwd: string): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const r = spawnSync("git", ["log", "--since=1.year", "--name-only", "--pretty=format:"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0 || !r.stdout) return out;
    for (const linha of r.stdout.split(/\r?\n/)) {
      const f = linha.trim();
      if (!f) continue;
      out.set(f, (out.get(f) ?? 0) + 1);
    }
  } catch {
    /* sem git: segue sem o atributo */
  }
  return out;
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
  semanticStats: { files: number; calls: number; ms: number } | null = null,
  copyStats: { arquivos: number; resolvidos: number; ausentes: Set<string>; linhas: number; ciclos: number } | null = null,
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
  if (copyStats && copyStats.arquivos > 0) {
    const cobertura =
      copyStats.resolvidos + copyStats.ausentes.size > 0
        ? Math.round((copyStats.resolvidos / (copyStats.resolvidos + copyStats.ausentes.size)) * 100)
        : 100;
    process.stdout.write(
      `Copybooks: ${copyStats.resolvidos} resolvido(s), ${copyStats.ausentes.size} ausente(s)` +
        ` (${cobertura}% de cobertura) | ${copyStats.linhas} linha(s) trazida(s)` +
        (copyStats.ciclos > 0 ? ` | ${copyStats.ciclos} ciclo(s)` : "") + "\n",
    );
  }
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
    if (semanticStats && semanticStats.files > 0) {
      process.stdout.write(
        `Camada semantica: ${semanticStats.calls} chamada(s) com tipo resolvido` +
          ` em ${semanticStats.files} arquivo(s) (${(semanticStats.ms / 1000).toFixed(1)}s)\n`,
      );
    }
    if (structural.cobolFindings.length > 0) {
      const porAnalise = new Map<string, number>();
      for (const f of structural.cobolFindings)
        porAnalise.set(f.analysis.id, (porAnalise.get(f.analysis.id) ?? 0) + 1);
      process.stdout.write(
        `Analises COBOL (arvore inteira do programa): ${structural.cobolFindings.length} apontamento(s)` + "\n",
      );
      for (const [id, n] of [...porAnalise].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${String(n).padStart(4)}  ${id}` + "\n");
      }
      for (const f of structural.cobolFindings.slice(0, 10)) {
        process.stdout.write(
          `        ${f.file}:${f.startLine}  ${f.detail}` + "\n",
        );
      }
    }
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
        `  (${structural.skippedLanguages} arquivo(s) sem parser estrutural — DB2 dedicado, VB.Net)\n`,
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
