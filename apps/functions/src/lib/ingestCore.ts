import { FieldValue } from "firebase-admin/firestore";
import {
  technicalDebtMinutes,
  technicalDebtRatio,
  maintainabilityRating,
  ratingFromWorstSeverity,
  evaluateQualityGate,
  mergeQualityGate,
  SEVERITIES,
  type Severity,
  type QualityGateThresholds,
  coveragePercent as coveragePct,
  type CoverageCounter,
  type SarifLog,
  type SarifResult,
} from "@codehero/contracts";
import { scoreFinding, DEFAULT_MODEL } from "@codehero/fp-ranker";
import { db, repoRef } from "./firebase.ts";
import { recomputeProjectAggregate } from "./projectAggregate.ts";
import { recordAnalysisAnalytics } from "./analytics.ts";
import { annotateGateSuppression, loadRuleFpStats } from "./ruleFpStats.ts";

export interface PersistAnalysisInput {
  orgId: string;
  projectId: string;
  repoId: string;
  results: SarifResult[];
  branch: string;
  commit?: string | null;
  linesOfCode: number;
  newCodeFingerprints?: string[];
  sarifPath?: string | null;
  source: "github-action" | "auto-scan" | "cli";
  /** Stable key so CI retries do not create duplicate analyses. */
  idempotencyKey?: string | null;
  /** When true, only write analysis/repo metrics — issues go to ingestJobs worker. */
  deferIssueWrites?: boolean;
  /** Cobertura medida no build; `null`/ausente pula a condição do gate. */
  coveragePercent?: number | null;
  /** Duplicação medida (--metrics); `null`/ausente pula a condição. */
  duplicationPercent?: number | null;
  /** Branch % (JaCoCo/JCov/lcov); null/0 pula a condição. */
  branchCoveragePercent?: number | null;
  /** Resumo do code-graph (SARIF run properties). */
  codeGraph?: Record<string, unknown> | null;
  /** Leitura arquitetural: acoplamento por módulo, ciclos, risco. */
  arquitetura?: Record<string, unknown> | null;
  analysisId?: string;
  /** Per-project gate thresholds (merged with defaults when omitted). */
  qualityGateThresholds?: QualityGateThresholds | null;
}

export interface PersistAnalysisResult {
  analysisId: string;
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    /** Contagem por tipo (CODE_SMELL, BUG, …) — base da série histórica de smells. */
    byType: Record<string, number>;
    codeSmellCount: number;
    debtMinutes: number;
    debtRatio: number;
    maintainabilityRating: string;
    securityRating: string;
    qualityGate: { status: "PASSED" | "FAILED"; failedConditions: string[] };
  };
}

/**
 * Extrai o percentual de cobertura das `properties` do run do SARIF, onde o
 * scanner o deposita. Ausente → `null`, que o gate trata como não medido.
 */
/**
 * Duplicação das `properties` do run. Ausente → `null` (não medida), que o
 * gate pula — mesma semântica da cobertura.
 */
export function duplicationFromSarif(sarif: SarifLog): number | null {
  const raw = (sarif.runs?.[0] as { properties?: { duplication?: { percent?: number } } })
    ?.properties?.duplication?.percent;
  return typeof raw === "number" ? raw : null;
}

export function coverageFromSarif(sarif: SarifLog): number | null {
  const raw = (sarif.runs?.[0] as { properties?: { coverage?: { lines?: CoverageCounter } } })
    ?.properties?.coverage?.lines;
  if (!raw || typeof raw.total !== "number" || raw.total <= 0) return null;
  return coveragePct(raw);
}

/**
 * Branch coverage % from SARIF run properties (JaCoCo/JCov/lcov BRF). Null
 * when absent — the gate only applies minBranchCoverage when data exists.
 */
export function branchCoverageFromSarif(sarif: SarifLog): number | null {
  const raw = (
    sarif.runs?.[0] as { properties?: { coverage?: { branches?: CoverageCounter } } }
  )?.properties?.coverage?.branches;
  if (!raw || typeof raw.total !== "number" || raw.total <= 0) return null;
  return coveragePct(raw);
}

