"use client";

import { useCallback, useEffect, useState } from "react";
import { Callout, PageHeader } from "@/components/AdminUi";
import {
  listRuleforgeRuns,
  listRuleProposals,
  reviewRuleProposal,
  runRuleforgeDailyNow,
  type RuleforgeRun,
  type RuleProposalRow,
} from "@/lib/api";

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
  const [runsLoading, setRunsLoading] = useState(true);
  const [propLoading, setPropLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedProp, setExpandedProp] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const load = useCallback(async () => {
    setError(null);
    setRunsLoading(true);
    setPropLoading(true);
    try {
      const [runsRes, propRes] = await Promise.all([
        listRuleforgeRuns(14),
        listRuleProposals({ status: filter, limit: 50 }),
      ]);
      setRuns(runsRes.runs);
      setProposals(propRes.items as RuleProposalRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a esteira.");
    } finally {
      setRunsLoading(false);
      setPropLoading(false);
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
        description="Genkit propõe · motor valida no corpus · humano aprova · regra entra em todos os canais"
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
        corpus Firestore para as próximas avaliações.
      </Callout>

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
                        <code>{p.ruleId}</code> · {kindLabel[p.kind] ?? p.kind} · {familyLabel[p.family] ?? p.family} ·{" "}
                        {p.status}
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
