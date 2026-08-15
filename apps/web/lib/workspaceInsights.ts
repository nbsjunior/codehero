import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { dbClient } from "@/lib/firebaseDb";
import type {
  AdminIssueRow,
  AdminIssuesResult,
  AdminProjectRow,
  AdminRepoFindingCount,
  AdminRuleCause,
  ArquiteturaRepoSummary,
  CodeGraphRepoSummary,
  PlatformSummary,
} from "@/lib/api";

const MAX_ISSUES = 800;
const PER_REPO_LIMIT = 120;
const PER_REPO_ANALYSES = 40;

function worseRating(a: string, b: string): string {
  const order = ["A", "B", "C", "D", "E"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/** KPIs e buckets A–E a partir dos projetos já carregados do membro. */
export function summaryFromProjects(projects: AdminProjectRow[]): PlatformSummary {
  const bySecurityRating: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const byMaintainabilityRating: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const byQualityGate: Record<string, number> = {};
  const orgIds = new Set<string>();
  let repoCount = 0;
  let debtMinutes = 0;
  let openIssues = 0;
  let failingGates = 0;
  let worstSecurityRating = "A";
  let worstMaintainabilityRating = "A";

  for (const p of projects) {
    orgIds.add(p.orgId);
    repoCount += p.repoCount || p.repos.length;
    debtMinutes += p.debtMinutes || 0;
    openIssues += p.openIssues || 0;
    if (p.qualityGateStatus !== "PASSED") failingGates += 1;
    byQualityGate[p.qualityGateStatus || "PASSED"] =
      (byQualityGate[p.qualityGateStatus || "PASSED"] ?? 0) + 1;

    const sec = (p.securityRating || "A").toUpperCase();
    const maint = (p.maintainabilityRating || "A").toUpperCase();
    if (sec in bySecurityRating) bySecurityRating[sec]! += 1;
    else bySecurityRating.A! += 1;
    if (maint in byMaintainabilityRating) byMaintainabilityRating[maint]! += 1;
    else byMaintainabilityRating.A! += 1;

    worstSecurityRating = worseRating(worstSecurityRating, sec);
    worstMaintainabilityRating = worseRating(worstMaintainabilityRating, maint);
  }

  return {
    orgCount: orgIds.size,
    projectCount: projects.length,
    repoCount,
    debtMinutes,
    openIssues,
    failingGates,
    worstSecurityRating,
    worstMaintainabilityRating,
    bySecurityRating,
    byMaintainabilityRating,
    byQualityGate,
  };
}

export type PortfolioCodeGraph = {
  repoCount: number;
  reposWithGraph: number;
  functions: number;
  calls: number;
  imports: number;
  entries: number;
  nodes: number;
  edges: number;
  topRepos: Array<{
    repoId: string;
    repoName: string;
    projectName: string;
    orgName: string;
    orgId: string;
    projectId: string;
    functions: number;
    calls: number;
    imports: number;
    maxFanIn: number;
  }>;
  hotspots: Array<{
    id: string;
    name: string;
    file: string;
    fanIn: number;
    fanOut: number;
    hopsToEntry: number | null;
    repoName: string;
  }>;
  hopBuckets: { entry: number; hop1: number; hop2: number; hop3plus: number; unknown: number };
  composition: Array<{ label: string; value: number; color: string }>;
};

function isGraph(g: CodeGraphRepoSummary | null | undefined): g is CodeGraphRepoSummary {
  return Boolean(g && (g.functions > 0 || g.nodes > 0));
}

/** Soma o code-graph dos repositórios já carregados (relatório executivo). */
export function aggregateCodeGraphs(projects: AdminProjectRow[]): PortfolioCodeGraph {
  const empty: PortfolioCodeGraph = {
    repoCount: 0,
    reposWithGraph: 0,
    functions: 0,
    calls: 0,
    imports: 0,
    entries: 0,
    nodes: 0,
    edges: 0,
    topRepos: [],
    hotspots: [],
    hopBuckets: { entry: 0, hop1: 0, hop2: 0, hop3plus: 0, unknown: 0 },
    composition: [],
  };
  const hopBuckets = { entry: 0, hop1: 0, hop2: 0, hop3plus: 0, unknown: 0 };
  const topRepos: PortfolioCodeGraph["topRepos"] = [];
  const hotspots: PortfolioCodeGraph["hotspots"] = [];
  let repoCount = 0;

  for (const p of projects) {
    for (const r of p.repos) {
      repoCount += 1;
      const g = r.codeGraph;
      if (!isGraph(g)) continue;
      empty.reposWithGraph += 1;
      empty.functions += g.functions || 0;
      empty.calls += g.calls || 0;
      empty.imports += g.imports || 0;
      empty.entries += g.entries || 0;
      empty.nodes += g.nodes || 0;
      empty.edges += g.edges || 0;
      const maxFanIn = Math.max(0, ...(g.hotspots ?? []).map((h) => h.fanIn));
      topRepos.push({
        repoId: r.repoId,
        repoName: r.name,
        projectName: p.name,
        orgName: p.orgName,
        orgId: p.orgId,
        projectId: p.projectId,
        functions: g.functions || 0,
        calls: g.calls || 0,
        imports: g.imports || 0,
        maxFanIn,
      });
      for (const h of g.hotspots ?? []) {
        hotspots.push({ ...h, repoName: r.name });
        if (h.hopsToEntry === 0) hopBuckets.entry += 1;
        else if (h.hopsToEntry === 1) hopBuckets.hop1 += 1;
        else if (h.hopsToEntry === 2) hopBuckets.hop2 += 1;
        else if (typeof h.hopsToEntry === "number") hopBuckets.hop3plus += 1;
        else hopBuckets.unknown += 1;
      }
    }
  }

  empty.repoCount = repoCount;
  empty.topRepos = topRepos.sort((a, b) => b.functions - a.functions).slice(0, 10);
  empty.hotspots = hotspots.sort((a, b) => b.fanIn - a.fanIn).slice(0, 12);
  empty.hopBuckets = hopBuckets;
  empty.composition = [
    { label: "Funções", value: empty.functions, color: "#388bfd" },
    { label: "Calls", value: empty.calls, color: "#a371f7" },
    { label: "Imports", value: empty.imports, color: "#d29922" },
    { label: "Entries", value: empty.entries, color: "#3fb950" },
  ];
  return empty;
}

/**
 * Achados abertos nos repos dos projetos do membro (leitura Firestore client).
 * Mesmo formato de `adminListAllIssues` para reutilizar Apontamentos / Relatório.
 */
export async function loadWorkspaceIssues(projects: AdminProjectRow[]): Promise<AdminIssuesResult> {
  const bySeverity: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const items: AdminIssueRow[] = [];
  const byRuleId = new Map<string, AdminRuleCause>();
  const byRepoId = new Map<string, AdminRepoFindingCount>();
  const cutoff30d = Date.now() - 30 * 86_400_000;

  for (const p of projects) {
    for (const r of p.repos) {
      byRepoId.set(r.repoId, {
        repoId: r.repoId,
        repoName: r.name,
        projectId: p.projectId,
        projectName: p.name,
        orgId: p.orgId,
        orgName: p.orgName,
        count: 0,
      });
    }
  }

  const repoJobs = projects.flatMap((p) =>
    p.repos.map((r) => ({
      orgId: p.orgId,
      orgName: p.orgName,
      projectId: p.projectId,
      projectName: p.name,
      repoId: r.repoId,
      repoName: r.name,
    })),
  );

  const CONCURRENCY = 12;
  for (let i = 0; i < repoJobs.length && items.length < MAX_ISSUES; i += CONCURRENCY) {
    const chunk = repoJobs.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      chunk.map((meta) =>
        getDocs(
          query(
            collection(
              dbClient,
              "orgs",
              meta.orgId,
              "projects",
              meta.projectId,
              "repos",
              meta.repoId,
              "issues",
            ),
            where("status", "==", "open"),
            limit(PER_REPO_LIMIT),
          ),
        ).then((snap) => ({ meta, snap })),
      ),
    );

    for (const { meta, snap } of snaps) {
      const repoAgg = byRepoId.get(meta.repoId);
      if (repoAgg) repoAgg.count += snap.size;

      for (const d of snap.docs) {
        if (items.length >= MAX_ISSUES) break;
        const data = d.data();
        const severity = (data.severity as string | undefined) ?? "INFO";
        const source = (data.source as string | undefined) ?? "github-action";
        const ruleId = (data.ruleId as string | undefined) ?? "";
        bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
        bySource[source] = (bySource[source] ?? 0) + 1;

        const firstSeenIso = data.firstSeen?.toDate?.()?.toISOString?.() ?? null;
        const firstSeenMs = firstSeenIso ? Date.parse(firstSeenIso) : NaN;
        const isNew30d = Number.isFinite(firstSeenMs) && firstSeenMs >= cutoff30d;

        const ruleAgg = byRuleId.get(ruleId) ?? {
          ruleId,
          message: (data.message as string | undefined) ?? "",
          severity,
          count: 0,
          newLast30d: 0,
        };
        ruleAgg.count += 1;
        if (isNew30d) ruleAgg.newLast30d = (ruleAgg.newLast30d ?? 0) + 1;
        byRuleId.set(ruleId, ruleAgg);

        const lastSeen = data.lastSeen?.toDate?.()?.toISOString?.() ?? null;
        items.push({
          issueId: d.id,
          repoId: meta.repoId,
          repoName: meta.repoName,
          projectId: meta.projectId,
          projectName: meta.projectName,
          orgId: meta.orgId,
          orgName: meta.orgName,
          ruleId,
          severity,
          issueType: (data.issueType as string | undefined) ?? "CODE_SMELL",
          message: (data.message as string | undefined) ?? "",
          file: (data.file as string | undefined) ?? "",
          line: (data.line as number | undefined) ?? 0,
          source: source as AdminIssueRow["source"],
          lastSeen,
          firstSeen: firstSeenIso,
          assertiveness: typeof data.assertiveness === "number" ? data.assertiveness : null,
          fpLikelihood: typeof data.fpLikelihood === "number" ? data.fpLikelihood : null,
          gateSuppressed: data.gateSuppressed === true,
        });
      }
    }
  }

  const topCauses = [...byRuleId.values()].sort((a, b) => b.count - a.count).slice(0, 25);
  const ranked = [...byRepoId.values()].sort((a, b) => b.count - a.count);
  return {
    total: items.length,
    bySeverity,
    bySource,
    items,
    topCauses,
    mostFindings: ranked.slice(0, 15),
    leastFindings: [...ranked].reverse().slice(0, 15),
    nextCursor: null,
    truncated: items.length >= MAX_ISSUES,
  };
}

// ---------------------------------------------------------------------------
// Leitura arquitetural agregada — a outra metade do code-graph.
//
// `aggregateCodeGraphs` responde "quais funções estão expostas". Isto responde
// "onde mexer custa caro", que é a pergunta que ordena a semana do time.
//
// As duas não se deduzem uma da outra. Uma função exposta pode estar num
// módulo trivial de trocar; um módulo caríssimo de mexer pode não ter nenhuma
// função exposta e ainda assim ser onde toda mudança trava.
// ---------------------------------------------------------------------------

export type PortfolioArquitetura = {
  reposComLeitura: number;
  modulos: number;
  funcoes: number;
  linhasDeCodigo: number;
  /** Média ponderada por função entre os repositórios, não média de médias. */
  cognitivaMedia: number;
  ciclomaticaMedia: number;
  arestasInternas: number;
  dependenciasExternas: number;
  modulosEmCiclo: number;
  modulosOrfaos: number;
  /** Ciclos de importação, com o repositório onde aparecem. */
  ciclos: Array<{ repoName: string; id: number; modulos: string[] }>;
  /** Módulos de maior risco no portfólio inteiro. */
  risco: Array<{
    repoName: string;
    arquivo: string;
    ca: number;
    ce: number;
    instabilidade: number | null;
    cognitiva: number;
    maiorFuncao: number;
    risco: number;
    ciclo: number | null;
  }>;
};

export function aggregateArquitetura(projects: AdminProjectRow[]): PortfolioArquitetura {
  const out: PortfolioArquitetura = {
    reposComLeitura: 0,
    modulos: 0,
    funcoes: 0,
    linhasDeCodigo: 0,
    cognitivaMedia: 0,
    ciclomaticaMedia: 0,
    arestasInternas: 0,
    dependenciasExternas: 0,
    modulosEmCiclo: 0,
    modulosOrfaos: 0,
    ciclos: [],
    risco: [],
  };

  // Média PONDERADA por função. Média de médias trataria um repositório de
  // dez funções igual a um de duas mil, e o número deixaria de significar
  // "quanto custa ler uma função deste portfólio".
  let somaCognitiva = 0;
  let somaCiclomatica = 0;

  for (const p of projects) {
    for (const r of p.repos) {
      const a = r.arquitetura;
      if (!a?.totais || a.totais.modulos <= 0) continue;
      out.reposComLeitura += 1;
      out.modulos += a.totais.modulos;
      out.funcoes += a.totais.funcoes;
      out.linhasDeCodigo += a.totais.linhasDeCodigo;
      out.arestasInternas += a.totais.arestasInternas;
      out.dependenciasExternas += a.totais.dependenciasExternas;
      out.modulosEmCiclo += a.totais.modulosEmCiclo;
      out.modulosOrfaos += a.totais.modulosOrfaos;
      somaCognitiva += a.totais.cognitivaMedia * a.totais.funcoes;
      somaCiclomatica += a.totais.ciclomaticaMedia * a.totais.funcoes;

      for (const c of a.ciclos ?? []) {
        out.ciclos.push({ repoName: r.name, id: c.id, modulos: c.modulos });
      }
      for (const m of a.modulos ?? []) {
        out.risco.push({ repoName: r.name, ...m });
      }
    }
  }

  if (out.funcoes > 0) {
    out.cognitivaMedia = Number((somaCognitiva / out.funcoes).toFixed(1));
    out.ciclomaticaMedia = Number((somaCiclomatica / out.funcoes).toFixed(1));
  }
  out.risco.sort((a, b) => b.risco - a.risco);
  out.risco = out.risco.slice(0, 15);
  out.ciclos = out.ciclos.slice(0, 8);
  return out;
}

// ---------------------------------------------------------------------------
// Série temporal histórica (workspace admin) — smells + complexidade/grafo
// ---------------------------------------------------------------------------

export type AnalysisSnap = {
  at: number;
  dayKey: string;
  debtMinutes: number;
  debtRatio: number | null;
  linesOfCode: number;
  codeSmells: number | null;
  findingsTotal: number;
  functions: number;
  calls: number;
  edges: number;
  maxFanIn: number;
  cognitivaMedia: number | null;
  ciclomaticaMedia: number | null;
  funcoesArq: number;
  modulosEmCiclo: number;
  arestasInternas: number;
  gatePassed: boolean;
  failedConditions: string[];
  maintainabilityRating: string | null;
  securityRating: string | null;
  coveragePercent: number | null;
  duplicationPercent: number | null;
  branchCoveragePercent: number | null;
  gateSuppressedCount: number;
};

function dayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function labelFromDayKey(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return `${d}/${m}`;
}

function createdAtMs(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const n = new Date(raw).getTime();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function maxFanInFromGraph(g: CodeGraphRepoSummary | null | undefined): number {
  if (!g?.hotspots?.length) return 0;
  return Math.max(0, ...g.hotspots.map((h) => h.fanIn || 0));
}

function snapFromAnalysisDoc(data: Record<string, unknown>): AnalysisSnap | null {
  const at = createdAtMs(data.createdAt);
  if (at == null) return null;
  const summary = (data.summary as Record<string, unknown> | undefined) ?? {};
  const byType = (summary.byType as Record<string, number> | undefined) ?? undefined;
  const codeSmellCount =
    typeof summary.codeSmellCount === "number"
      ? summary.codeSmellCount
      : typeof byType?.CODE_SMELL === "number"
        ? byType.CODE_SMELL
        : null;
  const g = data.codeGraph as CodeGraphRepoSummary | null | undefined;
  const a = data.arquitetura as ArquiteturaRepoSummary | null | undefined;
  const gate = summary.qualityGate as { status?: string; failedConditions?: string[] } | undefined;
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    at,
    dayKey: dayKeyFromMs(at),
    debtMinutes: typeof summary.debtMinutes === "number" ? summary.debtMinutes : 0,
    debtRatio: numOrNull(summary.debtRatio),
    linesOfCode: typeof data.linesOfCode === "number" ? data.linesOfCode : 0,
    codeSmells: codeSmellCount,
    findingsTotal: typeof summary.total === "number" ? summary.total : 0,
    functions: g?.functions ?? 0,
    calls: g?.calls ?? 0,
    edges: g?.edges ?? 0,
    maxFanIn: maxFanInFromGraph(g),
    cognitivaMedia: a?.totais?.cognitivaMedia ?? null,
    ciclomaticaMedia: a?.totais?.ciclomaticaMedia ?? null,
    funcoesArq: a?.totais?.funcoes ?? 0,
    modulosEmCiclo: a?.totais?.modulosEmCiclo ?? 0,
    arestasInternas: a?.totais?.arestasInternas ?? 0,
    gatePassed: (gate?.status ?? "PASSED") === "PASSED",
    failedConditions: Array.isArray(gate?.failedConditions)
      ? gate!.failedConditions!.filter((c): c is string => typeof c === "string")
      : [],
    maintainabilityRating:
      typeof summary.maintainabilityRating === "string" ? summary.maintainabilityRating : null,
    securityRating: typeof summary.securityRating === "string" ? summary.securityRating : null,
    coveragePercent: numOrNull(summary.coveragePercent),
    duplicationPercent: numOrNull(summary.duplicationPercent),
    branchCoveragePercent: numOrNull(summary.branchCoveragePercent),
    gateSuppressedCount:
      typeof summary.gateSuppressedCount === "number" ? summary.gateSuppressedCount : 0,
  };
}

/**
 * Últimas analyses por repositório do workspace (Firestore client).
 * Ordenadas por createdAt asc dentro de cada repo.
 */
export async function loadWorkspaceAnalysisHistory(
  projects: AdminProjectRow[],
): Promise<Map<string, AnalysisSnap[]>> {
  const byRepo = new Map<string, AnalysisSnap[]>();
  const repoJobs = projects.flatMap((p) =>
    p.repos.map((r) => ({
      key: `${p.orgId}/${p.projectId}/${r.repoId}`,
      orgId: p.orgId,
      projectId: p.projectId,
      repoId: r.repoId,
    })),
  );

  const CONCURRENCY = 10;
  for (let i = 0; i < repoJobs.length; i += CONCURRENCY) {
    const chunk = repoJobs.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      chunk.map(async (meta) => {
        try {
          const q = query(
            collection(
              dbClient,
              "orgs",
              meta.orgId,
              "projects",
              meta.projectId,
              "repos",
              meta.repoId,
              "analyses",
            ),
            orderBy("createdAt", "desc"),
            limit(PER_REPO_ANALYSES),
          );
          const snap = await getDocs(q);
          const rows: AnalysisSnap[] = [];
          for (const d of snap.docs) {
            const row = snapFromAnalysisDoc(d.data() as Record<string, unknown>);
            if (row) rows.push(row);
          }
          rows.sort((a, b) => a.at - b.at);
          return { key: meta.key, rows };
        } catch {
          return { key: meta.key, rows: [] as AnalysisSnap[] };
        }
      }),
    );
    for (const { key, rows } of snaps) {
      if (rows.length > 0) byRepo.set(key, rows);
    }
  }
  return byRepo;
}

