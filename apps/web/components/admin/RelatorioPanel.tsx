"use client";

import { useEffect, useMemo, useState } from "react";
import { Callout, DataSection, KpiCard, KpiGroup, PageHeader } from "@/components/AdminUi";
import { CodeGraphPanel } from "@/components/CodeGraphPanel";
import { TimeSeriesChart, VerticalBars } from "@/components/RepoHealthCharts";
import {
  adminGetPlatformSummary,
  getWorkspaceOrgQuotas,
  runRepoAutoScanNow,
  setRepoAutoScan,
  type AdminIssuesResult,
  type AdminProjectRow,
  type AdminRepoFindingCount,
  type OrgQuotasView,
  type PlatformSummary,
} from "@/lib/api";
import {
  aggregateCodeGraphs,
  aggregateArquitetura,
  analyticsDailyToGatePoints,
  buildFleetStatus,
  buildPortfolioTimeSeries,
  buildSignalNoisePortfolio,
  buildTopRulesDelta,
  loadPlatformAnalyticsDaily,
  loadWorkspaceAnalysisHistory,
  type FleetRepoRow,
  type PortfolioHistoryPoint,
  type PortfolioHistorySeries,
} from "@/lib/workspaceInsights";

const ratingColor: Record<string, string> = {
  A: "var(--rating-a)",
  B: "var(--rating-b)",
  C: "var(--rating-c)",
  D: "var(--rating-d)",
  E: "var(--rating-e)",
};

const severityColor: Record<string, string> = {
  BLOCKER: "var(--rating-e)",
  CRITICAL: "var(--rating-d)",
  MAJOR: "var(--rating-c)",
  MINOR: "var(--rating-b)",
  INFO: "var(--rating-a)",
};

const RATING_ORDER = ["A", "B", "C", "D", "E"] as const;

function bucketTotal(buckets: Record<string, number> | undefined): number {
  if (!buckets) return 0;
  return RATING_ORDER.reduce((s, r) => s + (buckets[r] ?? 0), 0);
}

function bucketsFromProjects(
  projects: AdminProjectRow[],
  field: "maintainabilityRating" | "securityRating",
): Record<string, number> {
  const out: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const p of projects) {
    const rating = (p[field] || "A").toUpperCase();
    if (rating in out) out[rating] += 1;
    else out.A += 1;
  }
  return out;
}

