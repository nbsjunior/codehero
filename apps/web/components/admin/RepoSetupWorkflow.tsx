"use client";

export type SetupStepId = "action" | "vscode" | "mcp" | "overview";

export const SETUP_STEPS: {
  id: SetupStepId;
  label: string;
  detail: string;
}[] = [
  { id: "action", label: "Token & CI", detail: "HERO_TOKEN e GitHub Action" },
  { id: "vscode", label: "Plugin", detail: "VS Code / Cursor" },
  { id: "mcp", label: "Agentes", detail: "MCP para IA" },
  { id: "overview", label: "Monitorar", detail: "Saúde e achados" },
];

export function setupProgress(input: {
  hasRepo: boolean;
  hasToken: boolean;
  actionInstalled: boolean;
  hasScan: boolean;
}): Record<SetupStepId | "repo", "done" | "current" | "pending"> {
  const repo: "done" | "pending" = input.hasRepo ? "done" : "pending";
  const action: "done" | "pending" =
    input.hasToken && input.actionInstalled ? "done" : input.hasRepo ? "pending" : "pending";
  const vscode: "done" | "pending" = input.actionInstalled ? "done" : "pending";
  const mcp: "done" | "pending" = input.actionInstalled ? "done" : "pending";
  const overview: "done" | "pending" = input.hasScan ? "done" : "pending";
  return { repo, action, vscode, mcp, overview };
}

export default function RepoSetupWorkflow({
  activeStep,
  hasRepo,
  hasToken,
  actionInstalled,
  hasScan,
  repoName,
  onSelectStep,
}: {
  activeStep: SetupStepId;
  hasRepo: boolean;
  hasToken: boolean;
  actionInstalled: boolean;
  hasScan: boolean;
  repoName?: string;
  onSelectStep: (step: SetupStepId) => void;
}) {
  const status = setupProgress({ hasRepo, hasToken, actionInstalled, hasScan });
  const doneCount =
    Number(status.repo === "done") +
    SETUP_STEPS.filter((s) => status[s.id] === "done").length;

  return (
    <nav className="ex-workflow" aria-label="Fluxo de configuração do repositório">
      <div className="ex-workflow__head">
        <div>
          <p className="ex-workflow__eyebrow">Configuração</p>
          <p className="ex-workflow__title">
            {hasRepo && repoName ? (
              <>
                Repo <strong>{repoName}</strong>
              </>
            ) : (
              "Selecione um repositório abaixo"
            )}
          </p>
        </div>
        <span className="ex-workflow__progress" aria-live="polite">
          {hasRepo ? `${doneCount}/${SETUP_STEPS.length + 1} etapas` : "0/5"}
        </span>
      </div>

      <ol className="ex-workflow__steps">
        <li className={`ex-workflow__step${status.repo === "done" ? " is-done" : " is-blocked"}`}>
          <span className="ex-workflow__num" aria-hidden>
            {status.repo === "done" ? "✓" : "0"}
          </span>
          <span className="ex-workflow__label">Repositório</span>
          <span className="ex-workflow__detail">Escolha o repo alvo</span>
        </li>

        {SETUP_STEPS.map((step, i) => {
          const st = status[step.id];
          const isActive = activeStep === step.id;
          const blocked = !hasRepo;
          return (
            <li
              key={step.id}
              className={`ex-workflow__step${st === "done" ? " is-done" : ""}${isActive ? " is-active" : ""}${blocked ? " is-blocked" : ""}`}
            >
              <button
                type="button"
                className="ex-workflow__btn"
                disabled={blocked}
                aria-current={isActive ? "step" : undefined}
                onClick={() => onSelectStep(step.id)}
              >
                <span className="ex-workflow__num" aria-hidden>
                  {st === "done" ? "✓" : i + 1}
                </span>
                <span className="ex-workflow__label">{step.label}</span>
                <span className="ex-workflow__detail">{step.detail}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SetupStepNav({
  activeStep,
  hasRepo,
  onPrev,
  onNext,
}: {
  activeStep: SetupStepId;
  hasRepo: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const idx = SETUP_STEPS.findIndex((s) => s.id === activeStep);
  const isFirst = idx <= 0;
  const isLast = idx >= SETUP_STEPS.length - 1;

  if (!hasRepo) return null;

  return (
    <footer className="ex-setup-nav">
      <button type="button" className="hero-btn hero-btn-outline" disabled={isFirst} onClick={onPrev}>
        ← Etapa anterior
      </button>
      <span className="ex-setup-nav__hint">
        {idx + 1} de {SETUP_STEPS.length} · {SETUP_STEPS[idx]?.label}
      </span>
      <button type="button" className="hero-btn hero-btn-accent" disabled={isLast} onClick={onNext}>
        Próxima etapa →
      </button>
    </footer>
  );
}
