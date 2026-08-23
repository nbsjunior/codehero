"use client";

import type { User } from "firebase/auth";
import { Callout } from "@/components/AdminUi";

export type OnboardingStepId = "verify" | "workspace" | "repo" | "scan" | "channel";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  detail: string;
  done: boolean;
  href?: string;
  cta?: string;
  action?: "create-workspace" | "open-workspace" | "open-workspace-action";
}

export function buildOnboardingSteps(input: {
  user: User | null;
  projectCount: number;
  repoCount: number;
  openIssues: number;
  hasWorkspace: boolean;
}): OnboardingStep[] {
  const verified = !!input.user?.emailVerified;
  const hasProject = input.projectCount > 0;
  const hasRepo = input.repoCount > 0;
  const hasScanSignal = input.openIssues > 0;

  return [
    {
      id: "verify",
      title: "Confirme o email",
      detail: verified
        ? "Conta verificada — você já pode criar workspaces."
        : "Confirme o email para liberar criação de workspace e tokens de CI.",
      done: verified,
    },
    {
      id: "workspace",
      title: "Crie o workspace",
      detail: hasProject
        ? `${input.projectCount} projeto(s) na conta.`
        : "Organização + projeto + repositórios no assistente — um caminho só.",
      done: hasProject,
      cta: hasProject ? undefined : "Novo workspace",
      action: hasProject ? undefined : "create-workspace",
    },
    {
      id: "repo",
      title: "Ligue e configure repositórios",
      detail: hasRepo
        ? `${input.repoCount} repo(s) — cada um com token/Action próprios no workspace.`
        : "No workspace, adicione o repo e copie o token daquele repositório.",
      done: hasRepo,
      cta: hasRepo ? undefined : input.hasWorkspace ? "Abrir workspace" : "Novo workspace",
      action: hasRepo ? undefined : input.hasWorkspace ? "open-workspace" : "create-workspace",
    },
    {
      id: "scan",
      title: "Rode o primeiro scan",
      detail: hasScanSignal
        ? `${input.openIssues} apontamento(s) abertos — o painel já tem sinal.`
        : "No projeto: fluxo Token & CI → rode a Action ou o plugin no repo selecionado.",
      done: hasScanSignal,
      cta: hasScanSignal ? undefined : input.hasWorkspace ? "Token & Action" : undefined,
      action: hasScanSignal || !input.hasWorkspace ? undefined : "open-workspace-action",
      href: hasScanSignal || input.hasWorkspace ? undefined : "/docs/#github-action",
    },
    {
      id: "channel",
      title: "Canal do dia a dia",
      detail: "Action no CI (gate), plugin no editor, ou MCP para o agente aplicar a correção.",
      done: hasScanSignal,
      href: "#mcp-integracao",
      cta: "Integração MCP",
    },
  ];
}

export default function OnboardingChecklist({
  steps,
  onCreateWorkspace,
  onOpenWorkspace,
  onOpenWorkspaceAction,
}: {
  steps: OnboardingStep[];
  onCreateWorkspace?: () => void;
  onOpenWorkspace?: () => void;
  onOpenWorkspaceAction?: () => void;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  if (allDone) return null;

  function runAction(action?: OnboardingStep["action"]) {
    if (action === "create-workspace") onCreateWorkspace?.();
    if (action === "open-workspace") onOpenWorkspace?.();
    if (action === "open-workspace-action") onOpenWorkspaceAction?.();
  }

  return (
    <Callout tone="neutral" title={`Primeiros passos · ${doneCount}/${steps.length}`}>
      <p style={{ margin: "0 0 0.75rem" }}>
        Ordem: workspace → repos (config por repo) → scan. Dress code e prévia na nuvem são
        opcionais.
      </p>
      <ol className="onboarding-checklist">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "is-done" : undefined}>
            <span className="onboarding-checklist__mark" aria-hidden>
              {s.done ? "ok" : "—"}
            </span>
            <div>
              <strong>{s.title}</strong>
              <p className="hero-caption" style={{ margin: "0.15rem 0 0.35rem" }}>
                {s.detail}
              </p>
              {!s.done && s.action ? (
                <button
                  type="button"
                  className="hero-btn hero-btn-outline"
                  onClick={() => runAction(s.action)}
                >
                  {s.cta ?? "Continuar"}
                </button>
              ) : null}
              {!s.done && !s.action && s.href ? (
                <a className="hero-link" href={s.href}>
                  {s.cta ?? "Abrir"}
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Callout>
  );
}
