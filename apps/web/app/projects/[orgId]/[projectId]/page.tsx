"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import CopyButton from "@/components/CopyButton";
import { dbClient } from "@/lib/firebase";
import { rotateIngestToken } from "@/lib/api";
import { HERO_CORE_URL } from "@/lib/heroCoreUrl";

interface ProjectData {
  name: string;
  repoUrl: string | null;
  ingestToken: string;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
}

const ratingColor: Record<string, string> = {
  A: "var(--rating-a)",
  B: "var(--rating-b)",
  C: "var(--rating-c)",
  D: "var(--rating-d)",
  E: "var(--rating-e)",
};

type Tab = "overview" | "vscode" | "action" | "mcp";

function parseOwnerRepo(repoUrl: string | null): { owner: string; repo: string } | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

function buildWorkflowYaml(orgId: string, projectId: string): string {
  return `name: CodeHero Analysis
on:
  pull_request:
  push:
    branches: [main]

jobs:
  codehero:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: nbsjunior/codehero/packages/github-action@main
        with:
          server-url: \${{ vars.HERO_CORE_URL }}
          token: \${{ secrets.HERO_TOKEN }}
          org-id: "${orgId}"
          project-id: "${projectId}"
          path: "."
          fail-on: CRITICAL
`;
}

function ProjectSettings() {
  const params = useParams<{ orgId: string; projectId: string }>();
  const orgId = params.orgId;
  const projectId = params.projectId;

  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDoc(doc(dbClient, "orgs", orgId, "projects", projectId));
      if (!snap.exists()) {
        setError("Projeto não encontrado ou você não tem acesso a ele.");
        setProject(null);
        return;
      }
      setProject(snap.data() as ProjectData);
    } catch {
      setError("Não foi possível carregar o projeto.");
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRotate() {
    if (!rotateConfirm) {
      setRotateConfirm(true);
      return;
    }
    setRotating(true);
    setRotateError(null);
    try {
      const newToken = await rotateIngestToken({ orgId, projectId });
      setProject((p) => (p ? { ...p, ingestToken: newToken } : p));
      setRotateConfirm(false);
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : "Falha ao rotacionar o token.");
    } finally {
      setRotating(false);
    }
  }

  if (loading) {
    return (
      <main className="hero-shell">
        <p className="hero-caption">Carregando projeto…</p>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="hero-shell">
        <div className="hero-error">{error ?? "Projeto não encontrado."}</div>
        <Link href="/" className="hero-link" style={{ display: "inline-block", marginTop: "1rem" }}>
          ← Voltar ao dashboard
        </Link>
      </main>
    );
  }

  const ownerRepo = parseOwnerRepo(project.repoUrl);
  const workflowYaml = buildWorkflowYaml(orgId, projectId);
  const oneClickUrl = ownerRepo
    ? `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/new/main?filename=${encodeURIComponent(
        ".github/workflows/codehero.yml",
      )}&value=${encodeURIComponent(workflowYaml)}`
    : null;

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        codehero: {
          command: "node",
          args: ["<caminho-do-repo>/packages/mcp/dist/server.js"],
          env: {
            HERO_CORE_URL,
            HERO_TOKEN: project.ingestToken,
            HERO_ORG_ID: orgId,
            HERO_PROJECT_ID: projectId,
          },
        },
      },
    },
    null,
    2,
  );

  const vscodeSettings = JSON.stringify(
    {
      "codehero.scanOnSave": true,
      "codehero.enableCache": true,
      "codehero.minSeverity": "INFO",
      "codehero.orgId": orgId,
      "codehero.projectId": projectId,
      "codehero.serverUrl": HERO_CORE_URL,
      "codehero.token": project.ingestToken,
    },
    null,
    2,
  );

  return (
    <main className="hero-shell">
      <Link href="/" className="hero-breadcrumb hero-link" style={{ textDecoration: "none" }}>
        ← Dashboard
      </Link>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem" }}>
        <div>
          <h1 className="hero-display" style={{ fontSize: "2.25rem", margin: "0 0 0.25rem" }}>
            {project.name}
          </h1>
          <p className="hero-caption" style={{ margin: 0 }}>
            {orgId} / {projectId}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span
            className="hero-badge"
            style={{ background: project.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)", color: "#fff" }}
          >
            Gate: {project.qualityGateStatus}
          </span>
          <span className="hero-rating" style={{ background: ratingColor[project.securityRating] ?? "var(--muted)" }}>
            {project.securityRating}
          </span>
          <span className="hero-rating" style={{ background: ratingColor[project.maintainabilityRating] ?? "var(--muted)" }}>
            {project.maintainabilityRating}
          </span>
        </div>
      </header>

      <div className="hero-tabs" style={{ marginTop: "1.75rem" }}>
        <button type="button" className={`hero-tab${tab === "overview" ? " is-active" : ""}`} onClick={() => setTab("overview")}>
          Visão geral
        </button>
        <button type="button" className={`hero-tab${tab === "vscode" ? " is-active" : ""}`} onClick={() => setTab("vscode")}>
          Plugin VS Code
        </button>
        <button type="button" className={`hero-tab${tab === "action" ? " is-active" : ""}`} onClick={() => setTab("action")}>
          GitHub Action
        </button>
        <button type="button" className={`hero-tab${tab === "mcp" ? " is-active" : ""}`} onClick={() => setTab("mcp")}>
          MCP (Claude)
        </button>
      </div>

      {tab === "overview" && (
        <section className="hero-panel" style={{ padding: "1.75rem" }}>
          <h2 className="hero-display" style={{ fontSize: "1.4rem", margin: "0 0 1rem" }}>
            Visão geral
          </h2>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1.25rem", margin: 0 }}>
            <div>
              <dt className="hero-label">Débito técnico</dt>
              <dd style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>{Math.round(project.debtMinutes / 60)}h</dd>
            </div>
            <div>
              <dt className="hero-label">Issues abertas</dt>
              <dd style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>{project.openIssues}</dd>
            </div>
            <div>
              <dt className="hero-label">Repositório</dt>
              <dd style={{ margin: 0 }}>
                {project.repoUrl ? (
                  <a href={project.repoUrl} target="_blank" rel="noreferrer" className="hero-link">
                    {project.repoUrl.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="hero-caption">não configurado</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {tab === "vscode" && (
        <section className="hero-panel" style={{ padding: "1.75rem" }}>
          <h2 className="hero-display" style={{ fontSize: "1.4rem", margin: "0 0 0.35rem" }}>
            Plugin VS Code / Cursor
          </h2>
          <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
            Scan local com regras determinísticas · painel Avaliação · Problems no editor
          </p>

          <div className="hero-step">
            <span className="hero-step-num">1</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                Baixe o plugin e instale: Extensions → ⋯ → <strong>Install from VSIX</strong>.
              </p>
              <a
                className="hero-btn hero-btn-accent"
                href="/downloads/codehero-vscode.vsix"
                download
                style={{ display: "inline-block", textDecoration: "none" }}
              >
                Baixar plugin (.vsix)
              </a>
            </div>
          </div>

          <div className="hero-step">
            <span className="hero-step-num">2</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                Abra a pasta do repo no VS Code/Cursor → clique no ícone <strong>CodeHero</strong> na barra lateral →{" "}
                <strong>Rodar scan no workspace</strong>. O resultado aparece no painel Avaliação e em Problems.
              </p>
              <p className="hero-caption" style={{ margin: 0 }}>
                O scanner vem embutido no plugin — não precisa instalar CLI. Node.js no PATH é suficiente.
              </p>
            </div>
          </div>

          <div className="hero-step">
            <span className="hero-step-num">3</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                (Opcional) Cole no <code>.vscode/settings.json</code> do workspace para ligar este projeto ao portal:
              </p>
              <div className="hero-copyrow">
                <pre className="hero-code">{vscodeSettings}</pre>
                <CopyButton text={vscodeSettings} />
              </div>
            </div>
          </div>

          <div className="hero-step" style={{ marginBottom: 0 }}>
            <span className="hero-step-num">4</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0 }}>
                Configurações no editor: Command Palette → <code>CodeHero: Abrir configurações</code> (scan ao salvar,
                cache, severidade mínima).
              </p>
            </div>
          </div>
        </section>
      )}

      {tab === "action" && (
        <section className="hero-panel" style={{ padding: "1.75rem" }}>
          <h2 className="hero-display" style={{ fontSize: "1.4rem", margin: "0 0 0.35rem" }}>
            Esteira GitHub Action
          </h2>
          <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
            vincule o repositório em 1 clique · quality gate bloqueia o merge
          </p>

          <div className="hero-step">
            <span className="hero-step-num">1</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                {ownerRepo ? (
                  <>
                    Clique para abrir o GitHub já com o workflow pronto para commitar em{" "}
                    <strong>
                      {ownerRepo.owner}/{ownerRepo.repo}
                    </strong>
                    :
                  </>
                ) : (
                  <>Cadastre a URL do repositório GitHub no projeto (na criação, ou peça para editar) para habilitar o link de 1 clique.</>
                )}
              </p>
              {oneClickUrl ? (
                <a className="hero-btn hero-btn-accent" href={oneClickUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", textDecoration: "none" }}>
                  Adicionar workflow no GitHub (1 clique)
                </a>
              ) : (
                <span className="hero-badge">repoUrl não configurado</span>
              )}
            </div>
          </div>

          <div className="hero-step">
            <span className="hero-step-num">2</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>No repositório, configure (Settings → Secrets and variables → Actions):</p>
              <table className="hero-table" style={{ marginBottom: "0.5rem" }}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>HERO_CORE_URL</code>
                    </td>
                    <td>variable</td>
                    <td style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <code style={{ fontSize: "0.78rem" }}>{HERO_CORE_URL}</code>
                      <CopyButton text={HERO_CORE_URL} label="Copiar" />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>HERO_TOKEN</code>
                    </td>
                    <td>secret</td>
                    <td style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <code style={{ fontSize: "0.78rem" }}>••••••••{project.ingestToken.slice(-6)}</code>
                      <CopyButton text={project.ingestToken} label="Copiar token" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="hero-step" style={{ marginBottom: 0 }}>
            <span className="hero-step-num">3</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>Ou cole o YAML manualmente:</p>
              <div className="hero-copyrow">
                <pre className="hero-code" style={{ maxHeight: 260 }}>
                  {workflowYaml}
                </pre>
                <CopyButton text={workflowYaml} />
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "mcp" && (
        <section className="hero-panel" style={{ padding: "1.75rem" }}>
          <h2 className="hero-display" style={{ fontSize: "1.4rem", margin: "0 0 0.35rem" }}>
            MCP — conectar ao Claude
          </h2>
          <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
            get_issues · get_sdd_spec · run_scan · submit_fix_result
          </p>

          <div className="hero-step">
            <span className="hero-step-num">1</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                Compile o servidor: <code>npm run build -w @codehero/mcp</code>
              </p>
            </div>
          </div>

          <div className="hero-step">
            <span className="hero-step-num">2</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                Cole em <code>claude_desktop_config.json</code>:
              </p>
              <div className="hero-copyrow">
                <pre className="hero-code" style={{ maxHeight: 260 }}>
                  {mcpConfig}
                </pre>
                <CopyButton text={mcpConfig} />
              </div>
            </div>
          </div>

          <hr className="hero-divider" />

          <div>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Token de acesso</h3>
            <p className="hero-caption" style={{ marginTop: 0 }}>
              o mesmo token usado por CI, IDE e MCP — rotacionar invalida todos de uma vez
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <code className="hero-badge">••••••••{project.ingestToken.slice(-6)}</code>
              <CopyButton text={project.ingestToken} label="Copiar token completo" />
              <button
                type="button"
                className="hero-btn hero-btn-outline"
                onClick={handleRotate}
                disabled={rotating}
                style={{ borderColor: rotateConfirm ? "var(--accent)" : undefined, color: rotateConfirm ? "var(--accent)" : undefined }}
              >
                {rotating ? "Rotacionando…" : rotateConfirm ? "Confirmar rotação" : "Rotacionar token"}
              </button>
              {rotateConfirm && !rotating && (
                <button type="button" className="hero-link" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem" }} onClick={() => setRotateConfirm(false)}>
                  cancelar
                </button>
              )}
            </div>
            {rotateError && (
              <div className="hero-error" style={{ marginTop: "0.75rem" }}>
                {rotateError}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export default function ProjectSettingsPage() {
  return (
    <AuthGate>
      <AppShell>
        <ProjectSettings />
      </AppShell>
    </AuthGate>
  );
}
