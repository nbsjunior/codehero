"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import CopyButton from "@/components/CopyButton";
import { Callout, DataSection, PageHeader } from "@/components/AdminUi";
import { dbClient } from "@/lib/firebaseDb";
import { HERO_CORE_URL } from "@/lib/heroCoreUrl";
import type { AdminProjectRow } from "@/lib/api";

const DEFAULT_ENTRY =
  "Buscar as regras de avaliação de código (CodeHero) e aplicar no contexto que está sendo gerado";

const ENTRY_PRESETS = [
  {
    id: "rules",
    label: "Regras no contexto de geração",
    entry: DEFAULT_ENTRY,
  },
  {
    id: "rules-issues",
    label: "Regras + apontamentos abertos",
    entry:
      "Buscar regras de avaliação CodeHero e apontamentos abertos (CRITICAL/BLOCKER) e aplicar no contexto de geração",
  },
  {
    id: "fix-loop",
    label: "Loop de correção verificável",
    entry:
      "Antes de corrigir código: get_generation_context com regras CodeHero; depois get_issues → get_sdd_spec → patch → run_scan → submit_fix_result",
  },
] as const;

type RepoWithToken = {
  repoId: string;
  name: string;
  ingestToken: string;
};

type Props = {
  projects: AdminProjectRow[];
  initialOrgId?: string | null;
  initialProjectId?: string | null;
  onOpenWorkspace?: (orgId: string, projectId: string, repoId?: string) => void;
};

