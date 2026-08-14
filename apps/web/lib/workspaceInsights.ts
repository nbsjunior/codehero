import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { dbClient } from "@/lib/firebaseDb";
import type {
  AdminIssueRow,
  AdminIssuesResult,
  AdminProjectRow,
  AdminRepoFindingCount,
  AdminRuleCause,
  CodeGraphRepoSummary,
  PlatformSummary,
} from "@/lib/api";

const MAX_ISSUES = 800;
const PER_REPO_LIMIT = 120;

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

        const ruleAgg = byRuleId.get(ruleId) ?? {
          ruleId,
          message: (data.message as string | undefined) ?? "",
          severity,
          count: 0,
        };
        ruleAgg.count += 1;
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