export type PortfolioHistoryPoint = {
  t: number;
  label: string;
  values: Record<string, number>;
};

export type PortfolioHistorySeries = {
  analysisCount: number;
  repoCountWithHistory: number;
  smellPoints: PortfolioHistoryPoint[];
  complexityPoints: PortfolioHistoryPoint[];
  /** Repos com gate FAILED (carry-forward) + builds do dia. */
  gatePoints: PortfolioHistoryPoint[];
  /** Rating score médio A=5…E=1 (carry-forward). */
  ratingPoints: PortfolioHistoryPoint[];
  /**
   * Cobertura / duplicação / debtRatio / LOC — médias ponderadas por LOC
   * quando há medida; repos sem coverage não entram na média.
   */
  qualityPoints: PortfolioHistoryPoint[];
  /** Condições falhas no snapshot mais recente de cada repo. */
  failedConditionCounts: Array<{ label: string; value: number; color?: string }>;
};

const RATING_SCORE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

function ratingScore(r: string | null | undefined): number | null {
  if (!r) return null;
  return RATING_SCORE[r.toUpperCase()] ?? null;
}

/**
 * Agrega o portfólio por dia: em cada dia com ≥1 análise, soma o último
 * snapshot conhecido de cada repo (carry-forward). Complexidade cognitiva /
 * ciclomática usa média ponderada por funções arquiteturais.
 */