export default function McpIntegrationPanel({
  projects,
  initialOrgId,
  initialProjectId,
  onOpenWorkspace,
}: Props) {
  const [orgProjectKey, setOrgProjectKey] = useState(() => {
    if (initialOrgId && initialProjectId) return `${initialOrgId}::${initialProjectId}`;
    const first = projects[0];
    return first ? `${first.orgId}::${first.projectId}` : "";
  });
  const [repos, setRepos] = useState<RepoWithToken[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoId, setRepoId] = useState("");
  const [entry, setEntry] = useState(DEFAULT_ENTRY);
  const [presetId, setPresetId] = useState<string>("rules");

  const selectedProject = useMemo(
    () => projects.find((p) => `${p.orgId}::${p.projectId}` === orgProjectKey) ?? null,
    [projects, orgProjectKey],
  );

  const [pastedToken, setPastedToken] = useState("");

  const loadRepos = useCallback(async (orgId: string, projectId: string) => {
    setReposLoading(true);
    setReposError(null);
    try {
      const snap = await getDocs(collection(dbClient, "orgs", orgId, "projects", projectId, "repos"));
      const list: RepoWithToken[] = snap.docs.map((d) => {
        const data = d.data() as { name?: string; ingestToken?: string; ingestTokenHint?: string };
        return {
          repoId: d.id,
          name: data.name || d.id,
          // Never trust client-readable Firestore for the bearer — paste after rotate.
          ingestToken: "",
          hint: data.ingestTokenHint ?? "",
        };
      });
      setRepos(list);
      setRepoId((prev) => (prev && list.some((r) => r.repoId === prev) ? prev : list[0]?.repoId ?? ""));
    } catch {
      setRepos([]);
      setReposError("Não foi possível carregar os repositórios deste projeto.");
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setRepos([]);
      return;
    }
    void loadRepos(selectedProject.orgId, selectedProject.projectId);
  }, [selectedProject, loadRepos]);

  const selectedRepo = useMemo(
    () => repos.find((r) => r.repoId === repoId) ?? repos[0] ?? null,
    [repos, repoId],
  );

  const effectiveToken = pastedToken.trim() || selectedRepo?.ingestToken || "";

  const mcpEnv =
    selectedProject && selectedRepo && effectiveToken
      ? {
          HERO_CORE_URL,
          HERO_TOKEN: effectiveToken,
          HERO_ORG_ID: selectedProject.orgId,
          HERO_PROJECT_ID: selectedProject.projectId,
          HERO_REPO_ID: selectedRepo.repoId,
        }
      : null;

  /** Plug-and-play: npx baixa o pacote público (sem path do monorepo). */
  const mcpServerCommand = "npx";
  const mcpServerArgs = ["-y", "codehero-mcp@latest"];

  const cursorMcpConfig = mcpEnv
    ? JSON.stringify(
        {
          mcpServers: {
            codehero: {
              command: mcpServerCommand,
              args: mcpServerArgs,
              env: mcpEnv,
            },
          },
        },
        null,
        2,
      )
    : "";

  const copilotMcpConfig = mcpEnv
    ? JSON.stringify(
        {
          servers: {
            codehero: {
              type: "stdio",
              command: mcpServerCommand,
              args: mcpServerArgs,
              tools: [
                "get_generation_context",
                "get_active_rules",
                "get_issues",
                "get_sdd_spec",
                "run_scan",
                "submit_fix_result",
                "apply_sdd_workflow",
              ],
              env: mcpEnv,
            },
          },
        },
        null,
        2,
      )
    : "";

  const agentRule = [
    "# CodeHero — contexto de geração",
    "",
    "Antes de gerar ou editar código neste repositório:",
    "1. Chame a ferramenta MCP `get_generation_context` com a entrada abaixo.",
    "2. Injete o texto retornado no contexto (system/user) da geração.",
    "3. Só então produza ou altere o código.",
    "",
    "## Entrada",
    entry.trim() || DEFAULT_ENTRY,
    "",
    "## Ferramentas úteis",
    "- `get_generation_context` — monta o bloco de regras/issues a partir da entrada",
    "- `get_active_rules` — catálogo completo de regras ativas",
    "- `get_issues` / `get_sdd_spec` / `run_scan` / `submit_fix_result` — loop de correção com prova",
    "- `apply_sdd_workflow` — roteiro canônico verified-fix",
    "",
    "Nunca declare um fix concluído sem evidência de `run_scan`.",
  ].join("\n");

  const agentPrompt = [
    `Use o MCP CodeHero. Chame get_generation_context com entry:`,
    `"${entry.trim() || DEFAULT_ENTRY}"`,
    "",
    "Aplique o retorno no contexto e só então gere/edite o código pedido.",
  ].join("\n");

  return (
    <>
      <PageHeader
        eyebrow="Projetos"
        title="Integração MCP"
        description="Plug-and-play via npx (pacote codehero-mcp). Cole o JSON no Cursor, Copilot ou Claude — sem clonar o monorepo."
      />

      <Callout tone="ok" title="Como funciona">
        A entrada abaixo vira instrução para o agente: ele chama{" "}
        <code>get_generation_context</code> no MCP, recebe as regras ativas (e opcionalmente apontamentos) e
        aplica esse bloco no contexto de geração — o mesmo motor usado por Action, IDE e esteira. Guia passo a
        passo (Cursor, Claude, Copilot, Devin):{" "}
        <a
          href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Conectar-MCP-CodeHero.md"
          target="_blank"
          rel="noreferrer"
        >
          Conectar MCP
        </a>
        .
      </Callout>

      <DataSection title="1. Projeto e repositório">
        {projects.length === 0 ? (
          <p className="hero-caption" style={{ margin: 0 }}>
            Nenhum projeto carregado. Abra Instalação ou Todos os projetos primeiro.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.85rem", maxWidth: 640 }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span className="hero-caption">Projeto</span>
              <select
                className="hero-input"
                value={orgProjectKey}
                onChange={(e) => {
                  setOrgProjectKey(e.target.value);
                  setRepoId("");
                }}
              >
                {projects.map((p) => (
                  <option key={`${p.orgId}::${p.projectId}`} value={`${p.orgId}::${p.projectId}`}>
                    {p.orgName} / {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span className="hero-caption">Repositório (token de ingestão)</span>
              <select
                className="hero-input"
                value={selectedRepo?.repoId ?? ""}
                onChange={(e) => setRepoId(e.target.value)}
                disabled={reposLoading || !repos.length}
              >
                {reposLoading && <option value="">Carregando…</option>}
                {!reposLoading && repos.length === 0 && <option value="">Sem repositórios</option>}
                {repos.map((r) => (
                  <option key={r.repoId} value={r.repoId}>
                    {r.name}
                    {!r.ingestToken ? " (cole o token após rotacionar no workspace)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span className="hero-caption">Token de ingestão (colar após rotacionar)</span>
              <input
                className="hero-input"
                type="password"
                autoComplete="off"
                placeholder="chp_…"
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
              />
            </label>
            {reposError && <div className="hero-error">{reposError}</div>}
            {selectedProject && onOpenWorkspace && (
              <button
                type="button"
                className="hero-btn hero-btn-outline"
                style={{ justifySelf: "start" }}
                onClick={() =>
                  onOpenWorkspace(selectedProject.orgId, selectedProject.projectId, selectedRepo?.repoId)
                }
              >
                Abrir workspace completo
              </button>
            )}
          </div>
        )}
      </DataSection>

      <DataSection title="2. Entrada de contexto">
        <p className="hero-caption" style={{ marginTop: 0 }}>
          Descreva o que o agente deve buscar e injetar antes de gerar código. Presets cobrem o caso mais comum
          (regras de avaliação).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.85rem" }}>
          {ENTRY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`hero-btn${presetId === p.id ? "" : " hero-btn-outline"}`}
              onClick={() => {
                setPresetId(p.id);
                setEntry(p.entry);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span className="hero-caption">Entrada</span>
          <textarea
            className="hero-input"
            rows={3}
            value={entry}
            onChange={(e) => {
              setPresetId("custom");
              setEntry(e.target.value);
            }}
            placeholder={DEFAULT_ENTRY}
          />
        </label>
      </DataSection>

      <DataSection title="3. Artefatos gerados">
        {!mcpEnv ? (
          <Callout tone="warn" title="Token indisponível">
            Selecione um repositório com token de ingestão. Se necessário, abra o workspace e rotacione/gere o token
            na aba MCP.
          </Callout>
        ) : (
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <div>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem" }}>Regra do agente (Cursor / AGENTS.md)</h3>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                Cole em <code>.cursor/rules/codehero-mcp.mdc</code> ou <code>AGENTS.md</code>
              </p>
              <div className="hero-copyrow">
                <pre className="hero-code" style={{ maxHeight: 260 }}>
                  {agentRule}
                </pre>
                <CopyButton text={agentRule} />
              </div>
            </div>

            <div>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem" }}>Prompt pronto para colar no chat</h3>
              <div className="hero-copyrow">
                <pre className="hero-code" style={{ maxHeight: 160 }}>
                  {agentPrompt}
                </pre>
                <CopyButton text={agentPrompt} />
              </div>
            </div>

            <div>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem" }}>Cursor / Claude — mcp.json</h3>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                Usa <code>npx -y codehero-mcp@latest</code> (Node ≥ 20). Publique o pacote uma vez com{" "}
                <code>npm publish -w codehero-mcp</code>. Cursor: <code>.cursor/mcp.json</code>.
              </p>
              <div className="hero-copyrow">
                <pre className="hero-code" style={{ maxHeight: 240 }}>
                  {cursorMcpConfig}
                </pre>
                <CopyButton text={cursorMcpConfig} />
              </div>
            </div>

            <div>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem" }}>GitHub Copilot — .vscode/mcp.json</h3>
              <div className="hero-copyrow">
                <pre className="hero-code" style={{ maxHeight: 240 }}>
                  {copilotMcpConfig}
                </pre>
                <CopyButton text={copilotMcpConfig} />
              </div>
            </div>
          </div>
        )}
      </DataSection>

      <DataSection title="Ferramentas MCP">
        <ul style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.6 }}>
          <li>
            <code>get_generation_context</code> — recebe a <em>entrada</em> e monta o bloco de contexto (regras /
            issues)
          </li>
          <li>
            <code>get_active_rules</code> — catálogo ativo (core + dress code do projeto)
          </li>
          <li>
            <code>get_issues</code> · <code>get_sdd_spec</code> · <code>run_scan</code> ·{" "}
            <code>submit_fix_result</code> · <code>apply_sdd_workflow</code>
          </li>
        </ul>
      </DataSection>
    </>
  );
}
