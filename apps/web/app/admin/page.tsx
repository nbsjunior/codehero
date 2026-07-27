"use client";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import {
  adminListAllIssues,
  adminListAllProjects,
  checkPlatformAdmin,
  listFeatureFlags,
  listRuleforgeRuns,
  setFeatureFlag,
  type AdminIssueRow,
  type AdminIssuesResult,
  type AdminProjectRow,
  type FeatureFlag,
  type RepoRow,
  type RuleforgeRun,
} from "@/lib/api";

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

const sourceLabel: Record<string, string> = {
  "github-action": "GitHub Action",
  "auto-scan": "Checagem automática",
  cli: "CLI",
};

function worseRating(a: string, b: string): string {
  const order = ["A", "B", "C", "D", "E"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function AdminHome() {
  const [status, setStatus] = useState<"checking" | "denied" | "loading" | "ready" | "error">("checking");
  const [orgCount, setOrgCount] = useState(0);
  const [projects, setProjects] = useState<AdminProjectRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Feature toggles
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [flagKey, setFlagKey] = useState("");
  const [flagDesc, setFlagDesc] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  // Genkit agentic pipeline (hero-ruleforge daily)
  const [runs, setRuns] = useState<RuleforgeRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Apontamentos da esteira (github action + checagem automática), todos os repos
  const [issues, setIssues] = useState<AdminIssuesResult | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isAdmin = await checkPlatformAdmin();
        if (cancelled) return;
        if (!isAdmin) {
          setStatus("denied");
          return;
        }
        setStatus("loading");
        const { orgCount: oc, projects: rows } = await adminListAllProjects();
        if (cancelled) return;
        setOrgCount(oc);
        setProjects(rows);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Falha ao carregar dados de admin.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    listFeatureFlags()
      .then(({ flags: rows }) => {
        if (!cancelled) setFlags(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setFlagsLoading(false);
      });
    listRuleforgeRuns(14)
      .then(({ runs: rows }) => {
        if (!cancelled) setRuns(rows);
      })
      .catch((err) => {
        if (!cancelled) setRunsError(err instanceof Error ? err.message : "Falha ao carregar a esteira.");
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    adminListAllIssues()
      .then((res) => {
        if (!cancelled) setIssues(res);
      })
      .catch((err) => {
        if (!cancelled) setIssuesError(err instanceof Error ? err.message : "Falha ao carregar os apontamentos.");
      })
      .finally(() => {
        if (!cancelled) setIssuesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function handleCreateFlag(e: FormEvent) {
    e.preventDefault();
    setFlagBusy(true);
    setFlagError(null);
    try {
      await setFeatureFlag({ key: flagKey.trim(), enabled: true, description: flagDesc.trim() });
      const { flags: rows } = await listFeatureFlags();
      setFlags(rows);
      setFlagKey("");
      setFlagDesc("");
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : "Falha ao criar o flag.");
    } finally {
      setFlagBusy(false);
    }
  }

  async function handleToggleFlag(flag: FeatureFlag) {
    setFlagError(null);
    try {
      await setFeatureFlag({ key: flag.key, enabled: !flag.enabled, description: flag.description });
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: !f.enabled } : f)));
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : "Falha ao atualizar o flag.");
    }
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (status === "checking" || status === "loading") {
    return (
      <main className="hero-shell">
        <p className="hero-caption">Carregando painel de admin…</p>
      </main>
    );
  }

  if (status === "denied") {
    return (
      <main className="hero-shell">
        <div className="hero-panel" style={{ padding: "2rem", textAlign: "center" }}>
          <span className="hero-burst" style={{ margin: "0 auto 1rem" }}>
            🚫
          </span>
          <h1 className="hero-display" style={{ fontSize: "1.8rem", margin: "0 0 0.5rem" }}>
            Acesso restrito
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Esta área é exclusiva do administrador geral da plataforma. Se você deveria ter acesso, peça para ele
            rodar <code>node scripts/seed-admin.mjs seu-email@dominio.com</code>.
          </p>
          <Link href="/" className="hero-link" style={{ display: "inline-block", marginTop: "1rem" }}>
            ← Voltar ao dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="hero-shell">
        <div className="hero-error">{errorMsg}</div>
      </main>
    );
  }

  const allRepos = projects.flatMap((p) => p.repos);
  const totalDebtHours = Math.round(projects.reduce((sum, p) => sum + p.debtMinutes, 0) / 60);
  const totalOpenIssues = projects.reduce((sum, p) => sum + p.openIssues, 0);
  const failingGates = projects.filter((p) => p.qualityGateStatus !== "PASSED").length;
  const worstSecurity = projects.reduce((acc, p) => worseRating(acc, p.securityRating), "A");

  return (
    <main className="hero-shell">
      <header>
        <h1 className="hero-display" style={{ fontSize: "2.25rem", margin: "0 0 0.25rem" }}>
          Painel do Admin Geral
        </h1>
        <p className="hero-caption" style={{ margin: 0 }}>
          consolidação de resultados de toda a plataforma · {orgCount} organização(ões) · {projects.length}{" "}
          projeto(s) · {allRepos.length} repositório(s)
        </p>
      </header>

      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", margin: "1.75rem 0" }}>
        <StatCard label="Organizações" value={orgCount} />
        <StatCard label="Projetos" value={projects.length} />
        <StatCard label="Repositórios" value={allRepos.length} />
        <StatCard label="Débito total" value={`${totalDebtHours}h`} />
        <StatCard label="Issues abertas" value={totalOpenIssues} />
        <StatCard label="Gates falhando" value={failingGates} accent={failingGates > 0} />
        <StatCard
          label="Pior segurança"
          value={worstSecurity}
          accentColor={ratingColor[worstSecurity]}
        />
      </div>

      {/* Feature toggles — site-wide, admin geral only */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.3rem", margin: "0 0 0.35rem" }}>
          Feature Toggles
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          liga/desliga recursos em todo o site — qualquer código do portal pode checar um flag
        </p>

        <form onSubmit={handleCreateFlag} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <input
            className="hero-input"
            style={{ flex: "1 1 200px" }}
            required
            placeholder="chave-do-flag (ex.: cloud-preview-scan)"
            value={flagKey}
            onChange={(e) => setFlagKey(e.target.value)}
          />
          <input
            className="hero-input"
            style={{ flex: "2 1 260px" }}
            placeholder="descrição (opcional)"
            value={flagDesc}
            onChange={(e) => setFlagDesc(e.target.value)}
          />
          <button type="submit" className="hero-btn hero-btn-accent" disabled={flagBusy}>
            {flagBusy ? "Criando…" : "+ Criar flag (ligado)"}
          </button>
        </form>
        {flagError && (
          <div className="hero-error" style={{ marginBottom: "1rem" }}>
            {flagError}
          </div>
        )}

        {flagsLoading ? (
          <p className="hero-caption">Carregando flags…</p>
        ) : flags.length === 0 ? (
          <p className="hero-caption">Nenhum flag criado ainda.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {flags.map((f) => (
              <div
                key={f.key}
                className="hero-panel-sm"
                style={{ padding: "0.7rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}
              >
                <div>
                  <code style={{ fontWeight: 700 }}>{f.key}</code>
                  {f.description ? <span className="hero-caption" style={{ marginLeft: "0.6rem" }}>{f.description}</span> : null}
                </div>
                <button
                  type="button"
                  className="hero-btn"
                  style={{
                    padding: "0.35rem 0.8rem",
                    fontSize: "0.78rem",
                    background: f.enabled ? "var(--rating-a)" : "var(--rating-e)",
                    color: "#fff",
                    border: "none",
                  }}
                  onClick={() => handleToggleFlag(f)}
                >
                  {f.enabled ? "Ligado" : "Desligado"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Genkit agentic pipeline visibility */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.3rem", margin: "0 0 0.35rem" }}>
          Esteira de Inteligência Agêntica (Genkit)
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          1×/dia: consulta práticas de qualidade/segurança, OWASP e CVEs conhecidos → propõe mutações → o motor
          determinístico (corpus golden + evolve) decide promoção. Plugin, MCP e GitHub Action buscam o resultado no
          máximo 1×/dia via <code>getActiveRules</code>.
        </p>

        {runsError && <div className="hero-error" style={{ marginBottom: "1rem" }}>{runsError}</div>}

        {runsLoading ? (
          <p className="hero-caption">Carregando execuções…</p>
        ) : runs.length === 0 ? (
          <p className="hero-caption">Nenhuma execução registrada ainda — roda automaticamente às 06:05 (America/Sao_Paulo).</p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {runs.map((r) => {
              const isOpen = expandedRun === r.day;
              return (
                <div key={r.day} className="hero-panel-sm" style={{ padding: "0.85rem 1rem" }}>
                  <button
                    type="button"
                    onClick={() => setExpandedRun(isOpen ? null : r.day)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit", padding: 0, gap: "0.75rem", flexWrap: "wrap" }}
                  >
                    <span>
                      {isOpen ? "▾" : "▸"} <strong>{r.day}</strong>
                    </span>
                    <span style={{ display: "flex", gap: "0.4rem" }}>
                      <span className="hero-badge" style={{ background: "var(--rating-a)", color: "#fff" }}>
                        {r.promotedCount} promovida(s)
                      </span>
                      <span className="hero-badge">{r.rejectedCount} rejeitada(s)</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
                      <table className="hero-table">
                        <thead>
                          <tr>
                            <th>Regra</th>
                            <th>Decisão</th>
                            <th>F1 antes → depois</th>
                            <th>Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.rules.map((ro) => (
                            <tr key={ro.ruleId}>
                              <td>
                                <code>{ro.ruleId}</code>
                              </td>
                              <td>
                                <span
                                  className="hero-badge"
                                  style={{ background: ro.decision === "PROMOTED" ? "var(--rating-a)" : "var(--rating-e)", color: "#fff" }}
                                >
                                  {ro.decision}
                                </span>
                              </td>
                              <td>
                                {ro.baselineF1.toFixed(2)} → {ro.bestF1.toFixed(2)}
                              </td>
                              <td className="hero-caption">{ro.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Apontamentos da esteira (GitHub Action + checagem automática), todos os repos */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.3rem", margin: "0 0 0.35rem" }}>
          Apontamentos da Esteira (todos os repositórios)
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          todo achado aberto reportado pela GitHub Action e pela checagem automática, consolidado por severidade e
          origem
        </p>

        {issuesError && <div className="hero-error" style={{ marginBottom: "1rem" }}>{issuesError}</div>}

        {issuesLoading ? (
          <p className="hero-caption">Carregando apontamentos…</p>
        ) : !issues || issues.total === 0 ? (
          <p className="hero-caption">Nenhum apontamento aberto registrado ainda.</p>
        ) : (
          <>
            <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr)", marginBottom: "1.5rem" }}>
              <SeverityBarChart bySeverity={issues.bySeverity} total={issues.total} />
              <SourceBreakdown bySource={issues.bySource} total={issues.total} />
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="hero-table">
                <thead>
                  <tr>
                    <th>Severidade</th>
                    <th>Regra</th>
                    <th>Repositório</th>
                    <th>Projeto</th>
                    <th>Arquivo</th>
                    <th>Origem</th>
                    <th>Visto por último</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.items.slice(0, 30).map((it: AdminIssueRow) => (
                    <tr key={it.issueId}>
                      <td>
                        <span className="hero-badge" style={{ background: severityColor[it.severity] ?? "var(--muted)", color: "#fff" }}>
                          {it.severity}
                        </span>
                      </td>
                      <td>
                        <code style={{ fontSize: "0.8rem" }}>{it.ruleId}</code>
                      </td>
                      <td>{it.repoName}</td>
                      <td className="hero-caption">{it.projectName}</td>
                      <td className="hero-caption" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.file}:{it.line}
                      </td>
                      <td>
                        <span className="hero-badge">{sourceLabel[it.source] ?? it.source}</span>
                      </td>
                      <td className="hero-caption">{it.lastSeen ? new Date(it.lastSeen).toLocaleDateString("pt-BR") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {issues.total > 30 && (
              <p className="hero-caption" style={{ marginTop: "0.75rem" }}>
                mostrando 30 de {issues.total} apontamento(s) abertos
              </p>
            )}
          </>
        )}
      </section>

      <p className="hero-caption" style={{ margin: "0 0 0.75rem" }}>
        qualidade geral por projeto — clique em uma linha para abrir a quebra por repositório
      </p>

      {projects.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Nenhum projeto foi provisionado na plataforma ainda.</p>
      ) : (
        <div className="hero-panel" style={{ overflowX: "auto" }}>
          <table className="hero-table">
            <thead>
              <tr>
                <th></th>
                <th>Projeto</th>
                <th>Organização</th>
                <th>Repos</th>
                <th>Gate</th>
                <th>Segurança</th>
                <th>Manutenib.</th>
                <th>Débito</th>
                <th>Issues</th>
                <th>Última análise</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const key = `${p.orgId}/${p.projectId}`;
                const isOpen = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <tr key={key} style={{ cursor: p.repos.length > 0 ? "pointer" : "default" }} onClick={() => p.repos.length > 0 && toggleExpanded(key)}>
                      <td style={{ width: "1.5rem", textAlign: "center" }}>{p.repos.length > 0 ? (isOpen ? "▾" : "▸") : ""}</td>
                      <td style={{ fontWeight: 700 }}>{p.name}</td>
                      <td>{p.orgName}</td>
                      <td>
                        <span className="hero-badge">{p.repoCount}</span>
                      </td>
                      <td>
                        <span
                          className="hero-badge"
                          style={{ background: p.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)", color: "#fff" }}
                        >
                          {p.qualityGateStatus}
                        </span>
                      </td>
                      <td>
                        <span className="hero-rating" style={{ background: ratingColor[p.securityRating] ?? "var(--muted)" }}>
                          {p.securityRating}
                        </span>
                      </td>
                      <td>
                        <span className="hero-rating" style={{ background: ratingColor[p.maintainabilityRating] ?? "var(--muted)" }}>
                          {p.maintainabilityRating}
                        </span>
                      </td>
                      <td>{Math.round(p.debtMinutes / 60)}h</td>
                      <td>{p.openIssues}</td>
                      <td className="hero-caption">{p.lastAnalyzedAt ? new Date(p.lastAnalyzedAt).toLocaleDateString("pt-BR") : "—"}</td>
                      <td>
                        <Link
                          href={`/projects?org=${encodeURIComponent(p.orgId)}&id=${encodeURIComponent(p.projectId)}`}
                          className="hero-btn hero-btn-outline"
                          style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", textDecoration: "none", display: "inline-block" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Configurar
                        </Link>
                      </td>
                    </tr>
                    {isOpen &&
                      p.repos.map((r: RepoRow) => (
                        <tr key={`${key}/${r.repoId}`} style={{ background: "color-mix(in srgb, var(--line) 4%, transparent)" }}>
                          <td></td>
                          <td colSpan={2} style={{ paddingLeft: "1.75rem" }}>
                            ↳ {r.name}
                            {r.repoUrl ? (
                              <span className="hero-caption" style={{ marginLeft: "0.5rem" }}>
                                {r.repoUrl.replace(/^https?:\/\//, "")}
                              </span>
                            ) : null}
                          </td>
                          <td></td>
                          <td>
                            <span
                              className="hero-badge"
                              style={{ background: r.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)", color: "#fff" }}
                            >
                              {r.qualityGateStatus}
                            </span>
                          </td>
                          <td>
                            <span className="hero-rating" style={{ background: ratingColor[r.securityRating] ?? "var(--muted)" }}>
                              {r.securityRating}
                            </span>
                          </td>
                          <td>
                            <span className="hero-rating" style={{ background: ratingColor[r.maintainabilityRating] ?? "var(--muted)" }}>
                              {r.maintainabilityRating}
                            </span>
                          </td>
                          <td>{Math.round(r.debtMinutes / 60)}h</td>
                          <td>{r.openIssues}</td>
                          <td className="hero-caption">{r.lastAnalyzedAt ? new Date(r.lastAnalyzedAt).toLocaleDateString("pt-BR") : "—"}</td>
                          <td>
                            <Link
                              href={`/projects?org=${encodeURIComponent(p.orgId)}&id=${encodeURIComponent(p.projectId)}&repo=${encodeURIComponent(r.repoId)}`}
                              className="hero-link"
                              style={{ fontSize: "0.78rem" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              abrir
                            </Link>
                          </td>
                        </tr>
                      ))}
                    {isOpen && p.repos.length === 0 && (
                      <tr key={`${key}/empty`}>
                        <td></td>
                        <td colSpan={9} className="hero-caption" style={{ paddingLeft: "1.75rem" }}>
                          Nenhum repositório adicionado a este projeto ainda.
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function SeverityBarChart({ bySeverity, total }: { bySeverity: Record<string, number>; total: number }) {
  const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
  return (
    <div className="hero-panel-sm" style={{ padding: "1.1rem" }}>
      <p className="hero-label" style={{ marginBottom: "0.75rem" }}>
        Por severidade
      </p>
      <div style={{ display: "grid", gap: "0.45rem" }}>
        {order
          .filter((sev) => bySeverity[sev])
          .map((sev) => {
            const count = bySeverity[sev] ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={sev} style={{ display: "grid", gridTemplateColumns: "5.5rem 1fr 2.5rem", alignItems: "center", gap: "0.5rem" }}>
                <span className="hero-caption" style={{ fontSize: "0.75rem" }}>
                  {sev}
                </span>
                <div style={{ background: "color-mix(in srgb, var(--line) 12%, transparent)", borderRadius: 4, overflow: "hidden", height: 10 }}>
                  <div style={{ width: `${pct}%`, background: severityColor[sev] ?? "var(--muted)", height: "100%" }} />
                </div>
                <span className="hero-caption" style={{ fontSize: "0.75rem", textAlign: "right" }}>
                  {count}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function SourceBreakdown({ bySource, total }: { bySource: Record<string, number>; total: number }) {
  return (
    <div className="hero-panel-sm" style={{ padding: "1.1rem" }}>
      <p className="hero-label" style={{ marginBottom: "0.75rem" }}>
        Por origem
      </p>
      <div style={{ display: "grid", gap: "0.45rem" }}>
        {Object.entries(bySource).map(([source, count]) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={source} style={{ display: "grid", gridTemplateColumns: "9rem 1fr 2.5rem", alignItems: "center", gap: "0.5rem" }}>
              <span className="hero-caption" style={{ fontSize: "0.75rem" }}>
                {sourceLabel[source] ?? source}
              </span>
              <div style={{ background: "color-mix(in srgb, var(--line) 12%, transparent)", borderRadius: 4, overflow: "hidden", height: 10 }}>
                <div style={{ width: `${pct}%`, background: "var(--accent)", height: "100%" }} />
              </div>
              <span className="hero-caption" style={{ fontSize: "0.75rem", textAlign: "right" }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  accentColor,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  accentColor?: string;
}) {
  return (
    <div className="hero-panel-sm" style={{ padding: "1.1rem" }}>
      <p className="hero-label" style={{ marginBottom: "0.4rem" }}>
        {label}
      </p>
      <p
        className="hero-display"
        style={{ fontSize: "1.8rem", margin: 0, color: accentColor ?? (accent ? "var(--accent)" : "var(--ink)") }}
      >
        {value}
      </p>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AppShell>
        <AdminHome />
      </AppShell>
    </AuthGate>
  );
}
