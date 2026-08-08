"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { buildFindingFicha } from "@codehero/contracts";
import FindingFichaCard from "@/components/FindingFichaCard";
import type { IssueFeedbackVerdict } from "@/lib/api";

const SEVERITY_ORDER = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;

const severityTone: Record<string, string> = {
  BLOCKER: "var(--rating-e)",
  CRITICAL: "var(--rating-d)",
  MAJOR: "var(--rating-c)",
  MINOR: "var(--rating-b)",
  INFO: "var(--rating-a)",
};

export type FindingsBrowserItem = {
  id: string;
  ruleId: string;
  ruleName?: string;
  severity: string;
  issueType?: string;
  message?: string;
  file: string;
  line?: number;
  snippet?: string;
  sddTemplateId?: string | null;
  remediationEffortMin?: number;
  risk?: string | null;
  reason?: string | null;
  howToFix?: string | null;
  strategy?: string | null;
  constraints?: string[];
  referenceExample?: { before: string; after: string } | null;
  cwe?: string[];
  /** Extra meta shown in the list (repo, origem, …) */
  meta?: string;
  feedbackVerdict?: IssueFeedbackVerdict | null;
  /** native CodeHero vs imported third-party analyzer */
  findingSource?: "native" | "imported" | null;
  tool?: string | null;
  originalRuleId?: string | null;
  engine?: string | null;
  isDependency?: boolean;
  /** Eco: outras regras/ferramentas que apontaram a mesma linha. */
  alsoRuleIds?: string[];
  isNewCode?: boolean;
  assertiveness?: number | null;
  fpLikelihood?: number | null;
  /** Offline batch triage / heuristic (Fase 4) — never the sole gate. */
  triageScore?: number | null;
  likelyTruePositive?: boolean | null;
  triageMode?: string | null;
  /** Regra com FP local alto — visível, mas fora do Quality Gate. */
  gateSuppressed?: boolean | null;
  clusterId?: string | null;
  familySize?: number | null;
  outlierScore?: number | null;
};

function verdictLabel(v: IssueFeedbackVerdict | null | undefined): string | null {
  if (!v) return null;
  if (v === "false_positive") return "Falso positivo";
  if (v === "confirmed") return "Confirmado";
  if (v === "fix_accepted") return "Fix aceito";
  if (v === "fix_rejected") return "Fix rejeitado";
  return v;
}

function fileBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/** Procedência legível: CodeHero engine vs analyzer importado. */
export function provenanceLabel(item: FindingsBrowserItem): string | null {
  if (item.meta) return item.meta;
  const bits: string[] = [];
  if (item.findingSource === "imported") {
    bits.push(item.tool ? `via ${item.tool}` : "importado");
    if (item.originalRuleId) bits.push(item.originalRuleId);
    if (item.isDependency) bits.push("dependência");
  } else if (item.ruleId?.startsWith("EXT:")) {
    const tool = item.tool || item.ruleId.split(":")[1];
    bits.push(tool ? `via ${tool}` : "importado");
    if (item.isDependency) bits.push("dependência");
  } else if (item.engine) {
    bits.push(item.engine);
  } else if (item.tool) {
    bits.push(item.tool);
  }
  if (item.alsoRuleIds?.length) {
    const also = item.alsoRuleIds.slice(0, 3).join(", ");
    bits.push(
      item.alsoRuleIds.length > 3
        ? `também ${also} (+${item.alsoRuleIds.length - 3})`
        : `também ${also}`,
    );
  }
  if (item.isNewCode) bits.push("código novo");
  if (item.gateSuppressed) bits.push("fora do gate (FP local)");
  if (item.clusterId) {
    bits.push(
      item.outlierScore != null && item.outlierScore >= 0.6
        ? `família ${item.clusterId} (outlier)`
        : `família ${item.clusterId}${item.familySize ? ` · ${item.familySize}` : ""}`,
    );
  }
  if (typeof item.triageScore === "number") {
    const pct = Math.round(item.triageScore * 100);
    bits.push(
      item.likelyTruePositive === false
        ? `triagem ${pct}% (suspeito FP)`
        : `triagem ${pct}% TP`,
    );
  }
  if (typeof item.fpLikelihood === "number" && item.fpLikelihood >= 0.55) {
    bits.push(`possível FP ${Math.round(item.fpLikelihood * 100)}%`);
  } else if (typeof item.assertiveness === "number" && item.assertiveness >= 0.7) {
    bits.push(`assertivo ${Math.round(item.assertiveness * 100)}%`);
  }
  return bits.length ? bits.join(" · ") : null;
}

