"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Callout, PageHeader } from "@/components/AdminUi";
import {
  deleteOverlayRule,
  listMotorRules,
  type MotorRuleGroup,
  type MotorRuleRow,
  type MotorRulesTotals,
} from "@/lib/api";

const severityTone: Record<string, string> = {
  BLOCKER: "var(--rating-e)",
  CRITICAL: "var(--rating-d)",
  MAJOR: "var(--rating-c)",
  MINOR: "var(--rating-b)",
  INFO: "var(--rating-a)",
};

type SourceFilter = "all" | "core" | "custom";

export default function RulesCatalog() {
  const [groups, setGroups] = useState<MotorRuleGroup[]>([]);
  const [totals, setTotals] = useState<MotorRulesTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMotorRules();
      setGroups(res.groups);
      setTotals(res.totals);
      setOpenGroups(new Set(res.groups.map((g) => g.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar regras.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => {
        const rules = g.rules.filter((r) => {
          if (sourceFilter === "core" && r.source !== "core") return false;
          if (sourceFilter === "custom" && r.source === "core") return false;
          if (!q) return true;
          return (
            r.id.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            r.message.toLowerCase().includes(q) ||
            (r.category ?? "").toLowerCase().includes(q) ||
            (r.projectName ?? "").toLowerCase().includes(q)
          );
        });
        return { ...g, rules, count: rules.length };
      })
      .filter((g) => g.count > 0);
  }, [groups, query, sourceFilter]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function handleDelete(rule: MotorRuleRow) {
    if (!rule.canDelete || rule.source === "core") return;
    if (
      !window.confirm(
        `Excluir a regra “${rule.name}” (${rule.id})?\n\nRegras do core não são afetadas — só overlays criadas por dress code.`,
      )
    ) {
      return;
    }
    setBusyId(rule.id);
    setError(null);
    setMsg(null);
    try {
      await deleteOverlayRule({
        ruleId: rule.id,
        source: rule.source === "platform" ? "platform" : "project",
        orgId: rule.orgId ?? undefined,
        projectId: rule.projectId ?? undefined,
      });
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          rules: g.rules.filter((r) => !(r.id === rule.id && r.source === rule.source && r.projectId === rule.projectId)),
          count: g.rules.filter((r) => !(r.id === rule.id && r.source === rule.source && r.projectId === rule.projectId))
            .length,
        })),
      );
      setMsg(`Regra ${rule.id} excluída.`);
      setExpandedId(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Projetos"
        title="Regras do motor"
        description="Catálogo do motor determinístico: core + regras criadas por dress code. Core não pode ser excluído."
      />

      {totals && (
        <p className="hero-caption" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
          {totals.all} regras · {totals.core} core · {totals.platform} plataforma · {totals.project} projeto
        </p>
      )}

      {error && <div className="hero-error">{error}</div>}
      {msg && <Callout tone="ok">{msg}</Callout>}

      <div className="rules-catalog__toolbar">
        <input
          className="hero-input"
          placeholder="Buscar por id, nome, mensagem…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar regras"
        />
        <div className="findings-browser__filters" role="toolbar" aria-label="Origem">
          {(
            [
              ["all", "Todas"],
              ["core", "Só core"],
              ["custom", "Criadas (dress code)"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`findings-chip${sourceFilter === id ? " is-active" : ""}`}
              onClick={() => setSourceFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="hero-caption">Carregando regras…</p>
      ) : filteredGroups.length === 0 ? (
        <p className="hero-caption">Nenhuma regra neste filtro.</p>
      ) : (
        <div className="rules-catalog">
          {filteredGroups.map((g) => {
            const open = openGroups.has(g.id);
            return (
              <section key={g.id} className="rules-group">
                <button type="button" className="rules-group__head" onClick={() => toggleGroup(g.id)} aria-expanded={open}>
                  <span>
                    {open ? "▾" : "▸"} {g.label}
                  </span>
                  <span className="hero-badge">{g.count}</span>
                </button>
                {open && (
                  <ul className="rules-group__list">
                    {g.rules.map((r) => {
                      const detailOpen = expandedId === `${r.source}:${r.id}:${r.projectId ?? ""}`;
                      return (
                        <li key={`${r.source}:${r.id}:${r.projectId ?? "g"}`}>
                          <div
                            className={`rules-row${detailOpen ? " is-open" : ""}`}
                            style={{ ["--sev-tone" as string]: severityTone[r.severity] ?? "var(--muted)" }}
                          >
                            <button
                              type="button"
                              className="rules-row__main"
                              onClick={() =>
                                setExpandedId(detailOpen ? null : `${r.source}:${r.id}:${r.projectId ?? ""}`)
                              }
                            >
                              <span className="findings-row__sev">{r.severity}</span>
                              <span className="rules-row__body">
                                <span className="rules-row__name">{r.name}</span>
                                <span className="rules-row__id">
                                  <code>{r.id}</code>
                                  {r.category ? <span> · {r.category}</span> : null}
                                </span>
                              </span>
                              <span
                                className={`rules-source rules-source--${r.source === "core" ? "core" : "custom"}`}
                              >
                                {r.source === "core" ? "Core" : r.source === "platform" ? "Plataforma" : "Projeto"}
                              </span>
                            </button>
                            {r.canDelete ? (
                              <button
                                type="button"
                                className="rules-row__delete"
                                disabled={busyId === r.id}
                                onClick={() => void handleDelete(r)}
                                title="Excluir regra criada (não afeta o core)"
                              >
                                {busyId === r.id ? "…" : "Excluir"}
                              </button>
                            ) : (
                              <span className="rules-row__locked" title="Regra do motor — não excluível">
                                Protegida
                              </span>
                            )}
                          </div>
                          {detailOpen && (
                            <div className="rules-row__detail">
                              <p>{r.message}</p>
                              <p className="hero-caption">
                                Origem: {r.sourceLabel}
                                {r.orgName ? ` · ${r.orgName}` : ""}
                                {r.remediationEffortMin ? ` · esforço ${r.remediationEffortMin} min` : ""}
                                {r.languages?.length ? ` · ${r.languages.join(", ")}` : ""}
                              </p>
                              {r.patternRegex ? (
                                <pre className="hero-code" style={{ maxHeight: 100, overflow: "auto" }}>
                                  {r.patternRegex}
                                </pre>
                              ) : null}
                              {r.source === "core" ? (
                                <Callout tone="neutral" title="Core">
                                  Criada pelo motor determinístico. Não pode ser excluída por aqui.
                                </Callout>
                              ) : (
                                <Callout tone="warn" title="Dress code">
                                  Regra overlay criada por admin. Excluir remove só este overlay — o core permanece.
                                </Callout>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
