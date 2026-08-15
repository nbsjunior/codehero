"use client";

import type { User } from "firebase/auth";
import { Callout } from "@/components/AdminUi";

export type OnboardingStepId =
  | "verify"
  | "project"
  | "repo"
  | "scan"
  | "channel";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  detail: string;
  done: boolean;
  href?: string;
  cta?: string;
}

export function buildOnboardingSteps(input: {
  user: User | null;
  projectCount: number;
  repoCount: number;
  openIssues: number;
  hasIngestTokenFlash: boolean;
}): OnboardingStep[] {
  const verified = !!input.user?.emailVerified;
  const hasProject = input.projectCount > 0;
  const hasRepo = input.repoCount > 0;
  const hasScanSignal = input.openIssues > 0 || input.hasIngestTokenFlash;

  return [
    {
      id: "verify",
      title: "Confirme o email",
      detail: verified
        ? "Conta verificada — você já pode criar projetos."
        : "Confirme o email para liberar criação de projeto e tokens de CI.",
      done: verified,
    },
    {
      id: "project",
      title: "Crie o primeiro projeto",
      detail: hasProject
        ? `${input.projectCount} projeto(s) na conta.`
        : "Organize org + projeto (e, se quiser, um repo GitHub) em Novo projeto.",
      done: hasProject,
      cta: hasProject ? undefined : "Novo projeto",
    },
    {
      id: "repo",
      title: "Ligue um repositório",
      detail: hasRepo
        ? `${input.repoCount} repo(s) sob gestão.`
        : "Cada repo recebe um token para a Action, o scanner ou o MCP.",
      done: hasRepo,
      href: hasRepo ? undefined : "#workspace",
      cta: hasRepo ? undefined : "Abrir workspace",
    },
    {
      id: "scan",
      title: "Rode o primeiro scan",
      detail: hasScanSignal
        ? input.openIssues > 0
          ? `${input.openIssues} apontamento(s) abertos — o painel já tem sinal.`
          : "Token pronto — configure a Action ou o plugin e rode o scan."
        : "GitHub Action, plugin VS Code ou prévia na nuvem. Sem scan, o painel fica vazio.",
      done: hasScanSignal,
      href: "/docs/#github-action",
      cta: "Ver Action nas docs",
    },
    {
      id: "channel",
      title: "Escolha o canal do dia a dia",
      detail: "Action no CI (gate de merge), plugin no editor, ou MCP para o agente aplicar a correção.",
      done: hasScanSignal,
      href: "#mcp",
      cta: "MCP / integração",
    },
  ];
}

export default function OnboardingChecklist({
  steps,
  onCreateProject,
}: {
  steps: OnboardingStep[];
  onCreateProject?: () => void;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  if (allDone) return null;

  return (
    <Callout
      tone="neutral"
      title={`Primeiros passos · ${doneCount}/${steps.length}`}
    >
      <p style={{ margin: "0 0 0.75rem" }}>
        Meta: email ok, um projeto, um repo e um scan real — aí o Relatório passa a ter o que mostrar.
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
              {!s.done && s.id === "project" && onCreateProject ? (
                <button type="button" className="hero-btn hero-btn-outline" onClick={onCreateProject}>
                  {s.cta ?? "Novo projeto"}
                </button>
              ) : null}
              {!s.done && s.href ? (
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