function resolveFicha(item: FindingsBrowserItem) {
  const computed = buildFindingFicha({
    ruleId: item.ruleId,
    ruleName: item.ruleName,
    message: item.message,
    severity: item.severity,
    issueType: item.issueType,
    sddTemplateId: item.sddTemplateId,
    remediationEffortMin: item.remediationEffortMin,
    file: item.file,
    line: item.line,
    snippet: item.snippet,
  });
  return {
    ...computed,
    risk: item.risk ?? computed.risk,
    reason: item.reason ?? computed.reason,
    howToFix: item.howToFix ?? computed.howToFix,
    strategy: item.strategy ?? computed.strategy,
    constraints: item.constraints?.length ? item.constraints : computed.constraints,
    referenceExample: item.referenceExample ?? computed.referenceExample,
    cwe: item.cwe?.length ? item.cwe : computed.cwe,
    file: item.file,
    line: item.line,
    snippet: item.snippet,
    severity: item.severity,
    ruleId: item.ruleId,
    ruleName: item.ruleName ?? computed.ruleName ?? item.ruleId,
  };
}

/**
 * Lista simples de apontamentos + ficha em modal com navegação.
 * Feedback (confirmado / falso positivo) só no rodapé do modal.
 */
export default function FindingsBrowser({
  findings,
  loading = false,
  emptyMessage = "Nenhum apontamento aberto.",
  externalFilter = null,
  onClearExternalFilter,
  enableFeedback = false,
  onFeedback,
  feedbackBusyId = null,
  feedbackError = null,
  title = "Apontamentos",
  subtitle,
}: {
  findings: FindingsBrowserItem[];
  loading?: boolean;
  emptyMessage?: string;
  externalFilter?: { label: string; severity?: string; issueType?: string } | null;
  onClearExternalFilter?: () => void;
  enableFeedback?: boolean;
  onFeedback?: (item: FindingsBrowserItem, verdict: "confirmed" | "false_positive") => void | Promise<void>;
  feedbackBusyId?: string | null;
  feedbackError?: string | null;
  title?: string;
  subtitle?: ReactNode;
}) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [sevFilter, setSevFilter] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (externalFilter?.severity && f.severity !== externalFilter.severity) return false;
      if (externalFilter?.issueType && (f.issueType ?? "CODE_SMELL") !== externalFilter.issueType) return false;
      if (sevFilter && f.severity !== sevFilter) return false;
      return true;
    });
  }, [findings, externalFilter, sevFilter]);

  const severityCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) {
      if (externalFilter?.severity && f.severity !== externalFilter.severity) continue;
      if (externalFilter?.issueType && (f.issueType ?? "CODE_SMELL") !== externalFilter.issueType) continue;
      map.set(f.severity, (map.get(f.severity) ?? 0) + 1);
    }
    return SEVERITY_ORDER.filter((s) => map.has(s)).map((s) => ({ sev: s, n: map.get(s)! }));
  }, [findings, externalFilter]);

  const activeIndex = activeId == null ? -1 : filtered.findIndex((f) => f.id === activeId);
  const active = activeIndex >= 0 ? filtered[activeIndex] : null;

  const openAt = useCallback(
    (id: string) => {
      setActiveId(id);
    },
    [],
  );

  const close = useCallback(() => setActiveId(null), []);

  const go = useCallback(
    (delta: number) => {
      if (filtered.length === 0) return;
      setActiveId((prev) => {
        const i = prev == null ? 0 : filtered.findIndex((f) => f.id === prev);
        const next = i < 0 ? 0 : (i + delta + filtered.length) % filtered.length;
        return filtered[next]!.id;
      });
    },
    [filtered],
  );

  useEffect(() => {
    if (!activeId) return;
    if (!filtered.some((f) => f.id === activeId)) {
      setActiveId(filtered[0]?.id ?? null);
    }
  }, [filtered, activeId]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active, close, go]);

  return (
    <section className="findings-browser" aria-labelledby={titleId}>
      <div className="findings-browser__head">
        <div>
          <h3 id={titleId} className="findings-browser__title">
            {title}
          </h3>
          {subtitle ? <div className="findings-browser__sub">{subtitle}</div> : null}
        </div>
        <p className="findings-browser__count" aria-live="polite">
          {loading ? "…" : `${filtered.length} de ${findings.length}`}
        </p>
      </div>

      {(externalFilter || severityCounts.length > 1) && (
        <div className="findings-browser__filters" role="toolbar" aria-label="Filtros de severidade">
          {externalFilter ? (
            <button type="button" className="findings-chip is-active" onClick={onClearExternalFilter}>
              {externalFilter.label} ✕
            </button>
          ) : null}
          <button
            type="button"
            className={`findings-chip${!sevFilter ? " is-active" : ""}`}
            onClick={() => setSevFilter(null)}
          >
            Todos
          </button>
          {severityCounts.map(({ sev, n }) => (
            <button
              key={sev}
              type="button"
              className={`findings-chip${sevFilter === sev ? " is-active" : ""}`}
              style={{ ["--chip-tone" as string]: severityTone[sev] ?? "var(--muted)" }}
              onClick={() => setSevFilter((cur) => (cur === sev ? null : sev))}
            >
              <span className="findings-chip__dot" aria-hidden />
              {sev} · {n}
            </button>
          ))}
        </div>
      )}

      {feedbackError ? <div className="hero-error">{feedbackError}</div> : null}

      {loading ? (
        <p className="hero-caption">Carregando apontamentos…</p>
      ) : filtered.length === 0 && findings.length > 0 ? (
        // "Não há apontamento" e "o filtro escondeu todos" são situações
        // diferentes, e a mesma frase para as duas faz o usuário achar que a
        // ferramenta quebrou. Aqui existem apontamentos — só nenhum passa no
        // filtro —, então a saída é desfazer o filtro, não rodar outro scan.
        <p className="hero-caption">
          Nenhum apontamento neste filtro.{" "}
          <button
            type="button"
            className="hero-link-btn"
            onClick={() => {
              setSevFilter(null);
              onClearExternalFilter?.();
            }}
          >
            Limpar filtros
          </button>{" "}
          para ver os {findings.length}.
        </p>
      ) : filtered.length === 0 ? (
        <p className="hero-caption">{emptyMessage}</p>
      ) : (
        <ul className="findings-list" role="list">
          {filtered.map((item, idx) => {
            const verdict = verdictLabel(item.feedbackVerdict);
            const provenance = provenanceLabel(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`findings-row${activeId === item.id ? " is-active" : ""}`}
                  style={{ ["--sev-tone" as string]: severityTone[item.severity] ?? "var(--muted)" }}
                  onClick={() => openAt(item.id)}
                  aria-label={`Abrir apontamento ${idx + 1}: ${item.ruleId} em ${item.file}`}
                >
                  <span className="findings-row__sev">{item.severity}</span>
                  <span className="findings-row__body">
                    <span className="findings-row__rule">{item.ruleName ?? item.ruleId}</span>
                    <span className="findings-row__loc">
                      <span title={item.file}>
                        {fileBasename(item.file)}
                        {item.line != null ? `:${item.line}` : ""}
                      </span>
                      {provenance ? <span className="findings-row__meta">{provenance}</span> : null}
                    </span>
                  </span>
                  {verdict ? (
                    <span
                      className={`findings-verdict findings-verdict--${item.feedbackVerdict === "false_positive" ? "fp" : "ok"}`}
                    >
                      {verdict}
                    </span>
                  ) : (
                    <span className="findings-row__hint">Abrir</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {active && activeIndex >= 0 ? (
        <div
          className="findings-modal-root"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="findings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${titleId}-modal`}
          >
            <header className="findings-modal__top">
              <div className="findings-modal__nav">
                <button
                  type="button"
                  className="findings-nav-btn"
                  onClick={() => go(-1)}
                  disabled={filtered.length < 2}
                  aria-label="Apontamento anterior"
                >
                  ←
                </button>
                <span className="findings-modal__pos">
                  {activeIndex + 1} / {filtered.length}
                </span>
                <button
                  type="button"
                  className="findings-nav-btn"
                  onClick={() => go(1)}
                  disabled={filtered.length < 2}
                  aria-label="Próximo apontamento"
                >
                  →
                </button>
              </div>
              <button ref={closeBtnRef} type="button" className="findings-modal__close" onClick={close} aria-label="Fechar">
                ✕
              </button>
            </header>

            <div className="findings-modal__identity">
              <span
                className="findings-row__sev findings-row__sev--lg"
                style={{ ["--sev-tone" as string]: severityTone[active.severity] ?? "var(--muted)" }}
              >
                {active.severity}
              </span>
              <div>
                <h2 id={`${titleId}-modal`} className="findings-modal__title">
                  {active.ruleName ?? active.ruleId}
                </h2>
                <p className="findings-modal__path">
                  <code>
                    {active.file}
                    {active.line != null ? `:${active.line}` : ""}
                  </code>
                  {active.meta ? <span> · {active.meta}</span> : null}
                </p>
              </div>
            </div>

            {active.message ? <p className="findings-modal__message">{active.message}</p> : null}

            <div className="findings-modal__body">
              <FindingFichaCard ficha={resolveFicha(active)} hideHeader />
            </div>

            {enableFeedback && onFeedback ? (
              <footer className="findings-modal__footer">
                <div className="findings-modal__feedback-label">
                  <span>Este apontamento é</span>
                  {active.feedbackVerdict ? (
                    <span
                      className={`findings-verdict findings-verdict--${active.feedbackVerdict === "false_positive" ? "fp" : "ok"}`}
                    >
                      {verdictLabel(active.feedbackVerdict)}
                    </span>
                  ) : (
                    <span className="hero-caption">sem feedback ainda</span>
                  )}
                </div>
                <div className="findings-modal__actions">
                  <button
                    type="button"
                    className={`findings-action findings-action--confirm${active.feedbackVerdict === "confirmed" ? " is-selected" : ""}`}
                    disabled={feedbackBusyId === active.id}
                    onClick={() => void onFeedback(active, "confirmed")}
                  >
                    {feedbackBusyId === active.id ? "Salvando…" : "Confirmado"}
                  </button>
                  <button
                    type="button"
                    className={`findings-action findings-action--fp${active.feedbackVerdict === "false_positive" ? " is-selected" : ""}`}
                    disabled={feedbackBusyId === active.id}
                    onClick={() => void onFeedback(active, "false_positive")}
                  >
                    Falso positivo
                  </button>
                </div>
                <p className="findings-modal__hint">← → navegar · Esc fechar · feedback treina as regras</p>
              </footer>
            ) : (
              <footer className="findings-modal__footer findings-modal__footer--simple">
                <p className="findings-modal__hint">← → navegar · Esc fechar</p>
              </footer>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