/** Resumo do code-graph determinístico (run properties). */
export function codeGraphFromSarif(sarif: SarifLog): Record<string, unknown> | null {
  const raw = sarif.runs?.[0]?.properties?.codeGraph;
  if (!raw || typeof raw !== "object") return null;
  const g = raw as {
    version?: number;
    nodes?: number;
    edges?: number;
    functions?: number;
    calls?: number;
    imports?: number;
    entries?: number;
    hotspots?: unknown;
    links?: unknown;
    generatedAt?: string;
  };
  if (typeof g.functions !== "number" && typeof g.nodes !== "number") return null;
  return {
    version: 1,
    generatedAt: typeof g.generatedAt === "string" ? g.generatedAt : new Date().toISOString(),
    nodes: Number(g.nodes) || 0,
    edges: Number(g.edges) || 0,
    functions: Number(g.functions) || 0,
    calls: Number(g.calls) || 0,
    imports: Number(g.imports) || 0,
    entries: Number(g.entries) || 0,
    hotspots: Array.isArray(g.hotspots) ? g.hotspots.slice(0, 40) : [],
    links: Array.isArray(g.links) ? g.links.slice(0, 120) : [],
  };
}

/**
 * Leitura arquitetural (SARIF run properties) — a outra metade do code-graph.
 *
 * `codeGraph` traz exposição por FUNÇÃO: fan-in, saltos até uma entrada. Isto
 * traz acoplamento por MÓDULO: quem depende de quem, instabilidade, ciclos de
 * importação, e complexidade cruzada com alcance.
 *
 * São perguntas diferentes e as duas precisam ser respondidas. "Esta função
 * está exposta" e "mexer neste módulo é caro" não se deduzem uma da outra.
 *
 * O corte em 25 módulos é deliberado: o relatório completo de um monorepo
 * passa de trezentos, isso fica no documento do repositório e viaja em toda
 * leitura do painel. Vinte e cinco cobre o que alguém realmente vai olhar
 * numa reunião.
 */
export function arquiteturaFromSarif(sarif: SarifLog): Record<string, unknown> | null {
  const raw = sarif.runs?.[0]?.properties?.arquitetura;
  if (!raw || typeof raw !== "object") return null;
  const a = raw as {
    geradoEm?: string;
    totais?: Record<string, unknown>;
    ciclos?: unknown;
    modulos?: unknown;
    porLinguagem?: unknown;
  };
  if (!a.totais || typeof a.totais !== "object") return null;

  const num = (v: unknown) => Number(v) || 0;
  const t = a.totais as Record<string, unknown>;

  const modulos = Array.isArray(a.modulos)
    ? a.modulos
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .slice(0, 40)
        .map((m) => ({
          arquivo: String(m.arquivo ?? ""),
          ca: num(m.ca),
          ce: num(m.ce),
          instabilidade: typeof m.instabilidade === "number" ? m.instabilidade : null,
          cognitiva: num(m.cognitiva),
          maiorFuncao: num(m.maiorFuncao),
          linhasDeCodigo: num(m.linhasDeCodigo),
          risco: num(m.risco),
          ciclo: typeof m.ciclo === "number" ? m.ciclo : null,
          linguagem: typeof m.linguagem === "string" ? m.linguagem : undefined,
          mi: typeof m.mi === "number" ? m.mi : null,
          piorFuncaoMi: typeof m.piorFuncaoMi === "number" ? m.piorFuncaoMi : null,
        }))
    : [];

  const ciclos = Array.isArray(a.ciclos)
    ? a.ciclos
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .slice(0, 10)
        .map((c) => ({
          id: num(c.id),
          modulos: Array.isArray(c.modulos) ? c.modulos.slice(0, 12).map(String) : [],
        }))
    : [];

  const porLinguagem = Array.isArray(a.porLinguagem)
    ? a.porLinguagem
        .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
        .slice(0, 24)
        .map((l) => ({
          linguagem: String(l.linguagem ?? "—"),
          modulos: num(l.modulos),
          linhasDeCodigo: num(l.linhasDeCodigo),
          funcoes: num(l.funcoes),
          mi: num(l.mi),
          ciclomaticaMedia: num(l.ciclomaticaMedia),
          cognitivaMedia: num(l.cognitivaMedia),
          densidadeComentario: num(l.densidadeComentario),
          modulosEmAtencao: num(l.modulosEmAtencao),
          modulosCriticos: num(l.modulosCriticos),
        }))
    : [];

  return {
    version: 1,
    geradoEm: typeof a.geradoEm === "string" ? a.geradoEm : new Date().toISOString(),
    totais: {
      modulos: num(t.modulos),
      linhasDeCodigo: num(t.linhasDeCodigo),
      funcoes: num(t.funcoes),
      ciclomaticaMedia: num(t.ciclomaticaMedia),
      cognitivaMedia: num(t.cognitivaMedia),
      arestasInternas: num(t.arestasInternas),
      dependenciasExternas: num(t.dependenciasExternas),
      modulosEmCiclo: num(t.modulosEmCiclo),
      modulosOrfaos: num(t.modulosOrfaos),
    },
    ciclos,
    modulos,
    ...(porLinguagem.length > 0 ? { porLinguagem } : {}),
  };
}