function worseRating(a: string, b: string): string {
  const order = ["A", "B", "C", "D", "E"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function ratingTone(rating: string): "ok" | "warn" | "danger" {
  const order = ["A", "B", "C", "D", "E"];
  const i = order.indexOf(rating);
  if (i <= 0) return "ok";
  if (i <= 2) return "warn";
  return "danger";
}

type Props = {
  projects: AdminProjectRow[];
  platformSummary: PlatformSummary | null;
  summaryError: string | null;
  onSummaryLoaded: (summary: PlatformSummary | null, error: string | null) => void;
  issues: AdminIssuesResult | null;
  issuesLoading: boolean;
  issuesError: string | null;
  onOpenWorkspace: (orgId: string, projectId: string, repoId?: string) => void;
  /** platform = admin global; workspace = gestor (só orgs/projetos do membro). */
  scope?: "platform" | "workspace";
  /** Recarrega issues/resumo no escopo workspace (opcional). */
  onRefreshWorkspace?: () => Promise<void>;
};

export default function RelatorioPanel({
  projects,
  platformSummary,
  summaryError,
  onSummaryLoaded,
  issues,
  issuesLoading,
  issuesError,
  onOpenWorkspace,
  scope = "platform",
  onRefreshWorkspace,
}: Props) {
  const [retryBusy, setRetryBusy] = useState(false);
  const isWorkspace = scope === "workspace";
  const [orgQuotas, setOrgQuotas] = useState<OrgQuotasView | null>(null);

  const summaryLabel = isWorkspace ? "seus projetos" : "plataforma";

  const primaryOrgId = useMemo(() => {
    const ids = [...new Set(projects.map((p) => p.orgId).filter(Boolean))];
    return ids[0] ?? null;
  }, [projects]);

  const repoCount = useMemo(
    () => projects.reduce((s, p) => s + (p.repos?.length ?? 0), 0),
    [projects],
  );

  useEffect(() => {
    if (!isWorkspace || !primaryOrgId) {
      setOrgQuotas(null);
      return;
    }
    let cancelled = false;
    getWorkspaceOrgQuotas({ orgId: primaryOrgId })
      .then((res) => {
        if (!cancelled) setOrgQuotas(res.quotas);
      })
      .catch(() => {
        if (!cancelled) setOrgQuotas(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isWorkspace, primaryOrgId]);

  function exportExecutiveCsv() {
    const rows: string[][] = [
      ["org", "project", "repo", "gate", "maint", "security", "debtMinutes", "openIssues", "lastAnalyzedAt"],
    ];
    for (const p of projects) {
      for (const r of p.repos) {
        rows.push([
          p.orgName || p.orgId,
          p.name,
          r.name,
          r.qualityGateStatus || "",
          r.maintainabilityRating || p.maintainabilityRating || "",
          r.securityRating || p.securityRating || "",
          String(r.debtMinutes ?? p.debtMinutes ?? 0),
          String(r.openIssues ?? 0),
          r.lastAnalyzedAt || "",
        ]);
      }
    }
    if (issues?.topCauses?.length) {
      rows.push([]);
      rows.push(["ruleId", "severity", "count", "newLast30d", "message"]);
      for (const c of issues.topCauses) {
        rows.push([
          c.ruleId,
          c.severity,
          String(c.count),
          String(c.newLast30d ?? ""),
          (c.message || "").replace(/"/g, "'"),
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codehero-relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maintainability = useMemo(() => {
    const fromSummary = platformSummary?.byMaintainabilityRating;
    if (bucketTotal(fromSummary) > 0) {
      return { buckets: fromSummary!, source: summaryLabel };
    }
    return {
      buckets: bucketsFromProjects(projects, "maintainabilityRating"),
      source: "projetos carregados" as const,
    };
  }, [platformSummary, projects, summaryLabel]);

  const security = useMemo(() => {
    const fromSummary = platformSummary?.bySecurityRating;
    if (bucketTotal(fromSummary) > 0) {
      return { buckets: fromSummary!, source: summaryLabel };
    }
    return {
      buckets: bucketsFromProjects(projects, "securityRating"),
      source: "projetos carregados" as const,
    };
  }, [platformSummary, projects, summaryLabel]);

  const worstSecurity =
    platformSummary?.worstSecurityRating ??
    projects.reduce((acc, p) => worseRating(acc, p.securityRating || "A"), "A");
  const worstMaintainability =
    platformSummary?.worstMaintainabilityRating ??
    projects.reduce((acc, p) => worseRating(acc, p.maintainabilityRating || "A"), "A");
  const failingGates =
    platformSummary?.failingGates ?? projects.filter((p) => p.qualityGateStatus !== "PASSED").length;
  const openIssues =
    platformSummary?.openIssues ?? projects.reduce((s, p) => s + (p.openIssues || 0), 0);
  const debtHours = Math.round(
    (platformSummary?.debtMinutes ?? projects.reduce((s, p) => s + (p.debtMinutes || 0), 0)) / 60,
  );

  async function retrySummary() {
    setRetryBusy(true);
    try {
      if (isWorkspace) {
        if (onRefreshWorkspace) await onRefreshWorkspace();
        return;
      }
      const summary = await adminGetPlatformSummary();
      onSummaryLoaded(summary, null);
    } catch (err) {
      onSummaryLoaded(null, err instanceof Error ? err.message : "Falha ao carregar o resumo.");
    } finally {
      setRetryBusy(false);
    }
  }

  const usingFallback =
    !isWorkspace &&
    (maintainability.source === "projetos carregados" || security.source === "projetos carregados");

  return (
    <>
      <PageHeader
        eyebrow="Portfólio"
        title={isWorkspace ? "Relatório executivo" : "Relatório"}
        description={
          isWorkspace
            ? "Saúde dos seus projetos: ratings, débito, frota de scan e evolução no tempo"
            : "Saúde da amostra: onde investir atenção esta semana"
        }
        actions={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="hero-btn hero-btn-outline" onClick={exportExecutiveCsv}>
              Exportar CSV
            </button>
            <button type="button" className="hero-btn hero-btn-outline" disabled={retryBusy} onClick={() => void retrySummary()}>
              {retryBusy ? "Atualizando…" : "Atualizar resumo"}
            </button>
          </div>
        }
      />

      {isWorkspace && orgQuotas ? (
        <Callout
          tone={
            orgQuotas.buildsThisMonth / Math.max(1, orgQuotas.maxBuildsPerMonth) >= 0.85
              ? "warn"
              : "neutral"
          }
          title="Uso da organização"
        >
          Builds este mês: {orgQuotas.buildsThisMonth.toLocaleString("pt-BR")} /{" "}
          {orgQuotas.maxBuildsPerMonth.toLocaleString("pt-BR")}
          {" · "}
          Repos na amostra: {repoCount.toLocaleString("pt-BR")} (limite {orgQuotas.maxRepos.toLocaleString("pt-BR")})
        </Callout>
      ) : null}

      <KpiGroup>
        <KpiCard
          label="Manutenibilidade"
          value={worstMaintainability}
          sub="pior nota do portfólio"
          tone={ratingTone(worstMaintainability)}
        />
        <KpiCard
          label="Segurança"
          value={worstSecurity}
          sub="pior nota do portfólio"
          tone={ratingTone(worstSecurity)}
        />
        <KpiCard
          label="Gates a corrigir"
          value={failingGates}
          tone={failingGates > 0 ? "danger" : "ok"}
          sub={failingGates === 0 ? "Todos passando" : "Ver frota e condições"}
        />
        <KpiCard label="Apontamentos" value={openIssues} />
        <KpiCard label="Débito técnico" value={`${debtHours}h`} tone={debtHours > 40 ? "warn" : undefined} />
        <KpiCard label="Projetos" value={projects.length} />
      </KpiGroup>

      {summaryError && !isWorkspace && (
        <Callout tone="warn" title="Resumo agregado indisponível">
          {summaryError} Os gráficos usam os projetos já carregados nesta sessão.
        </Callout>
      )}
      {isWorkspace && projects.length > 0 && (
        <Callout tone="neutral" title="Escopo desta visão">
          Só entram os {projects.length} projeto(s) em que você é membro — não o restante da plataforma.
        </Callout>
      )}
      {!summaryError && usingFallback && projects.length > 0 && (
        <Callout tone="neutral" title="Distribuição pela amostra carregada">
          O contador global de ratings ainda está vazio. Mostrando a distribuição dos{" "}
          {projects.length} projeto(s) listados
          {platformSummary ? "" : " — o resumo agregado não respondeu"}.
        </Callout>
      )}

      <div
        style={{
          display: "grid",
          gap: "1.25rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          margin: "1.25rem 0",
        }}
      >
        <DataSection
          title="Manutenibilidade"
          description={`Distribuição A–E · ${maintainability.source}`}
        >
          <RatingDistribution buckets={maintainability.buckets} emptyHint="Ainda sem rating — rode o primeiro scan em Começar." />
        </DataSection>
        <DataSection title="Segurança" description={`Distribuição A–E · ${security.source}`}>
          <RatingDistribution buckets={security.buckets} emptyHint="Ainda sem rating — rode o primeiro scan em Começar." />
        </DataSection>
      </div>

      <FrotaScanSection projects={projects} onOpenWorkspace={onOpenWorkspace} />

      <CodeGraphExecutiveSection projects={projects} onOpenWorkspace={onOpenWorkspace} />

      <EvolucaoHistoricaSection projects={projects} scope={scope} />

      <SinalRuidoSection issues={issues} issuesLoading={issuesLoading} issuesError={issuesError} />

      <DataSection
        title="Principais causas"
        description="Regras que mais geram apontamentos abertos — com Δ dos últimos 30 dias (firstSeen)"
      >
        {issuesError && <div className="hero-error" style={{ marginBottom: "0.75rem" }}>{issuesError}</div>}
        {issuesLoading ? (
          <p className="hero-caption">Carregando causas…</p>
        ) : !issues || issues.topCauses.length === 0 ? (
          <p className="hero-caption">Sem apontamentos abertos. Rode um scan em Começar para popular esta lista.</p>
        ) : (
          <TopCausesTable issues={issues} />
        )}
      </DataSection>

      <div
        style={{
          display: "grid",
          gap: "1.25rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          marginTop: "1.25rem",
        }}
      >
        <DataSection title="Mais apontamentos" description="Repositórios que mais precisam de atenção">
          {issuesLoading ? (
            <p className="hero-caption">Carregando…</p>
          ) : !issues || issues.mostFindings.length === 0 ? (
            <p className="hero-caption">Nenhum dado ainda.</p>
          ) : (
            <RepoFindingList items={issues.mostFindings} tone="danger" onOpen={onOpenWorkspace} projects={projects} />
          )}
        </DataSection>
        <DataSection title="Menos apontamentos" description="Repositórios mais limpos">
          {issuesLoading ? (
            <p className="hero-caption">Carregando…</p>
          ) : !issues || issues.leastFindings.length === 0 ? (
            <p className="hero-caption">Nenhum dado ainda.</p>
          ) : (
            <RepoFindingList items={issues.leastFindings} tone="ok" onOpen={onOpenWorkspace} projects={projects} />
          )}
        </DataSection>
      </div>
    </>
  );
}

const SMELL_SERIES = [
  { key: "debtHours", label: "Débito (h)", color: "#db6d28" },
  { key: "debtRatioPct", label: "Debt ratio (%)", color: "#f85149" },
  { key: "codeSmells", label: "Code smells", color: "#d29922" },
  { key: "findingsTotal", label: "Findings totais", color: "#8b949e" },
];

const COMPLEXITY_SERIES = [
  { key: "cognitivaMedia", label: "Cognitiva média", color: "#58a6ff" },
  { key: "ciclomaticaMedia", label: "Ciclomática média", color: "#388bfd" },
  { key: "maxFanIn", label: "Fan-in máx.", color: "#db6d28" },
  { key: "modulosEmCiclo", label: "Módulos em ciclo", color: "#f85149" },
];

const GRAPH_SIZE_SERIES = [
  { key: "functions", label: "Funções", color: "#388bfd" },
  { key: "calls", label: "Calls", color: "#79c0ff" },
  { key: "edges", label: "Arestas", color: "#3fb950" },
];

const GATE_STATE_SERIES = [
  { key: "gateFailedRepos", label: "Repos com gate FAIL", color: "#f85149" },
  { key: "gatePassedRepos", label: "Repos com gate PASS", color: "#3fb950" },
];

const GATE_BUILDS_SERIES = [
  { key: "buildsPassedDay", label: "Builds PASS", color: "#3fb950" },
  { key: "buildsFailedDay", label: "Builds FAIL", color: "#f85149" },
  { key: "buildsDay", label: "Builds (dia)", color: "#8b949e" },
];

const RATING_SERIES = [
  { key: "maintScore", label: "Manutenibilidade (A=5…E=1)", color: "#d29922" },
  { key: "securityScore", label: "Segurança (A=5…E=1)", color: "#388bfd" },
];

const PLATFORM_DAILY_SERIES = [
  { key: "buildsPassedDay", label: "Gate PASS (plataforma)", color: "#3fb950" },
  { key: "buildsFailedDay", label: "Gate FAIL (plataforma)", color: "#f85149" },
  { key: "buildsDay", label: "Builds", color: "#8b949e" },
];

const QUALITY_COVERAGE_SERIES = [
  { key: "coveragePercent", label: "Cobertura linhas %", color: "#3fb950" },
  { key: "branchCoveragePercent", label: "Cobertura branches %", color: "#388bfd" },
  { key: "duplicationPercent", label: "Duplicação %", color: "#db6d28" },
];

const QUALITY_DEBT_SERIES = [
  { key: "debtRatioPct", label: "Debt ratio (%)", color: "#f85149" },
  { key: "linesOfCode", label: "LOC (portfólio)", color: "#8b949e" },
];

const GATE_SUPPRESSED_SERIES = [
  { key: "gateSuppressed", label: "Findings fora do gate (FP)", color: "#8b949e" },
];
function FrotaScanSection({
  projects,
  onOpenWorkspace,
}: {
  projects: AdminProjectRow[];
  onOpenWorkspace: (orgId: string, projectId: string, repoId?: string) => void;
}) {
  const [staleDays, setStaleDays] = useState(7);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fleet = useMemo(() => buildFleetStatus(projects, { staleAfterDays: staleDays }), [projects, staleDays]);

  function toggle(key: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function selectStale() {
    setSelected(new Set(fleet.repos.filter((r) => r.stale).map((r) => r.key)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const selectedRows = useMemo(
    () => fleet.repos.filter((r) => selected.has(r.key)),
    [fleet.repos, selected],
  );

  async function enableAutoScanSelected() {
    if (selectedRows.length === 0) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    let ok = 0;
    const errors: string[] = [];
    for (const r of selectedRows) {
      try {
        await setRepoAutoScan({
          orgId: r.orgId,
          projectId: r.projectId,
          repoId: r.repoId,
          enabled: true,
          periodicityDays: Math.min(staleDays, r.periodicityDays || staleDays),
        });
        ok += 1;
      } catch (e) {
        errors.push(`${r.repoName}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }
    setBusy(false);
    setMsg(`Auto-scan ligado em ${ok}/${selectedRows.length} repo(s). Use “Atualizar resumo” para refletir o estado.`);
    if (errors.length) setErr(errors.slice(0, 3).join(" · "));
  }

  async function runNowSelected() {
    if (selectedRows.length === 0) return;
    const batch = selectedRows.slice(0, 5);
    setBusy(true);
    setMsg(null);
    setErr(null);
    let ok = 0;
    const errors: string[] = [];
    for (const r of batch) {
      try {
        await runRepoAutoScanNow({ orgId: r.orgId, projectId: r.projectId, repoId: r.repoId });
        ok += 1;
      } catch (e) {
        errors.push(`${r.repoName}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }
    setBusy(false);
    setMsg(
      `Scan disparado em ${ok}/${batch.length} repo(s)` +
        (selectedRows.length > 5 ? ` (limite 5 por lote; ${selectedRows.length - 5} ficaram de fora)` : "") +
        ".",
    );
    if (errors.length) setErr(errors.slice(0, 3).join(" · "));
  }

  if (fleet.repos.length === 0) return null;

  return (
    <DataSection
      title="Frota de scan"
      description={`Quem está cego no portfólio — stale após ${staleDays} dia(s) sem analysis. Selecione e ligue auto-scan ou dispare agora.`}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <label className="hero-caption" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          Stale após
          <select
            value={staleDays}
            onChange={(e) => setStaleDays(Number(e.target.value))}
            style={{ font: "inherit" }}
          >
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="hero-btn hero-btn-outline" onClick={selectStale}>
          Selecionar stale
        </button>
        <button type="button" className="hero-btn hero-btn-outline" onClick={clearSelection} disabled={selected.size === 0}>
          Limpar seleção
        </button>
        <button
          type="button"
          className="hero-btn hero-btn-accent"
          disabled={busy || selectedRows.length === 0}
          onClick={() => void enableAutoScanSelected()}
        >
          {busy ? "Aplicando…" : `Ligar auto-scan (${selectedRows.length})`}
        </button>
        <button
          type="button"
          className="hero-btn hero-btn-outline"
          disabled={busy || selectedRows.length === 0}
          onClick={() => void runNowSelected()}
        >
          Rodar agora (máx. 5)
        </button>
      </div>

      <KpiGroup>
        <KpiCard label="Repos" value={fleet.repos.length} />
        <KpiCard label="Stale" value={fleet.staleCount} tone={fleet.staleCount > 0 ? "warn" : "ok"} />
        <KpiCard label="Nunca escaneados" value={fleet.neverScanned} tone={fleet.neverScanned > 0 ? "danger" : "ok"} />
        <KpiCard label="Gate FAIL" value={fleet.failingGate} tone={fleet.failingGate > 0 ? "danger" : "ok"} />
        <KpiCard label="Sem auto-scan" value={fleet.autoScanOff} tone={fleet.autoScanOff > 0 ? "warn" : "ok"} />
        <KpiCard label="Frescos" value={fleet.fresh} tone="ok" />
      </KpiGroup>

      {msg && (
        <Callout tone="neutral" title="Ação da frota">
          {msg}
        </Callout>
      )}
      {err && (
        <Callout tone="warn" title="Algumas ações falharam">
          {err}
        </Callout>
      )}

      <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
        <table className="hero-table">
          <thead>
            <tr>
              <th />
              <th>Repo</th>
              <th>Projeto</th>
              <th>Último scan</th>
              <th>Dias</th>
              <th>Gate</th>
              <th>Auto-scan</th>
              <th>Débito</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fleet.repos.slice(0, 40).map((r) => (
              <FleetRow
                key={r.key}
                row={r}
                checked={selected.has(r.key)}
                onToggle={() => toggle(r.key)}
                onOpen={() => onOpenWorkspace(r.orgId, r.projectId, r.repoId)}
              />
            ))}
          </tbody>
        </table>
        {fleet.repos.length > 40 && (
          <p className="hero-caption" style={{ marginTop: "0.5rem" }}>
            Mostrando 40 de {fleet.repos.length} repos (priorizados por stale).
          </p>
        )}
      </div>
    </DataSection>
  );
}

function FleetRow({
  row,
  checked,
  onToggle,
  onOpen,
}: {
  row: FleetRepoRow;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const daysLabel = row.neverScanned ? "—" : String(row.daysSinceScan);
  const when = row.lastAnalyzedAt
    ? new Date(row.lastAnalyzedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "nunca";
  return (
    <tr style={{ background: row.stale ? "rgba(248, 81, 73, 0.06)" : undefined }}>
      <td>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Selecionar ${row.repoName}`} />
      </td>
      <td style={{ fontWeight: 600 }}>{row.repoName}</td>
      <td className="hero-caption">
        {row.projectName}
        <div>{row.orgName}</div>
      </td>
      <td>{when}</td>
      <td>
        <span className="hero-badge" style={{ background: row.stale ? "var(--rating-d)" : "var(--rating-a)", color: "#fff" }}>
          {daysLabel}
        </span>
      </td>
      <td>
        <span
          className="hero-badge"
          style={{
            background: row.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)",
            color: "#fff",
          }}
        >
          {row.qualityGateStatus}
        </span>
      </td>
      <td>{row.autoScanEnabled ? `on · ${row.periodicityDays}d` : "off"}</td>
      <td>{Math.round(row.debtMinutes / 60)}h</td>
      <td>
        <button type="button" className="hero-btn hero-btn-outline" style={{ padding: "0.25rem 0.55rem" }} onClick={onOpen}>
          Abrir
        </button>
      </td>
    </tr>
  );
}

function EvolucaoHistoricaSection({
  projects,
  scope = "platform",
}: {
  projects: AdminProjectRow[];
  scope?: "platform" | "workspace";
}) {
  const [history, setHistory] = useState<PortfolioHistorySeries | null>(null);
  const [platformDaily, setPlatformDaily] = useState<PortfolioHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectKey = useMemo(
    () =>
      projects
        .map((p) => `${p.orgId}/${p.projectId}:${p.repos.map((r) => r.repoId).join(",")}`)
        .join("|"),
    [projects],
  );

  useEffect(() => {
    if (projects.length === 0) {
      setHistory(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const tasks: Promise<void>[] = [
      loadWorkspaceAnalysisHistory(projects).then((byRepo) => {
        if (cancelled) return;
        setHistory(buildPortfolioTimeSeries(byRepo));
      }),
    ];
    if (scope === "platform") {
      tasks.push(
        loadPlatformAnalyticsDaily(30)
          .then((rows) => {
            if (cancelled) return;
            setPlatformDaily(analyticsDailyToGatePoints(rows));
          })
          .catch(() => {
            if (!cancelled) setPlatformDaily(null);
          }),
      );
    } else {
      setPlatformDaily(null);
    }
    Promise.all(tasks)
      .catch((err) => {
        if (cancelled) return;
        setHistory(null);
        setError(err instanceof Error ? err.message : "Falha ao carregar histórico de análises.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey, projects, scope]);

  const smellSeries = useMemo(() => {
    let series = SMELL_SERIES;
    if (!history?.smellPoints.some((p) => typeof p.values.codeSmells === "number")) {
      series = series.filter((s) => s.key !== "codeSmells");
    }
    if (!history?.smellPoints.some((p) => typeof p.values.debtRatioPct === "number")) {
      series = series.filter((s) => s.key !== "debtRatioPct");
    }
    return series;
  }, [history]);

  const complexitySeries = useMemo(() => {
    const hasCog = history?.complexityPoints.some((p) => typeof p.values.cognitivaMedia === "number");
    if (hasCog) return COMPLEXITY_SERIES;
    return COMPLEXITY_SERIES.filter((s) => s.key === "maxFanIn" || s.key === "modulosEmCiclo");
  }, [history]);

  const hasGraphSize = history?.complexityPoints.some(
    (p) => (p.values.functions ?? 0) > 0 || (p.values.calls ?? 0) > 0,
  );

  const hasCoverage = history?.qualityPoints.some(
    (p) => typeof p.values.coveragePercent === "number" || typeof p.values.duplicationPercent === "number",
  );
  const hasDebtRatio = history?.qualityPoints.some((p) => typeof p.values.debtRatioPct === "number");
  const hasGateSuppressed = history?.gatePoints.some((p) => (p.values.gateSuppressed ?? 0) > 0);

  const coverageSeries = useMemo(() => {
    if (!history) return QUALITY_COVERAGE_SERIES;
    return QUALITY_COVERAGE_SERIES.filter((s) =>
      history.qualityPoints.some((p) => typeof p.values[s.key] === "number"),
    );
  }, [history]);

  const lastGate = history?.gatePoints[history.gatePoints.length - 1];
  const lastQuality = history?.qualityPoints[history.qualityPoints.length - 1];
  return (
    <>
      <DataSection
        title="Saúde do quality gate"
        description="Quantos repos passam ou falham ao longo do tempo, e quais condições derrubam o gate hoje."
      >
        {loading && <p className="hero-caption">Carregando gate e histórico…</p>}
        {error && (
          <Callout tone="warn" title="Histórico indisponível">
            {error}
          </Callout>
        )}
        {!loading && history && history.gatePoints.length === 0 && (
          <Callout tone="neutral" title="Sem dados de gate ainda">
            Após a primeira analysis sincronizada, a série de pass/fail e as condições falhas aparecem aqui.
          </Callout>
        )}
        {!loading && history && history.gatePoints.length > 0 && (
          <>
            <KpiGroup>
              <KpiCard
                label="Repos gate FAIL"
                value={lastGate?.values.gateFailedRepos ?? 0}
                tone={(lastGate?.values.gateFailedRepos ?? 0) > 0 ? "danger" : "ok"}
              />
              <KpiCard label="Repos gate PASS" value={lastGate?.values.gatePassedRepos ?? 0} tone="ok" />
              <KpiCard
                label="Condições falhas (tipos)"
                value={history.failedConditionCounts.length}
                sub="no snapshot atual"
              />
              {hasGateSuppressed ? (
                <KpiCard
                  label="Fora do gate (FP)"
                  value={lastGate?.values.gateSuppressed ?? 0}
                  tone="warn"
                  sub="último dia (carry-forward)"
                />
              ) : null}
            </KpiGroup>
            <div
              style={{
                display: "grid",
                gap: "1.25rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                marginTop: "1rem",
              }}
            >
              <div className="ch-metric-card">
                <h3>Repos PASS / FAIL ao longo do tempo</h3>
                <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                  Carry-forward: quantos repos estavam FAIL ou PASS em cada dia com scan.
                </p>
                <TimeSeriesChart points={history.gatePoints} series={GATE_STATE_SERIES} />
              </div>
              <div className="ch-metric-card">
                <h3>Builds do dia (amostra)</h3>
                <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                  Contagem de analyses no dia — não é carry-forward.
                </p>
                <TimeSeriesChart points={history.gatePoints} series={GATE_BUILDS_SERIES} />
              </div>
              {hasGateSuppressed ? (
                <div className="ch-metric-card">
                  <h3>Findings fora do gate (FP local)</h3>
                  <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                    Somatório carry-forward de findings com gateSuppressed (taxa FP alta no repo).
                  </p>
                  <TimeSeriesChart points={history.gatePoints} series={GATE_SUPPRESSED_SERIES} />
                </div>
              ) : null}
              <div className="ch-metric-card">
                <h3>Condições que derrubam o gate</h3>
                {history.failedConditionCounts.length === 0 ? (
                  <p className="hero-caption">Nenhuma condição falha no snapshot atual.</p>
                ) : (
                  <VerticalBars data={history.failedConditionCounts} maxBars={8} />
                )}
              </div>
              {history.ratingPoints.some(
                (p) => p.values.maintScore != null || p.values.securityScore != null,
              ) ? (
                <div className="ch-metric-card">
                  <h3>Ratings médios (A=5 … E=1)</h3>
                  <TimeSeriesChart points={history.ratingPoints} series={RATING_SERIES} />
                </div>
              ) : null}
              {scope === "platform" && platformDaily && platformDaily.length > 0 ? (
                <div className="ch-metric-card" style={{ gridColumn: "1 / -1" }}>
                  <h3>analyticsDaily (plataforma · 30 dias)</h3>
                  <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                    Rollup global de builds e gate — sobrevive ao purge de analyses detalhadas.
                  </p>
                  <TimeSeriesChart points={platformDaily} series={PLATFORM_DAILY_SERIES} height={160} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </DataSection>

      <DataSection
        title="Evolução histórica"
        description="Série temporal a partir das analyses — smells, debt ratio, cobertura/duplicação e complexidade. Carry-forward por repositório em cada dia com scan."
      >
        {loading && <p className="hero-caption">Carregando histórico de analyses…</p>}
        {error && (
          <Callout tone="warn" title="Histórico indisponível">
            {error}
          </Callout>
        )}
        {!loading && !error && history && history.smellPoints.length === 0 && (
          <Callout tone="neutral" title="Ainda sem histórico">
            Rode avaliações no CI ou no plugin e sincronize o SARIF. Cada analysis gera um ponto na série
            (débito, smells e, quando houver métricas, complexidade do grafo).
          </Callout>
        )}
        {!loading && history && history.smellPoints.length > 0 && (
          <>
            <KpiGroup>
              <KpiCard
                label="Analyses no período"
                value={history.analysisCount.toLocaleString("pt-BR")}
                sub={`${history.repoCountWithHistory} repo(s) com histórico`}
              />
              <KpiCard
                label="Dias com scan"
                value={String(history.smellPoints.length)}
                sub="pontos na série"
              />
              <KpiCard
                label="Débito atual (série)"
                value={`${history.smellPoints[history.smellPoints.length - 1]?.values.debtHours ?? 0}h`}
                sub="último dia com análise"
                tone="warn"
              />
              <KpiCard
                label="Cobertura (série)"
                value={
                  lastQuality?.values.coveragePercent != null
                    ? `${lastQuality.values.coveragePercent}%`
                    : "—"
                }
                sub={
                  lastQuality?.values.reposWithCoverage
                    ? `${lastQuality.values.reposWithCoverage} repo(s) medidos`
                    : "ainda sem medida"
                }
              />
            </KpiGroup>

            <div
              style={{
                display: "grid",
                gap: "1.25rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                marginTop: "1rem",
              }}
            >
              <div className="ch-metric-card">
                <h3>Smells e débito técnico</h3>
                <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                  Débito em horas (somatório de effort de CODE_SMELL). Contagem de smells exige analyses
                  recentes com `byType`.
                </p>
                <TimeSeriesChart points={history.smellPoints} series={smellSeries} />
              </div>
              <div className="ch-metric-card">
                <h3>Complexidade (grafo / arquitetura)</h3>
                <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                  Cognitiva e ciclomática médias (ponderadas), fan-in máximo e módulos em ciclo de
                  importação.
                </p>
                <TimeSeriesChart points={history.complexityPoints} series={complexitySeries} />
              </div>
              {hasGraphSize ? (
                <div className="ch-metric-card" style={{ gridColumn: "1 / -1" }}>
                  <h3>Tamanho estrutural do grafo</h3>
                  <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                    Funções, calls e arestas agregados do code-graph ao longo do tempo.
                  </p>
                  <TimeSeriesChart points={history.complexityPoints} series={GRAPH_SIZE_SERIES} height={160} />
                </div>
              ) : null}
              {hasCoverage || hasDebtRatio ? (
                <>
                  {hasCoverage && coverageSeries.length > 0 ? (
                    <div className="ch-metric-card">
                      <h3>Cobertura e duplicação</h3>
                      <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                        Média ponderada por LOC nos repos que enviaram medida. Ausência = gate pula a
                        condição (não conta como 100%).
                      </p>
                      <TimeSeriesChart points={history.qualityPoints} series={coverageSeries} />
                      {lastQuality?.values.reposWithCoverage != null ? (
                        <p className="hero-caption" style={{ marginTop: "0.5rem" }}>
                          Último dia: {lastQuality.values.reposWithCoverage} repo(s) com cobertura
                          {lastQuality.values.reposWithDupe != null
                            ? ` · ${lastQuality.values.reposWithDupe} com duplicação`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {hasDebtRatio ? (
                    <div className="ch-metric-card">
                      <h3>Debt ratio e LOC</h3>
                      <p className="hero-caption" style={{ marginBottom: "0.65rem" }}>
                        Ratio normalizado pelo tamanho — horas absolutas mentem quando o repo cresce.
                      </p>
                      <TimeSeriesChart points={history.qualityPoints} series={QUALITY_DEBT_SERIES} />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="ch-metric-card" style={{ gridColumn: "1 / -1" }}>
                  <h3>Cobertura / duplicação / debt ratio</h3>
                  <Callout tone="neutral" title="Aguardando analyses com métricas">
                    Depois do deploy, novos scans gravam cobertura %, duplicação % e debt ratio no
                    summary. Repos antigos só mostram LOC/débito até reanalisar.
                  </Callout>
                </div>
              )}
            </div>
          </>
        )}
      </DataSection>
    </>
  );
}

function TopCausesTable({ issues }: { issues: AdminIssuesResult }) {
  const rows = useMemo(() => buildTopRulesDelta(issues, 25), [issues]);
  const hasDelta = rows.some((r) => r.newLast30d > 0);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="hero-table">
        <thead>
          <tr>
            <th>Regra</th>
            <th>Severidade</th>
            <th style={{ textAlign: "right" }}>Abertos</th>
            {hasDelta ? <th style={{ textAlign: "right" }}>Novos 30d</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.ruleId}>
              <td>
                <code style={{ fontSize: "0.8rem" }}>{c.ruleId}</code>
                <div className="hero-caption" style={{ marginTop: "0.15rem" }}>
                  {c.message}
                </div>
              </td>
              <td>
                <span
                  className="hero-badge"
                  style={{ background: severityColor[c.severity] ?? "var(--muted)", color: "#fff" }}
                >
                  {c.severity}
                </span>
              </td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{c.count}</td>
              {hasDelta ? (
                <td style={{ textAlign: "right", fontWeight: c.newLast30d > 0 ? 700 : 400 }}>
                  {c.newLast30d > 0 ? `+${c.newLast30d}` : "—"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SinalRuidoSection({
  issues,
  issuesLoading,
  issuesError,
}: {
  issues: AdminIssuesResult | null;
  issuesLoading: boolean;
  issuesError: string | null;
}) {
  const signal = useMemo(() => buildSignalNoisePortfolio(issues), [issues]);
  return (
    <DataSection
      title="Sinal vs ruído"
      description="Triagem do ranker FP e findings fora do gate por feedback local — priorize o que é assertivo."
    >
      {issuesError && <div className="hero-error" style={{ marginBottom: "0.75rem" }}>{issuesError}</div>}
      {issuesLoading ? (
        <p className="hero-caption">Carregando apontamentos…</p>
      ) : signal.total === 0 ? (
        <p className="hero-caption">Sem apontamentos abertos para classificar.</p>
      ) : (
        <>
          <KpiGroup>
            <KpiCard label="Abertos na amostra" value={signal.total.toLocaleString("pt-BR")} />
            <KpiCard
              label="Com ranker FP"
              value={signal.ranked.toLocaleString("pt-BR")}
              sub={`${signal.total > 0 ? Math.round((signal.ranked / signal.total) * 100) : 0}% ranqueados`}
            />
            <KpiCard
              label="Fora do gate"
              value={signal.gateSuppressed}
              tone={signal.gateSuppressed > 0 ? "warn" : "ok"}
              sub="FP local alto"
            />
            <KpiCard
              label="Possível FP"
              value={signal.highFp}
              tone={signal.highFp > 0 ? "warn" : undefined}
              sub="fpLikelihood ≥ 55%"
            />
          </KpiGroup>
          <div
            style={{
              display: "grid",
              gap: "1.25rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              marginTop: "1rem",
            }}
          >
            <div className="ch-metric-card">
              <h3>Triagem</h3>
              {signal.triageBuckets.length === 0 ? (
                <p className="hero-caption">Sem scores de assertividade/FP nesta amostra.</p>
              ) : (
                <VerticalBars data={signal.triageBuckets} maxBars={4} />
              )}
            </div>
            <div className="ch-metric-card">
              <h3>Distribuição fpLikelihood</h3>
              {signal.fpBuckets.length === 0 ? (
                <p className="hero-caption">Ranker ainda não pontuou estes findings.</p>
              ) : (
                <VerticalBars data={signal.fpBuckets} maxBars={4} />
              )}
            </div>
          </div>
        </>
      )}
    </DataSection>
  );
}

const HOP_LABEL: Record<string, string> = {
  entry: "Entry (0 hops)",
  hop1: "1 hop",
  hop2: "2 hops",
  hop3plus: "3+ hops",
  unknown: "Sem caminho",
};
const HOP_COLOR: Record<string, string> = {
  entry: "#3fb950",
  hop1: "#58a6ff",
  hop2: "#d29922",
  hop3plus: "#db6d28",
  unknown: "#8b949e",
};

function CodeGraphExecutiveSection({
  projects,
  onOpenWorkspace,
}: {
  projects: AdminProjectRow[];
  onOpenWorkspace: (orgId: string, projectId: string, repoId?: string) => void;
}) {
  const graph = useMemo(() => aggregateCodeGraphs(projects), [projects]);
  const arq = useMemo(() => aggregateArquitetura(projects), [projects]);
  const coveragePct =
    graph.repoCount > 0 ? Math.round((graph.reposWithGraph / graph.repoCount) * 100) : 0;
  const hopRows = (["entry", "hop1", "hop2", "hop3plus", "unknown"] as const)
    .map((k) => ({ label: HOP_LABEL[k]!, value: graph.hopBuckets[k], color: HOP_COLOR[k] }))
    .filter((r) => r.value > 0);
  const mergedViz =
    graph.hotspots.length > 0
      ? {
          version: 1 as const,
          nodes: graph.nodes,
          edges: graph.edges,
          functions: graph.functions,
          calls: graph.calls,
          imports: graph.imports,
          entries: graph.entries,
          hotspots: graph.hotspots.map((h) => ({
            id: h.id,
            name: h.name,
            file: h.file,
            fanIn: h.fanIn,
            fanOut: h.fanOut,
            hopsToEntry: h.hopsToEntry,
          })),
          links: [],
        }
      : null;

  return (
    <div style={{ margin: "1.5rem 0 0.5rem" }}>
      <DataSection
        title="Grafo do código avaliado"
        description="Estrutura determinística (funções, calls, imports) — sem Gen AI. Agregado dos repositórios com scan + métricas."
      >
        <KpiGroup>
          <KpiCard
            label="Repos com grafo"
            value={`${graph.reposWithGraph}/${graph.repoCount}`}
            sub={`${coveragePct}% da amostra`}
            tone={graph.reposWithGraph === 0 ? "warn" : "ok"}
          />
          <KpiCard label="Funções" value={graph.functions.toLocaleString("pt-BR")} />
          <KpiCard label="Calls" value={graph.calls.toLocaleString("pt-BR")} />
          <KpiCard label="Imports" value={graph.imports.toLocaleString("pt-BR")} />
          <KpiCard label="Entries" value={graph.entries.toLocaleString("pt-BR")} />
          <KpiCard
            label="Nós · arestas"
            value={`${graph.nodes.toLocaleString("pt-BR")} · ${graph.edges.toLocaleString("pt-BR")}`}
          />
        </KpiGroup>

        {graph.reposWithGraph === 0 ? (
          <Callout tone="neutral" title="Ainda sem code-graph nesta amostra">
            Rode a avaliação no plugin ou no CI com métricas (o scanner gera o grafo automaticamente) e
            sincronize o SARIF. O workspace mostra o diagrama depois do ingest.
          </Callout>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "1.25rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              marginTop: "1rem",
            }}
          >
            <div className="ch-metric-card" style={{ gridColumn: "auto" }}>
              <h3>Composição estrutural</h3>
              <VerticalBars data={graph.composition} maxBars={4} />
            </div>
            <div className="ch-metric-card">
              <h3>Exposição até entrypoint</h3>
              {hopRows.length === 0 ? (
                <p className="hero-caption">Sem hotspots com hops medidos.</p>
              ) : (
                <VerticalBars data={hopRows} maxBars={5} />
              )}
            </div>
            <div className="ch-metric-card">
              <h3>Repositórios com mais funções</h3>
              {graph.topRepos.length === 0 ? (
                <p className="hero-caption">Sem dados.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.4rem" }}>
                  {graph.topRepos.slice(0, 8).map((r) => (
                    <button
                      key={`${r.orgId}/${r.projectId}/${r.repoId}`}
                      type="button"
                      className="hero-panel-sm"
                      onClick={() => onOpenWorkspace(r.orgId, r.projectId, r.repoId)}
                      style={{
                        padding: "0.55rem 0.75rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "0.65rem",
                        width: "100%",
                        textAlign: "left",
                        cursor: "pointer",
                        border: "1px solid var(--line)",
                        background: "var(--surface)",
                        font: "inherit",
                        color: "inherit",
                      }}
                    >
                      <div>
                        <strong>{r.repoName}</strong>
                        <div className="hero-caption">
                          {r.projectName} · fan-in máx. {r.maxFanIn}
                        </div>
                      </div>
                      <span className="hero-badge" style={{ background: "#388bfd", color: "#fff" }}>
                        {r.functions.toLocaleString("pt-BR")} fn
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mergedViz ? (
          <div style={{ marginTop: "1.1rem" }}>
            <CodeGraphPanel graph={mergedViz} title="Hotspots do portfólio (maior fan-in)" />
          </div>
        ) : null}
      </DataSection>

      <DataSection
        title="Acoplamento e custo de mudança"
        description="A outra metade do grafo. A seção acima mostra quais FUNÇÕES estão expostas; esta mostra em quais MÓDULOS mexer custa caro. Uma função exposta pode estar num módulo trivial de trocar, e um módulo caríssimo pode não ter função exposta nenhuma."
      >
        {arq.reposComLeitura === 0 ? (
          <Callout tone="neutral" title="Ainda sem leitura arquitetural nesta amostra">
            Ela sai do mesmo scan do code-graph, desde que a avaliação rode com métricas. Repositórios
            analisados antes desta versão só passam a mostrar o dado no próximo scan.
          </Callout>
        ) : (
          <>
            <KpiGroup>
              <KpiCard label="Módulos" value={arq.modulos.toLocaleString("pt-BR")} />
              <KpiCard
                label="Complexidade cognitiva"
                value={String(arq.cognitivaMedia)}
                sub="média por função — esforço de ler"
              />
              <KpiCard label="Arestas internas" value={arq.arestasInternas.toLocaleString("pt-BR")} />
              <KpiCard
                label="Dependências externas"
                value={arq.dependenciasExternas.toLocaleString("pt-BR")}
              />
              <KpiCard
                label="Módulos em ciclo"
                value={arq.modulosEmCiclo.toLocaleString("pt-BR")}
                sub={arq.modulosEmCiclo > 0 ? "importação circular" : "nenhum"}
              />
              <KpiCard
                label="Módulos órfãos"
                value={arq.modulosOrfaos.toLocaleString("pt-BR")}
                sub="ninguém importa e não são entrada"
              />
            </KpiGroup>

            {arq.ciclos.length > 0 && (
              <div className="ch-metric-card" style={{ marginTop: "1rem" }}>
                <h3>Importação circular</h3>
                <p className="hero-caption" style={{ marginTop: 0 }}>
                  Cada arquivo, olhado sozinho, parece razoável. Só o grafo mostra que eles se seguram
                  em pé mutuamente e nenhum sai sem os outros.
                </p>
                <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.6rem" }}>
                  {arq.ciclos.map((c) => (
                    <div key={`${c.repoName}-${c.id}`} className="hero-panel-sm" style={{ padding: "0.55rem 0.75rem" }}>
                      <strong>{c.repoName}</strong>
                      <span className="hero-caption"> · {c.modulos.length} módulos</span>
                      <div className="hero-caption" style={{ marginTop: "0.3rem", lineHeight: 1.7 }}>
                        {c.modulos.join(" → ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="ch-metric-card" style={{ marginTop: "1rem" }}>
              <h3>Onde mexer custa caro</h3>
              <p className="hero-caption" style={{ marginTop: 0 }}>
                Ordenado por complexidade cognitiva × alcance. Complexidade sozinha ordena errado: uma
                função complicada que ninguém importa custa zero para deixar quieta.
              </p>
              <div style={{ overflowX: "auto", marginTop: "0.7rem" }}>
                <table className="arq-tabela">
                  <thead>
                    <tr>
                      <th>Repositório</th>
                      <th>Módulo</th>
                      <th title="Quantos módulos dependem deste">Ca</th>
                      <th title="De quantos módulos este depende">Ce</th>
                      <th title="Instabilidade Ce/(Ca+Ce): 0 é rocha, 1 é folha">I</th>
                      <th>Cogn.</th>
                      <th>Risco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arq.risco.map((m) => (
                      <tr key={`${m.repoName}-${m.arquivo}`}>
                        <td>{m.repoName}</td>
                        <td className="arq-caminho" title={m.arquivo}>
                          {m.arquivo}
                        </td>
                        <td className="arq-num">{m.ca}</td>
                        <td className="arq-num">{m.ce}</td>
                        <td className="arq-num">
                          {m.instabilidade === null ? "—" : m.instabilidade.toFixed(2)}
                        </td>
                        <td className="arq-num">{m.cognitiva}</td>
                        <td className="arq-num arq-risco">{Math.round(m.risco).toLocaleString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </DataSection>
    </div>
  );
}

function RatingDistribution({
  buckets,
  emptyHint = "Sem dados ainda.",
}: {
  buckets: Record<string, number>;
  emptyHint?: string;
}) {
  const total = bucketTotal(buckets);
  if (total === 0) return <p className="hero-caption">{emptyHint}</p>;
  return (
    <div style={{ display: "grid", gap: "0.65rem" }} role="list" aria-label="Distribuição de ratings">
      {RATING_ORDER.map((r) => {
        const count = buckets[r] ?? 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div
            key={r}
            role="listitem"
            style={{ display: "grid", gridTemplateColumns: "2rem 1fr auto", alignItems: "center", gap: "0.6rem" }}
          >
            <span
              className="hero-rating"
              style={{
                background: ratingColor[r],
                width: "1.75rem",
                height: "1.75rem",
                fontSize: "0.8rem",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {r}
            </span>
            <div
              style={{
                background: "color-mix(in srgb, var(--line) 18%, transparent)",
                borderRadius: 6,
                overflow: "hidden",
                height: 12,
              }}
              title={`${count} projeto(s) · ${pct}%`}
            >
              <div
                style={{
                  width: `${Math.max(pct, count > 0 ? 4 : 0)}%`,
                  background: ratingColor[r],
                  height: "100%",
                  borderRadius: 6,
                  transition: "width 0.35s ease",
                }}
              />
            </div>
            <span className="hero-caption" style={{ minWidth: "4.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {count} · {pct}%
            </span>
          </div>
        );
      })}
      <p className="hero-caption" style={{ margin: "0.15rem 0 0" }}>
        {total} projeto(s) no total
      </p>
    </div>
  );
}

function RepoFindingList({
  items,
  tone,
  onOpen,
  projects,
}: {
  items: AdminRepoFindingCount[];
  tone: "danger" | "ok";
  onOpen: (orgId: string, projectId: string, repoId?: string) => void;
  projects: AdminProjectRow[];
}) {
  function resolve(it: AdminRepoFindingCount): { orgId: string; projectId: string; repoId: string } | null {
    if (it.orgId && it.projectId) {
      return { orgId: it.orgId, projectId: it.projectId, repoId: it.repoId };
    }
    for (const p of projects) {
      if (p.repos.some((r) => r.repoId === it.repoId)) {
        return { orgId: p.orgId, projectId: p.projectId, repoId: it.repoId };
      }
    }
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {items.map((it) => {
        const target = resolve(it);
        return (
          <button
            key={`${it.orgId ?? it.orgName}/${it.projectId ?? it.projectName}/${it.repoId}`}
            type="button"
            className="hero-panel-sm"
            disabled={!target}
            onClick={() => {
              if (target) onOpen(target.orgId, target.projectId, target.repoId);
            }}
            style={{
              padding: "0.65rem 0.85rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
              width: "100%",
              textAlign: "left",
              cursor: target ? "pointer" : "default",
              border: "1px solid var(--line)",
              background: "var(--surface)",
              font: "inherit",
              color: "inherit",
              opacity: target ? 1 : 0.85,
            }}
          >
            <div>
              <strong>{it.repoName}</strong>
              <div className="hero-caption">
                {it.projectName} · {it.orgName}
              </div>
            </div>
            <span
              className="hero-badge"
              style={{
                background: tone === "danger" ? "var(--rating-e)" : "var(--rating-a)",
                color: "#fff",
              }}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