export function buildPortfolioTimeSeries(
  byRepo: Map<string, AnalysisSnap[]>,
): PortfolioHistorySeries {
  const empty: PortfolioHistorySeries = {
    analysisCount: 0,
    repoCountWithHistory: byRepo.size,
    smellPoints: [],
    complexityPoints: [],
    gatePoints: [],
    ratingPoints: [],
    qualityPoints: [],
    failedConditionCounts: [],
  };
  if (byRepo.size === 0) return empty;

  const daySet = new Set<string>();
  let analysisCount = 0;
  for (const rows of byRepo.values()) {
    analysisCount += rows.length;
    for (const r of rows) daySet.add(r.dayKey);
  }
  const days = [...daySet].sort();
  if (days.length === 0) return { ...empty, analysisCount };

  const cursors = new Map<string, number>();
  const latest = new Map<string, AnalysisSnap>();

  const smellPoints: PortfolioHistoryPoint[] = [];
  const complexityPoints: PortfolioHistoryPoint[] = [];
  const gatePoints: PortfolioHistoryPoint[] = [];
  const ratingPoints: PortfolioHistoryPoint[] = [];
  const qualityPoints: PortfolioHistoryPoint[] = [];

  for (const day of days) {
    let buildsDay = 0;
    let buildsPassedDay = 0;
    let buildsFailedDay = 0;

    for (const [repoKey, rows] of byRepo) {
      let idx = cursors.get(repoKey) ?? 0;
      while (idx < rows.length && rows[idx]!.dayKey <= day) {
        const snap = rows[idx]!;
        if (snap.dayKey === day) {
          buildsDay += 1;
          if (snap.gatePassed) buildsPassedDay += 1;
          else buildsFailedDay += 1;
        }
        latest.set(repoKey, snap);
        idx += 1;
      }
      cursors.set(repoKey, idx);
    }

    let debtMinutes = 0;
    let codeSmells = 0;
    let smellsKnown = 0;
    let findingsTotal = 0;
    let functions = 0;
    let calls = 0;
    let edges = 0;
    let maxFanIn = 0;
    let modulosEmCiclo = 0;
    let arestasInternas = 0;
    let somaCog = 0;
    let somaCiclo = 0;
    let funcoesArq = 0;
    let gateFailedRepos = 0;
    let gatePassedRepos = 0;
    let maintSum = 0;
    let maintN = 0;
    let secSum = 0;
    let secN = 0;
    let linesOfCode = 0;
    let debtRatioWeighted = 0;
    let debtRatioLoc = 0;
    let covSum = 0;
    let covLoc = 0;
    let dupeSum = 0;
    let dupeLoc = 0;
    let branchSum = 0;
    let branchLoc = 0;
    let gateSuppressed = 0;
    let reposWithCoverage = 0;
    let reposWithDupe = 0;

    for (const snap of latest.values()) {
      debtMinutes += snap.debtMinutes;
      findingsTotal += snap.findingsTotal;
      functions += snap.functions;
      calls += snap.calls;
      edges += snap.edges;
      maxFanIn = Math.max(maxFanIn, snap.maxFanIn);
      modulosEmCiclo += snap.modulosEmCiclo;
      arestasInternas += snap.arestasInternas;
      gateSuppressed += snap.gateSuppressedCount;
      const loc = Math.max(0, snap.linesOfCode);
      linesOfCode += loc;
      if (snap.debtRatio != null && loc > 0) {
        debtRatioWeighted += snap.debtRatio * loc;
        debtRatioLoc += loc;
      } else if (snap.debtRatio != null) {
        debtRatioWeighted += snap.debtRatio;
        debtRatioLoc += 1;
      }
      if (snap.coveragePercent != null) {
        reposWithCoverage += 1;
        const w = loc > 0 ? loc : 1;
        covSum += snap.coveragePercent * w;
        covLoc += w;
      }
      if (snap.duplicationPercent != null) {
        reposWithDupe += 1;
        const w = loc > 0 ? loc : 1;
        dupeSum += snap.duplicationPercent * w;
        dupeLoc += w;
      }
      if (snap.branchCoveragePercent != null) {
        const w = loc > 0 ? loc : 1;
        branchSum += snap.branchCoveragePercent * w;
        branchLoc += w;
      }
      if (snap.codeSmells != null) {
        codeSmells += snap.codeSmells;
        smellsKnown += 1;
      }
      if (snap.cognitivaMedia != null && snap.funcoesArq > 0) {
        somaCog += snap.cognitivaMedia * snap.funcoesArq;
        somaCiclo += (snap.ciclomaticaMedia ?? 0) * snap.funcoesArq;
        funcoesArq += snap.funcoesArq;
      }
      if (snap.gatePassed) gatePassedRepos += 1;
      else gateFailedRepos += 1;
      const ms = ratingScore(snap.maintainabilityRating);
      const ss = ratingScore(snap.securityRating);
      if (ms != null) {
        maintSum += ms;
        maintN += 1;
      }
      if (ss != null) {
        secSum += ss;
        secN += 1;
      }
    }

    const label = labelFromDayKey(day);
    const t = new Date(`${day}T12:00:00`).getTime();
    smellPoints.push({
      t,
      label,
      values: {
        debtHours: Math.round(debtMinutes / 60),
        ...(smellsKnown > 0 ? { codeSmells } : {}),
        findingsTotal,
        ...(debtRatioLoc > 0
          ? { debtRatioPct: Number(((debtRatioWeighted / debtRatioLoc) * 100).toFixed(2)) }
          : {}),
        ...(linesOfCode > 0 ? { linesOfCode } : {}),
      },
    });
    complexityPoints.push({
      t,
      label,
      values: {
        functions,
        calls,
        edges,
        maxFanIn,
        modulosEmCiclo,
        arestasInternas,
        ...(funcoesArq > 0
          ? {
              cognitivaMedia: Number((somaCog / funcoesArq).toFixed(1)),
              ciclomaticaMedia: Number((somaCiclo / funcoesArq).toFixed(1)),
            }
          : {}),
      },
    });
    gatePoints.push({
      t,
      label,
      values: {
        gateFailedRepos,
        gatePassedRepos,
        buildsDay,
        buildsPassedDay,
        buildsFailedDay,
        gateSuppressed,
      },
    });
    ratingPoints.push({
      t,
      label,
      values: {
        ...(maintN > 0 ? { maintScore: Number((maintSum / maintN).toFixed(2)) } : {}),
        ...(secN > 0 ? { securityScore: Number((secSum / secN).toFixed(2)) } : {}),
      },
    });
    qualityPoints.push({
      t,
      label,
      values: {
        ...(covLoc > 0 ? { coveragePercent: Number((covSum / covLoc).toFixed(1)) } : {}),
        ...(dupeLoc > 0 ? { duplicationPercent: Number((dupeSum / dupeLoc).toFixed(1)) } : {}),
        ...(branchLoc > 0 ? { branchCoveragePercent: Number((branchSum / branchLoc).toFixed(1)) } : {}),
        reposWithCoverage,
        reposWithDupe,
        ...(linesOfCode > 0 ? { linesOfCode } : {}),
        ...(debtRatioLoc > 0
          ? { debtRatioPct: Number(((debtRatioWeighted / debtRatioLoc) * 100).toFixed(2)) }
          : {}),
      },
    });
  }

  const condCounts = new Map<string, number>();
  for (const snap of latest.values()) {
    for (const c of snap.failedConditions) {
      condCounts.set(c, (condCounts.get(c) ?? 0) + 1);
    }
  }
  const failedConditionCounts = [...condCounts.entries()]
    .map(([label, value]) => ({ label, value, color: "#f85149" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    analysisCount,
    repoCountWithHistory: byRepo.size,
    smellPoints,
    complexityPoints,
    gatePoints,
    ratingPoints,
    qualityPoints,
    failedConditionCounts,
  };
}

// ---------------------------------------------------------------------------
// Frota de scan — stale / cadência / auto-scan
// ---------------------------------------------------------------------------

export type FleetRepoRow = {
  key: string;
  orgId: string;
  orgName: string;
  projectId: string;
  projectName: string;
  repoId: string;
  repoName: string;
  lastAnalyzedAt: string | null;
  daysSinceScan: number | null;
  stale: boolean;
  neverScanned: boolean;
  qualityGateStatus: string;
  autoScanEnabled: boolean;
  periodicityDays: number;
  debtMinutes: number;
  openIssues: number;
};

export type FleetStatus = {
  staleAfterDays: number;
  repos: FleetRepoRow[];
  staleCount: number;
  neverScanned: number;
  failingGate: number;
  autoScanOff: number;
  fresh: number;
};

export function buildFleetStatus(
  projects: AdminProjectRow[],
  opts?: { staleAfterDays?: number; nowMs?: number },
): FleetStatus {
  const staleAfterDays = opts?.staleAfterDays ?? 7;
  const now = opts?.nowMs ?? Date.now();
  const msPerDay = 86_400_000;
  const repos: FleetRepoRow[] = [];

  for (const p of projects) {
    for (const r of p.repos) {
      const last = r.lastAnalyzedAt ? Date.parse(r.lastAnalyzedAt) : NaN;
      const neverScanned = !Number.isFinite(last);
      const daysSinceScan = neverScanned ? null : Math.floor((now - last) / msPerDay);
      const stale = neverScanned || (daysSinceScan != null && daysSinceScan >= staleAfterDays);
      repos.push({
        key: `${p.orgId}/${p.projectId}/${r.repoId}`,
        orgId: p.orgId,
        orgName: p.orgName,
        projectId: p.projectId,
        projectName: p.name,
        repoId: r.repoId,
        repoName: r.name,
        lastAnalyzedAt: r.lastAnalyzedAt,
        daysSinceScan,
        stale,
        neverScanned,
        qualityGateStatus: r.qualityGateStatus || "PASSED",
        autoScanEnabled: !!r.autoScan?.enabled,
        periodicityDays: r.autoScan?.periodicityDays ?? 7,
        debtMinutes: r.debtMinutes || 0,
        openIssues: r.openIssues || 0,
      });
    }
  }

  repos.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    const da = a.daysSinceScan ?? 9999;
    const db = b.daysSinceScan ?? 9999;
    return db - da;
  });

  return {
    staleAfterDays,
    repos,
    staleCount: repos.filter((r) => r.stale).length,
    neverScanned: repos.filter((r) => r.neverScanned).length,
    failingGate: repos.filter((r) => r.qualityGateStatus !== "PASSED").length,
    autoScanOff: repos.filter((r) => !r.autoScanEnabled).length,
    fresh: repos.filter((r) => !r.stale).length,
  };
}

