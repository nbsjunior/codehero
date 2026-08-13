"use client";

import { useMemo, useState } from "react";
import { Callout, DataSection, KpiCard, KpiGroup, PageHeader } from "@/components/AdminUi";
import { CodeGraphPanel } from "@/components/CodeGraphPanel";
import { VerticalBars } from "@/components/RepoHealthCharts";
import {
  adminGetPlatformSummary,
  type AdminIssuesResult,
  type AdminProjectRow,
  type AdminRepoFindingCount,
  type PlatformSummary,
} from "@/lib/api";
import { aggregateCodeGraphs } from "@/lib/workspaceInsights";

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

  const summaryLabel = isWorkspace ? "seus projetos" : "plataforma";

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
        eyebrow="Visão"
        title={isWorkspace ? "Relatório executivo" : "Relatório"}
        description={
          isWorkspace
            ? "Ratings, débito, grafo estrutural e achados dos seus projetos"
            : "Ratings, débito, grafo do código avaliado e onde a plataforma precisa de atenção"
        }
        actions={
          <button type="button" className="hero-btn hero-btn-outline" disabled={retryBusy} onClick={() => void retrySummary()}>
            {retryBusy ? "Atualizando…" : "Atualizar resumo"}
          </button>
        }
      />

      <KpiGroup>
        <KpiCard label="Pior manutenibilidade" value={worstMaintainability} tone={ratingTone(worstMaintainability)} />
        <KpiCard label="Pior segurança" value={worstSecurity} tone={ratingTone(worstSecurity)} />
        <KpiCard label="Gates falhando" value={failingGates} tone={failingGates > 0 ? "danger" : "ok"} />
        <KpiCard label="Issues abertas" value={openIssues} />
        <KpiCard label="Débito" value={`${debtHours}h`} />
        <KpiCard label="Projetos na amostra" value={projects.length} />
      </KpiGroup>

      {summaryError && !isWorkspace && (
        <Callout tone="warn" title="Resumo agregado indisponível">
          {summaryError} Os gráficos usam os projetos já carregados nesta sessão.
        </Callout>
      )}
      {isWorkspace && projects.length > 0 && (
        <Callout tone="neutral" title="Escopo do workspace">
          Visão limitada às {projects.length} organização(ões)/projeto(s) em que você é membro — não inclui o
          restante da plataforma.
        </Callout>
      )}
      {!summaryError && usingFallback && projects.length > 0 && (
        <Callout tone="neutral" title="Distribuição pela amostra carregada">
          O contador global de ratings ainda não tem dados (ou está vazio). Mostrando a distribuição dos{" "}
          {projects.length} projeto(s) listados no painel
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
          <RatingDistribution buckets={maintainability.buckets} emptyHint="Nenhum projeto com rating ainda." />
        </DataSection>
        <DataSection title="Segurança" description={`Distribuição A–E · ${security.source}`}>
          <RatingDistribution buckets={security.buckets} emptyHint="Nenhum projeto com rating ainda." />
        </DataSection>
      </div>

      <CodeGraphExecutiveSection projects={projects} onOpenWorkspace={onOpenWorkspace} />

      <DataSection
        title="Principais causas"
        description="Regras que mais geram apontamentos abertos"
      >
        {issuesError && <div className="hero-error" style={{ marginBottom: "0.75rem" }}>{issuesError}</div>}
        {issuesLoading ? (
          <p className="hero-caption">Carregando causas…</p>
        ) : !issues || issues.topCauses.length === 0 ? (
          <p className="hero-caption">Nenhum apontamento aberto ainda.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="hero-table">
              <thead>
                <tr>
                  <th>Regra</th>
                  <th>Severidade</th>
                  <th style={{ textAlign: "right" }}>Ocorrências</th>
                </tr>
              </thead>
              <tbody>
                {issues.topCauses.map((c) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
