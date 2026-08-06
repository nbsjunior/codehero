"use client";

import { useCallback, useEffect, useState } from "react";
import { Callout, PageHeader } from "@/components/AdminUi";
import {
  listCveWatchlist,
  listRuleforgeRuns,
  listRuleProposals,
  reviewRuleProposal,
  runCveWatchlistSyncNow,
  runRuleforgeDailyNow,
  type CveWatchlistEntryRow,
  type RuleforgeRun,
  type RuleProposalRow,
} from "@/lib/api";

const severityColor: Record<string, string> = {
  CRITICAL: "var(--rating-e)",
  HIGH: "var(--rating-d)",
  MODERATE: "var(--rating-c)",
  LOW: "var(--rating-b)",
  UNKNOWN: "var(--muted)",
};

const familyLabel: Record<string, string> = {
  security: "Segurança",
  dress: "Dress code",
  smell: "Code smell",
};

const kindLabel: Record<string, string> = {
  evolve: "Evolução (corpus)",
  new_rule: "Nova regra",
};

export default function EsteiraPanel() {
  const [runs, setRuns] = useState<RuleforgeRun[]>([]);
  const [proposals, setProposals] = useState<RuleProposalRow[]>([]);
  const [cves, setCves] = useState<CveWatchlistEntryRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [propLoading, setPropLoading] = useState(true);
  const [cvesLoading, setCvesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [cveSyncBusy, setCveSyncBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedProp, setExpandedProp] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const load = useCallback(async () => {
    setError(null);
    setRunsLoading(true);
    setPropLoading(true);
    setCvesLoading(true);
    try {
      const [runsRes, propRes, cveRes] = await Promise.all([
        listRuleforgeRuns(14),
        listRuleProposals({ status: filter, limit: 50 }),
        listCveWatchlist(100).catch(() => ({ entries: [] })),
      ]);
      setRuns(runsRes.runs);
      setProposals(propRes.items as RuleProposalRow[]);
      setCves(cveRes.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a esteira.");
    } finally {
      setRunsLoading(false);
      setPropLoading(false);
      setCvesLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(p: RuleProposalRow, decision: "approved" | "rejected") {
    const verb = decision === "approved" ? "Aprovar" : "Rejeitar";
    if (!window.confirm(`${verb} “${p.title}”?\n\nAprovação ativa a regra em todos os canais (Action, IDE, prévia, MCP) e grava casos no corpus.`)) {
      return;
    }
    setBusyId(p.id);
    setError(null);
    setMsg(null);
    try {
      await reviewRuleProposal({ proposalId: p.id, decision });
      setMsg(decision === "approved" ? `Aprovada: ${p.ruleId}` : `Rejeitada: ${p.ruleId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na revisão.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Plataforma"
        title="Esteira de regras"
        description="Orquestração de agentes propõe · motor valida no corpus · humano aprova · regra entra em todos os canais"
        actions={
          <button
            type="button"
            className="hero-btn hero-btn-accent"
            disabled={runBusy}
            onClick={async () => {
              setRunBusy(true);
              setError(null);
              setMsg(null);
              try {
                const res = await runRuleforgeDailyNow();
                setMsg(
                  `Batch ok · propostas evolução: ${res.proposalsEnqueued ?? 0} · novas: ${res.newRuleProposals ?? 0}`,
                );
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Falha ao rodar.");
              } finally {
                setRunBusy(false);
              }
            }}
          >
            {runBusy ? "Rodando…" : "Rodar esteira agora"}
          </button>
        }
      />

      {error && <div className="hero-error">{error}</div>}
      {msg && <Callout tone="ok">{msg}</Callout>}

      <Callout tone="neutral" title="Fluxo">
        1) Esteira diária propõe evolução de regras existentes e novas regras (security / dress). 2) Você revisa
        abaixo. 3) Ao aprovar, a regra vai para o overlay ativo (IDE, Action, MCP, prévia) e os exemplos entram no
        corpus na nuvem para as próximas avaliações. Orquestração de agentes / CVE só promovem se o motor decidir{" "}
        <code>PROMOTED</code> (ΔF1&gt;0 e P≥0.85) — ver{" "}
        <a href="/docs/#modelos">docs · modelos offline</a>.
      </Callout>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", margin: "1.25rem 0 0.75rem" }}>
        <h3 className="findings-browser__title" style={{ margin: 0 }}>
          CVEs monitorados (grounding do prompt)
        </h3>
        <button
          type="button"
          className="hero-btn hero-btn-outline"
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.78rem" }}
          disabled={cveSyncBusy}
          onClick={async () => {
            setCveSyncBusy(true);
            setError(null);
            setMsg(null);
            try {
              const res = await runCveWatchlistSyncNow();
              setMsg(`CVEs sincronizados: ${res.fetched} (${res.ecosystems.join(", ")})`);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Falha ao sincronizar CVEs.");
            } finally {
              setCveSyncBusy(false);
            }
          }}
        >
          {cveSyncBusy ? "Sincronizando…" : "Sincronizar agora"}
        </button>
      </div>
      <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
        GitHub Security Advisories, últimos 90 dias — npm/pip/maven/nuget/go. É o que aterra o prompt de "nova regra"
        em dado real, em vez da memória de treino do modelo.
      </p>
      {cvesLoading ? (
        <p className="hero-caption">Carregando…</p>
      ) : cves.length === 0 ? (
        <p className="hero-caption">Nenhum CVE monitorado ainda — clique em "Sincronizar agora".</p>
      ) : (
        <div style={{ display: "grid", gap: "0.4rem", marginBottom: "1.5rem", maxHeight: 280, overflowY: "auto" }}>
          {cves.slice(0, 30).map((c) => (
            <div
              key={c.ghsaId}
              className="hero-panel-sm"
              style={{ padding: "0.55rem 0.8rem", display: "flex", gap: "0.6rem", alignItems: "flex-start" }}
            >
              <span
                className="hero-badge"
                style={{ background: severityColor[c.severity] ?? "var(--muted)", color: "#fff", flexShrink: 0 }}
              >
                {c.severity}
              </span>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: "0.85rem" }}>{c.cveId ?? c.ghsaId}</strong>
                <span className="hero-caption" style={{ marginLeft: "0.4rem" }}>
                  {c.language} · CWE {c.cweIds.join(", ") || "?"}
                </span>
                <p className="hero-caption" style={{ margin: "0.2rem 0 0" }}>
                  {c.summary}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="findings-browser__filters" style={{ margin: "1rem 0" }} role="toolbar">
        <button
          type="button"
          className={`findings-chip${filter === "pending" ? " is-active" : ""}`}
          onClick={() => setFilter("pending")}
        >
          Pendentes
        </button>
        <button
          type="button"
          className={`findings-chip${filter === "all" ? " is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          Todas
        </button>
      </div>

      <h3 className="findings-browser__title" style={{ marginBottom: "0.75rem" }}>
        Fila de aprovação
      </h3>
      {propLoading ? (
        <p className="hero-caption">Carregando propostas…</p>
      ) : proposals.length === 0 ? (
        <p className="hero-caption">Nenhuma proposta {filter === "pending" ? "pendente" : ""}.</p>
      ) : (
        <div className="rules-catalog" style={{ marginBottom: "2rem" }}>
          {proposals.map((p) => {
            const open = expandedProp === p.id;
            return (
              <section key={p.id} className="rules-group">
                <div className="rules-row" style={{ borderLeftColor: p.kind === "evolve" ? "var(--rating-b)" : "var(--accent)" }}>
                  <button
                    type="button"
                    className="rules-row__main"
                    onClick={() => setExpandedProp(open ? null : p.id)}
                    style={{ gridTemplateColumns: "1fr auto" }}
                  >
                    <span className="rules-row__body">
                      <span className="rules-row__name">
                        {open ? "▾" : "▸"} {p.title}
                      </span>
                      <span className="rules-row__id">
                        <code>{p.ruleId}</code> · {kindLabel[p.kind] ?? p.kind} · {familyLabel[p.family] ?? p.family}
                        {p.scope === "project" ? " · projeto" : " · global"} · {p.status}
                      </span>
                    </span>
                    <span className={`rules-source rules-source--${p.status === "pending" ? "custom" : "core"}`}>
                      {p.status}
                    </span>
                  </button>
                  {p.status === "pending" && (
                    <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", paddingRight: "0.65rem" }}>
                      <button
                        type="button"
                        className="findings-action findings-action--confirm"
                        style={{ padding: "0.4rem 0.7rem", fontSize: "0.75rem" }}
                        disabled={busyId === p.id}
                        onClick={() => void review(p, "approved")}
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        className="findings-action findings-action--fp"
                        style={{ padding: "0.4rem 0.7rem", fontSize: "0.75rem" }}
                        disabled={busyId === p.id}
                        onClick={() => void review(p, "rejected")}
                      >
                        Rejeitar
                      </button>
                    </div>
                  )}
                </div>
                {open && (
                  <div className="rules-row__detail">
                    <p>{p.rationale}</p>
                    {p.metrics?.bestF1 != null && (
                      <p className="hero-caption">
                        F1 {p.metrics.baselineF1?.toFixed(2) ?? "—"} → {p.metrics.bestF1.toFixed(2)}
                        {p.metrics.mutationIds?.length ? ` · mutações: ${p.metrics.mutationIds.join(", ")}` : ""}
                      </p>
                    )}
                    {p.kind === "new_rule" && p.metrics && (
                      <p className="hero-caption">
                        F1 (exemplos próprios, n={p.metrics.ownCases ?? 0}):{" "}
                        {p.metrics.ownF1 != null ? p.metrics.ownF1.toFixed(2) : "—"}
                        {" · "}
                        checagem cruzada: {p.metrics.crossCorpusMatches ?? 0} de {p.metrics.crossCorpusSampleSize ?? 0}{" "}
                        casos de OUTRAS regras também disparam
                        {(p.metrics.crossCorpusMatches ?? 0) > 0 && (
                          <strong style={{ color: "var(--rating-e)" }}> — possível regex amplo demais, revise</strong>
                        )}
                      </p>
                    )}
                    {p.kind === "evolve" && p.baselinePattern && p.proposedPattern && (
                      <div className="hero-ficha-example">
                        <div>
                          <span className="hero-caption">Antes</span>
                          <pre className="hero-code">{p.baselinePattern.regex}</pre>
                        </div>
                        <div>
                          <span className="hero-caption">Depois</span>
                          <pre className="hero-code">{p.proposedPattern.regex}</pre>
                        </div>
                      </div>
                    )}
                    {p.kind === "new_rule" && p.proposedRule && (
                      <>
                        <p>
                          <strong>{p.proposedRule.name}</strong> — {p.proposedRule.message}
                        </p>
                        <pre className="hero-code">{p.proposedPattern?.regex ?? p.proposedRule.pattern?.regex}</pre>
                      </>
                    )}
                    {p.corpusCases && p.corpusCases.length > 0 && (
                      <ul className="hero-caption">
                        {p.corpusCases.map((c) => (
                          <li key={c.id}>
                            {c.expected}: <code>{c.code.slice(0, 80)}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <h3 className="findings-browser__title" style={{ marginBottom: "0.75rem" }}>
        Execuções recentes
      </h3>
      {runsLoading ? (
        <p className="hero-caption">Carregando…</p>
      ) : runs.length === 0 ? (
        <p className="hero-caption">Nenhuma execução ainda.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {runs.map((r) => (
            <div key={r.day} className="hero-panel-sm" style={{ padding: "0.85rem 1rem" }}>
              <button
                type="button"
                onClick={() => setExpandedRun(expandedRun === r.day ? null : r.day)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  background: "none",
                  border: 0,
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  padding: 0,
                }}
              >
                <span>
                  {expandedRun === r.day ? "▾" : "▸"} <strong>{r.day}</strong>
                </span>
                <span>
                  <span className="hero-badge" style={{ background: "var(--rating-a)", color: "#fff", marginRight: 6 }}>
                    {r.promotedCount} corpus-ok
                  </span>
                  <span className="hero-badge">{r.rejectedCount} rejeitadas</span>
                </span>
              </button>
              {expandedRun === r.day && (
                <ul className="hero-caption" style={{ marginTop: "0.75rem" }}>
                  {r.rules.map((ro) => (
                    <li key={ro.ruleId}>
                      <code>{ro.ruleId}</code> — {ro.decision} ({ro.baselineF1.toFixed(2)} → {ro.bestF1.toFixed(2)})
                      {ro.decision === "PROMOTED" ? " → fila de aprovação" : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