// ---------------------------------------------------------------------------
// analyticsDaily — só platform admin (regras Firestore)
// ---------------------------------------------------------------------------

export type AnalyticsDailyRow = {
  day: string;
  builds: number;
  findings: number;
  linesOfCode: number;
  debtMinutes: number;
  gatePassed: number;
  gateFailed: number;
};

function dayKeysLastN(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Lê `analyticsDaily/{YYYY-MM-DD}` dos últimos N dias (platform admin). */
export async function loadPlatformAnalyticsDaily(days = 30): Promise<AnalyticsDailyRow[]> {
  const keys = dayKeysLastN(days);
  const rows: AnalyticsDailyRow[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const chunk = keys.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      chunk.map(async (day) => {
        try {
          const snap = await getDoc(doc(dbClient, "analyticsDaily", day));
          if (!snap.exists()) {
            return {
              day,
              builds: 0,
              findings: 0,
              linesOfCode: 0,
              debtMinutes: 0,
              gatePassed: 0,
              gateFailed: 0,
            } satisfies AnalyticsDailyRow;
          }
          const d = snap.data();
          return {
            day,
            builds: Number(d.builds ?? 0),
            findings: Number(d.findings ?? 0),
            linesOfCode: Number(d.linesOfCode ?? 0),
            debtMinutes: Number(d.debtMinutes ?? 0),
            gatePassed: Number(d.gatePassed ?? 0),
            gateFailed: Number(d.gateFailed ?? 0),
          } satisfies AnalyticsDailyRow;
        } catch {
          return null;
        }
      }),
    );
    for (const row of snaps) {
      if (row) rows.push(row);
    }
  }
  return rows;
}