export function computeAnalysisSummary(
  results: SarifResult[],
  linesOfCode: number,
  newCodeFingerprints?: string[],
  /**
   * Percentual de cobertura medido, ou `null` quando o build não enviou
   * relatório. `null` PULA a condição no gate — antes daqui passava um `100`
   * fixo, que fazia a condição existir no papel e nunca reprovar nada.
   */
  coveragePercent?: number | null,
  duplicationPercent?: number | null,
  qualityGateThresholds?: QualityGateThresholds | null,
  branchCoveragePercent?: number | null,
): PersistAnalysisResult["summary"] {
  const newSet = new Set(newCodeFingerprints ?? []);
  const scopeToNewCode = newSet.size > 0;
  const bySeverity: Record<Severity, number> = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  const byType: Record<string, number> = {};
  const codeSmellEfforts: number[] = [];
  const vulnSeverities: Severity[] = [];
  let newBlockerIssues = 0;
  let codeSmellCount = 0;

  for (const r of results) {
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const fp =
      r.partialFingerprints?.["heroHash/v1"] ??
      `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    const isNew = newSet.has(fp);
    const gateSuppressed = r.properties?.gateSuppressed === true;

    if (SEVERITIES.includes(sev)) bySeverity[sev] += 1;
    byType[issueType] = (byType[issueType] ?? 0) + 1;
    if (issueType === "CODE_SMELL") codeSmellCount += 1;
    // Política: regra com FP local alto (≥minFeedback e rate≥0.6) não conta no gate.
    if (!gateSuppressed && sev === "BLOCKER" && isNew) newBlockerIssues += 1;

    // Gate ratings: when CI sent fingerprints, score only new-code issues.
    if (scopeToNewCode && !isNew) continue;
    if (gateSuppressed) continue;
    if (issueType === "CODE_SMELL") codeSmellEfforts.push(r.properties?.remediationEffortMin ?? 0);
    if (issueType === "VULNERABILITY" && SEVERITIES.includes(sev)) vulnSeverities.push(sev);
  }

  const debtMin = technicalDebtMinutes(codeSmellEfforts);
  // Debt ratio still uses full LOC (new-code LOC is not always available).
  const debtRatio = technicalDebtRatio(debtMin, linesOfCode);
  const maintRating = maintainabilityRating(debtRatio);
  const securityRating = ratingFromWorstSeverity(vulnSeverities);
  const gate = evaluateQualityGate(
    {
      newCodeCoverage: coveragePercent ?? null,
      branchCoverage: branchCoveragePercent ?? null,
      newCodeDuplication: duplicationPercent ?? null,
      newBlockerIssues,
      securityRating,
      maintainabilityRating: maintRating,
    },
    mergeQualityGate(qualityGateThresholds),
  );

  return {
    total: results.length,
    bySeverity,
    byType,
    codeSmellCount,
    debtMinutes: debtMin,
    debtRatio,
    maintainabilityRating: maintRating,
    securityRating,
    qualityGate: gate,
  };
}

/** Upsert issue docs from SARIF results (BulkWriter). Used sync or by ingest worker. */
export async function upsertIssuesFromResults(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  results: SarifResult[];
  branch: string;
  source: string;
  analysisId: string;
  newCodeFingerprints?: string[];
}): Promise<void> {
  const newSet = new Set(input.newCodeFingerprints ?? []);
  const rRef = repoRef(input.orgId, input.projectId, input.repoId);
  const now = FieldValue.serverTimestamp();
  const bulkWriter = db.bulkWriter();

  for (const r of input.results) {
    const fp =
      r.partialFingerprints?.["heroHash/v1"] ??
      `${r.ruleId}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
    const sev = (r.properties?.severity as Severity) ?? "INFO";
    const issueType = r.properties?.issueType ?? "CODE_SMELL";
    const loc = r.locations?.[0]?.physicalLocation;
    const file = loc?.artifactLocation?.uri ?? "";
    const rank =
      typeof r.properties?.assertiveness === "number"
        ? {
            assertiveness: r.properties.assertiveness,
            fpLikelihood: r.properties.fpLikelihood ?? 1 - r.properties.assertiveness,
            modelVersion: r.properties.rankerModel ?? DEFAULT_MODEL.version,
          }
        : scoreFinding(DEFAULT_MODEL, {
            ruleId: r.ruleId,
            file,
            severity: sev,
            engine: r.properties?.engine ?? null,
            tool:
              (r.properties?.tool as string | null | undefined) ??
              (String(r.ruleId || "").startsWith("EXT:") ? String(r.ruleId).split(":")[1] : null),
            findingSource: r.properties?.source === "imported" ? "imported" : "native",
            ruleRepoFpRate:
              typeof r.properties?.ruleRepoFpRate === "number" ? r.properties.ruleRepoFpRate : undefined,
            taintPathLength: Array.isArray(r.properties?.taintPath)
              ? (r.properties.taintPath as string[]).length
              : typeof r.properties?.taintPathLength === "number"
                ? r.properties.taintPathLength
                : undefined,
            outlierScore:
              typeof r.properties?.outlierScore === "number" ? r.properties.outlierScore : undefined,
            familySize: typeof r.properties?.familySize === "number" ? r.properties.familySize : undefined,
            fanIn:
              typeof r.properties?.callGraph?.fanIn === "number"
                ? r.properties.callGraph.fanIn
                : typeof r.properties?.graphFanIn === "number"
                  ? r.properties.graphFanIn
                  : undefined,
            hopsToEntry:
              r.properties?.callGraph?.hopsToEntry !== undefined
                ? r.properties.callGraph.hopsToEntry
                : r.properties?.graphHopsToEntry !== undefined
                  ? r.properties.graphHopsToEntry
                  : undefined,
          });

    bulkWriter.set(
      rRef.collection("issues").doc(fp),
      {
        fingerprint: fp,
        ruleId: r.ruleId,
        severity: sev,
        issueType,
        message: r.message?.text ?? "",
        file,
        line: loc?.region?.startLine ?? 0,
        column: loc?.region?.startColumn ?? 0,
        snippet: r.properties?.snippet ?? loc?.region?.snippet?.text ?? "",
        remediationEffortMin: r.properties?.remediationEffortMin ?? 0,
        sddTemplateId: r.properties?.sddTemplateId ?? null,
        risk: r.properties?.risk ?? null,
        reason: r.properties?.reason ?? null,
        howToFix: r.properties?.howToFix ?? null,
        strategy: r.properties?.strategy ?? null,
        constraints: r.properties?.constraints ?? [],
        referenceExample: r.properties?.referenceExample ?? null,
        cwe: r.properties?.cwe ?? [],
        findingSource: r.properties?.source === "imported" ? "imported" : "native",
        tool: r.properties?.tool ?? null,
        originalRuleId: r.properties?.originalRuleId ?? null,
        isDependency: r.properties?.isDependency === true,
        engine: r.properties?.engine ?? null,
        alsoRuleIds: Array.isArray(r.properties?.alsoRuleIds)
          ? (r.properties!.alsoRuleIds as string[]).filter((x) => typeof x === "string").slice(0, 40)
          : [],
        assertiveness: Math.round(rank.assertiveness * 1000) / 1000,
        fpLikelihood: Math.round(rank.fpLikelihood * 1000) / 1000,
        rankerModel: rank.modelVersion,
        gateSuppressed: r.properties?.gateSuppressed === true,
        gateSuppressReason: r.properties?.gateSuppressReason ?? null,
        ruleRepoFpRate:
          typeof r.properties?.ruleRepoFpRate === "number" ? r.properties.ruleRepoFpRate : null,
        ...(typeof r.properties?.clusterId === "string"
          ? {
              clusterId: r.properties.clusterId,
              familySize: r.properties.familySize ?? null,
              outlierScore:
                typeof r.properties.outlierScore === "number"
                  ? Math.round(r.properties.outlierScore * 1000) / 1000
                  : null,
              functionName: r.properties.functionName ?? null,
              embedModel: r.properties.embedModel ?? null,
            }
          : {}),
        ...(typeof r.properties?.triageScore === "number"
          ? {
              triageScore: Math.round(r.properties.triageScore * 1000) / 1000,
              likelyTruePositive:
                r.properties.likelyTruePositive ?? r.properties.triageScore >= 0.55,
              triageReason: r.properties.triageReason ?? null,
              triageMode: r.properties.triageMode ?? "sarif",
            }
          : {}),
        ...(r.properties?.callGraph && typeof r.properties.callGraph === "object"
          ? { callGraph: r.properties.callGraph }
          : typeof r.properties?.graphFanIn === "number"
            ? {
                callGraph: {
                  functionId: r.properties.graphFunctionId ?? null,
                  functionName: r.properties.graphFunctionName ?? null,
                  fanIn: r.properties.graphFanIn,
                  fanOut: r.properties.graphFanOut ?? 0,
                  hopsToEntry:
                    typeof r.properties.graphHopsToEntry === "number"
                      ? r.properties.graphHopsToEntry
                      : null,
                  callers: [],
                  callees: [],
                  priority: r.properties.graphPriority ?? 0,
                },
              }
            : {}),
        status: "open",
        isNewCode: newSet.has(fp),
        branch: input.branch,
        source: input.source,
        lastSeen: now,
        lastAnalysisId: input.analysisId,
        firstSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await bulkWriter.close();
}

/**
 * Shared core of "an analysis happened for this repo": upserts issues (unless
 * deferred), computes debt + quality gate, records analysis snapshot, updates
 * repo metrics + project rollup + analytics.
 */
export async function persistAnalysisResults(input: PersistAnalysisInput): Promise<PersistAnalysisResult> {
  const { orgId, projectId, repoId, results, branch, commit, linesOfCode, source } = input;
  const rRef = repoRef(orgId, projectId, repoId);
  const analysisId = input.analysisId ?? `${Date.now()}`;
  const now = FieldValue.serverTimestamp();

  // Aprendizado local: regras com FP rate alto no repo saem do cálculo do gate.
  const stats = await loadRuleFpStats(
    orgId,
    projectId,
    repoId,
    results.map((r) => r.ruleId),
  );
  const { suppressed } = annotateGateSuppression(results, stats);
  if (suppressed > 0) {
    console.log(`CodeHero: gate-suppress ${suppressed} finding(s) por ruleRepoFpRate local`);
  }

  let thresholds = input.qualityGateThresholds ?? null;
  if (!thresholds) {
    const projSnap = await db.doc(`orgs/${orgId}/projects/${projectId}`).get();
    const raw = projSnap.get("qualityGate") as Partial<QualityGateThresholds> | undefined;
    thresholds = mergeQualityGate(raw ?? null);
  } else {
    thresholds = mergeQualityGate(thresholds);
  }

  const summary = computeAnalysisSummary(
    results,
    linesOfCode,
    input.newCodeFingerprints,
    input.coveragePercent,
    input.duplicationPercent,
    thresholds,
    input.branchCoveragePercent,
  );

  if (!input.deferIssueWrites) {
    await upsertIssuesFromResults({
      orgId,
      projectId,
      repoId,
      results,
      branch,
      source,
      analysisId,
      newCodeFingerprints: input.newCodeFingerprints,
    });
  }

  await rRef.collection("analyses").doc(analysisId).set({
    analysisId,
    branch,
    commit: commit ?? null,
    createdAt: now,
    sarifPath: input.sarifPath ?? null,
    linesOfCode,
    source,
    summary,
    idempotencyKey: input.idempotencyKey ?? null,
    issuesPending: !!input.deferIssueWrites,
    ...(input.codeGraph ? { codeGraph: input.codeGraph } : {}),
    ...(input.arquitetura ? { arquitetura: input.arquitetura } : {}),
  });

  await rRef.set(
    {
      lastAnalysisId: analysisId,
      lastAnalyzedAt: now,
      lastAnalysisSource: source,
      debtMinutes: summary.debtMinutes,
      maintainabilityRating: summary.maintainabilityRating,
      securityRating: summary.securityRating,
      qualityGateStatus: summary.qualityGate.status,
      openIssues: results.length,
      ...(input.codeGraph ? { codeGraph: input.codeGraph } : {}),
    ...(input.arquitetura ? { arquitetura: input.arquitetura } : {}),
    },
    { merge: true },
  );

  await recomputeProjectAggregate(orgId, projectId);

  try {
    await recordAnalysisAnalytics({
      orgId,
      projectId,
      repoId,
      linesOfCode,
      source,
      summary,
    });
  } catch {
    /* analytics must not fail the ingest */
  }

  return { analysisId, summary };
}

/** Enqueue deferred issue upserts (Firestore queue — no Pub/Sub topic ops required). */
export async function enqueueIssueUpsertJob(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  analysisId: string;
  sarifPath: string;
  branch: string;
  source: string;
  newCodeFingerprints?: string[];
}): Promise<string> {
  const ref = db.collection("ingestJobs").doc();
  await ref.set({
    ...input,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
  });
  return ref.id;
}