export function analyticsDailyToGatePoints(rows: AnalyticsDailyRow[]): PortfolioHistoryPoint[] {
  return rows
    .filter((r) => r.builds > 0 || r.gatePassed > 0 || r.gateFailed > 0)
    .map((r) => ({
      t: new Date(`${r.day}T12:00:00Z`).getTime(),
      label: labelFromDayKey(r.day),
      values: {
        buildsDay: r.builds,
        buildsPassedDay: r.gatePassed,
        buildsFailedDay: r.gateFailed,
        debtHours: Math.round(r.debtMinutes / 60),
        findings: r.findings,
      },
    }));
}

// ---------------------------------------------------------------------------
// Sinal vs ruído (FP) + tendência de regras — portfólio a partir de issues
// ---------------------------------------------------------------------------

export type SignalNoisePortfolio = {
  total: number;
  ranked: number;
  gateSuppressed: number;
  highFp: number;
  highAssertiveness: number;
  medium: number;
  /** Buckets de fpLikelihood para barras. */
  fpBuckets: Array<{ label: string; value: number; color?: string }>;
  /** Resumo para KPIs. */
  triageBuckets: Array<{ label: string; value: number; color?: string }>;
};

export function buildSignalNoisePortfolio(issues: AdminIssuesResult | null): SignalNoisePortfolio {
  const empty: SignalNoisePortfolio = {
    total: 0,
    ranked: 0,
    gateSuppressed: 0,
    highFp: 0,
    highAssertiveness: 0,
    medium: 0,
    fpBuckets: [],
    triageBuckets: [],
  };
  if (!issues || issues.items.length === 0) return empty;

  const fpBands = [
    { label: "FP ≥70%", min: 0.7, max: 1.01, color: "#f85149", value: 0 },
    { label: "FP 55–70%", min: 0.55, max: 0.7, color: "#db6d28", value: 0 },
    { label: "FP 30–55%", min: 0.3, max: 0.55, color: "#d29922", value: 0 },
    { label: "FP <30%", min: 0, max: 0.3, color: "#3fb950", value: 0 },
  ];

  let gateSuppressed = 0;
  let highFp = 0;
  let highAssertiveness = 0;
  let medium = 0;
  let ranked = 0;

  for (const item of issues.items) {
    if (item.gateSuppressed) gateSuppressed += 1;
    const fp = item.fpLikelihood;
    const as = item.assertiveness;
    if (typeof fp === "number") {
      ranked += 1;
      for (const b of fpBands) {
        if (fp >= b.min && fp < b.max) {
          b.value += 1;
          break;
        }
      }
      if (fp >= 0.55) highFp += 1;
      else if (typeof as === "number" && as >= 0.7) highAssertiveness += 1;
      else medium += 1;
    } else if (typeof as === "number") {
      ranked += 1;
      if (as >= 0.7) highAssertiveness += 1;
      else medium += 1;
    }
  }

  return {
    total: issues.items.length,
    ranked,
    gateSuppressed,
    highFp,
    highAssertiveness,
    medium,
    fpBuckets: fpBands.filter((b) => b.value > 0).map(({ label, value, color }) => ({ label, value, color })),
    triageBuckets: [
      { label: "Fora do gate (FP local)", value: gateSuppressed, color: "#8b949e" },
      { label: "Possível FP (≥55%)", value: highFp, color: "#db6d28" },
      { label: "Assertivo (≥70%)", value: highAssertiveness, color: "#3fb950" },
      { label: "Meio-termo", value: medium, color: "#388bfd" },
    ].filter((b) => b.value > 0),
  };
}

export type RuleTrendRow = AdminRuleCause & { newLast30d: number; deltaShare: number };

/** Top regras ordenadas por crescimento recente (firstSeen ≤30d). */
export function buildTopRulesDelta(
  issues: AdminIssuesResult | null,
  limit = 15,
): RuleTrendRow[] {
  if (!issues?.topCauses?.length) return [];
  return [...issues.topCauses]
    .map((c) => {
      const newLast30d = c.newLast30d ?? 0;
      return {
        ...c,
        newLast30d,
        deltaShare: c.count > 0 ? newLast30d / c.count : 0,
      };
    })
    .sort((a, b) => b.newLast30d - a.newLast30d || b.count - a.count)
    .slice(0, limit);
}

