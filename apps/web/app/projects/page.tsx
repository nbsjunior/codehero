"use client";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { buildCodeHeroWorkflowYaml, buildGithubCliSetupScript, buildFindingFicha } from "@codehero/contracts";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import CopyButton from "@/components/CopyButton";
import FindingFichaCard from "@/components/FindingFichaCard";
import {
  DebtMeter,
  GatePill,
  RatingRing,
  SeverityBars,
  VerticalBars,
  countByField,
} from "@/components/RepoHealthCharts";
import { dbClient } from "@/lib/firebase";
import {
  addRepoToProject,
  flagIssueFeedback,
  rotateIngestToken,
  runRepoAutoScanNow,
  setRepoAutoScan,
  startGithubActionInstall,
  type IssueFeedbackVerdict,
  type RepoAutoScan,
} from "@/lib/api";
import { HERO_CORE_URL } from "@/lib/heroCoreUrl";

interface ProjectData {
  name: string;
  slug?: string;
  repoCount: number;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
}

interface RepoData {
  repoId: string;
  name: string;
  repoUrl: string | null;
  ingestToken: string;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
  githubActionInstalledAt?: unknown;
  githubActionRepo?: string;
  autoScan?: RepoAutoScan;
}

interface IssueFeedbackEntry {
  verdict: "false_positive" | "confirmed" | "fix_accepted" | "fix_rejected";
  note: string | null;
  uid: string;
  at: string;
}

interface RepoIssue {
  fingerprint: string;
  ruleId: string;
  severity: string;
  issueType?: string;
  message?: string;
  file: string;
  line?: number;
  snippet?: string;
  sddTemplateId?: string | null;
  remediationEffortMin?: number;
  // Ficha persistida no próprio issue (preferida); ausente em issues antigas,
  // que caem no fallback de recomputar via buildFindingFicha no cliente.
  risk?: string | null;
  reason?: string | null;
  howToFix?: string | null;
  strategy?: string | null;
  constraints?: string[];
  referenceExample?: { before: string; after: string } | null;
  cwe?: string[];
  feedback?: IssueFeedbackEntry[];
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

function parseTab(raw: string | null): Tab {
  if (raw === "vscode" || raw === "action" || raw === "mcp" || raw === "overview") return raw;
  return "overview";
}

function RatingBadges({ p }: { p: { qualityGateStatus: string; securityRating: string; maintainabilityRating: string } }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span
        className="hero-badge"
        style={{ background: p.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)", color: "#fff" }}
      >
        Gate: {p.qualityGateStatus}
      </span>
      <span className="hero-rating" style={{ background: ratingColor[p.securityRating] ?? "var(--muted)" }}>
        {p.securityRating}
      </span>
      <span className="hero-rating" style={{ background: ratingColor[p.maintainabilityRating] ?? "var(--muted)" }}>
        {p.maintainabilityRating}
      </span>
    </div>
  );
}

function ProjectSettings() {
  const router = useRouter();
  const search = useSearchParams();
  const orgId = (search.get("org") ?? "").trim();
  const projectId = (search.get("id") ?? "").trim();
  const repoIdParam = (search.get("repo") ?? "").trim();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [repos, setRepos] = useState<RepoData[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => parseTab(search.get("tab")));
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [installingGha, setInstallingGha] = useState(false);
  const [ghaBanner, setGhaBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Add-repo form
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState("");
  const [addingRepo, setAddingRepo] = useState(false);
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const [newRepoToken, setNewRepoToken] = useState<string | null>(null);
  const [issues, setIssues] = useState<RepoIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [openIssueFp, setOpenIssueFp] = useState<string | null>(null);

  const [feedbackBusyFp, setFeedbackBusyFp] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Gráfico de manutenibilidade/segurança com drill-down até a lista de apontamentos
  const [drillOpen, setDrillOpen] = useState<"maintainability" | "security" | null>(null);
  const [issueFilter, setIssueFilter] = useState<{ label: string; severity?: string; issueType?: string } | null>(null);

  // Auto-scan (checagem automática periódica)
  const [autoScanBusy, setAutoScanBusy] = useState(false);
  const [autoScanError, setAutoScanError] = useState<string | null>(null);
  const [runNowBusy, setRunNowBusy] = useState(false);
  const [periodicityDraft, setPeriodicityDraft] = useState(7);

  const load = useCallback(async () => {
    if (!orgId || !projectId) {
      setError("Informe org e projeto na URL (?org=…&id=…).");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const projSnap = await getDoc(doc(dbClient, "orgs", orgId, "projects", projectId));
      if (!projSnap.exists()) {
        setError("Projeto não encontrado ou você não tem acesso a ele.");
        setProject(null);
        return;
      }
      setProject(projSnap.data() as ProjectData);

      const reposSnap = await getDocs(
        query(collection(dbClient, "orgs", orgId, "projects", projectId, "repos"), orderBy("createdAt", "asc")),
      );
      const repoList = reposSnap.docs.map((d) => {
        const data = d.data() as Omit<RepoData, "repoId" | "autoScan"> & {
          autoScan?: {
            enabled?: boolean;
            periodicityDays?: number;
            nextRunAt?: { toDate: () => Date } | null;
            lastRunAt?: { toDate: () => Date } | null;
          };
        };
        const rawAutoScan = data.autoScan;
        return {
          repoId: d.id,
          ...data,
          autoScan: rawAutoScan
            ? {
                enabled: !!rawAutoScan.enabled,
                periodicityDays: rawAutoScan.periodicityDays ?? 7,
                nextRunAt: rawAutoScan.nextRunAt?.toDate?.().toISOString() ?? null,
                lastRunAt: rawAutoScan.lastRunAt?.toDate?.().toISOString() ?? null,
              }
            : undefined,
        };
      });
      setRepos(repoList);
      setSelectedRepoId((prev) => {
        if (prev && repoList.some((r) => r.repoId === prev)) return prev;
        if (repoIdParam && repoList.some((r) => r.repoId === repoIdParam)) return repoIdParam;
        return repoList[0]?.repoId ?? null;
      });
    } catch {
      setError("Não foi possível carregar o projeto.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const gha = search.get("gha");
    if (gha === "ok") {
      setTab("action");
      setGhaBanner({
        kind: "ok",
        text: "GitHub Action configurada: workflow + HERO_TOKEN + HERO_CORE_URL. O próximo push/PR já roda o scan.",
      });
      void load();
    } else if (gha === "error") {
      setTab("action");
      setGhaBanner({
        kind: "error",
        text: search.get("msg") || "Falha ao instalar a Action no GitHub.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selectedRepo = repos.find((r) => r.repoId === selectedRepoId) ?? null;

  useEffect(() => {
    setPeriodicityDraft(selectedRepo?.autoScan?.periodicityDays ?? 7);
    setAutoScanError(null);
  }, [selectedRepo?.repoId, selectedRepo?.autoScan?.periodicityDays]);

  useEffect(() => {
    if (!orgId || !projectId || !selectedRepoId) {
      setIssues([]);
      return;
    }
    let cancelled = false;
    setIssuesLoading(true);
    setOpenIssueFp(null);
    void (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(dbClient, "orgs", orgId, "projects", projectId, "repos", selectedRepoId, "issues"),
            where("status", "==", "open"),
            limit(80),
          ),
        );
        if (cancelled) return;
        const rows: RepoIssue[] = snap.docs.map((d) => {
          const data = d.data() as Omit<RepoIssue, "fingerprint">;
          return { fingerprint: d.id, ...data };
        });
        const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
        rows.sort((a, b) => order.indexOf(b.severity) - order.indexOf(a.severity));
        setIssues(rows);
      } catch {
        if (!cancelled) setIssues([]);
      } finally {
        if (!cancelled) setIssuesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, projectId, selectedRepoId]);

  function selectRepo(repoId: string) {
    setSelectedRepoId(repoId);
    setRotateConfirm(false);
    setGhaBanner(null);
    const params = new URLSearchParams(Array.from(search.entries()));
    params.set("repo", repoId);
    router.replace(`/projects?${params.toString()}`, { scroll: false });
  }

  async function handleAddRepo(e: FormEvent) {
    e.preventDefault();
    setAddingRepo(true);
    setAddRepoError(null);
    try {
      const { repoId, ingestToken } = await addRepoToProject({ orgId, projectId, repoUrl: newRepoUrl.trim() });
      setNewRepoToken(ingestToken);
      setNewRepoUrl("");
      setShowAddRepo(false);
      await load();
      selectRepo(repoId);
    } catch (err) {
      setAddRepoError(err instanceof Error ? err.message : "Falha ao adicionar repositório.");
    } finally {
      setAddingRepo(false);
    }
  }

  async function handleOneClickInstall() {
    if (!selectedRepo) return;
    setInstallingGha(true);
    setGhaBanner(null);
    try {
      const { authorizeUrl } = await startGithubActionInstall({
        orgId,
        projectId,
        repoId: selectedRepo.repoId,
        returnOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      window.location.assign(authorizeUrl);
    } catch (err) {
      setGhaBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Falha ao iniciar o OAuth do GitHub.",
      });
      setInstallingGha(false);
    }
  }

  async function handleIssueFeedback(issue: RepoIssue, verdict: IssueFeedbackVerdict) {
    if (!selectedRepo) return;
    setFeedbackBusyFp(issue.fingerprint);
    setFeedbackError(null);
    try {
      await flagIssueFeedback({ orgId, projectId, repoId: selectedRepo.repoId, fingerprint: issue.fingerprint, verdict });
      setIssues((prev) =>
        prev.map((it) =>
          it.fingerprint === issue.fingerprint
            ? {
                ...it,
                feedback: [...(it.feedback ?? []), { verdict, note: null, uid: "you", at: new Date().toISOString() }],
              }
            : it,
        ),
      );
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Falha ao registrar o feedback.");
    } finally {
      setFeedbackBusyFp(null);
    }
  }

  async function handleSaveAutoScan(enabled: boolean, periodicityDays: number) {
    if (!selectedRepo) return;
    setAutoScanBusy(true);
    setAutoScanError(null);
    try {
      const res = await setRepoAutoScan({ orgId, projectId, repoId: selectedRepo.repoId, enabled, periodicityDays });
      setRepos((prev) =>
        prev.map((r) =>
          r.repoId === selectedRepo.repoId
            ? {
                ...r,
                autoScan: {
                  enabled: res.enabled,
                  periodicityDays: res.periodicityDays,
                  nextRunAt: res.nextRunAt,
                  lastRunAt: r.autoScan?.lastRunAt ?? null,
                },
              }
            : r,
        ),
      );
    } catch (err) {
      setAutoScanError(err instanceof Error ? err.message : "Falha ao salvar a checagem automática.");
    } finally {
      setAutoScanBusy(false);
    }
  }

  async function handleRunAutoScanNow() {
    if (!selectedRepo) return;
    setRunNowBusy(true);
    setAutoScanError(null);
    try {
      await runRepoAutoScanNow({ orgId, projectId, repoId: selectedRepo.repoId });
      await load();
    } catch (err) {
      setAutoScanError(err instanceof Error ? err.message : "Falha ao rodar a checagem agora.");
    } finally {
      setRunNowBusy(false);
    }
  }

  async function handleRotate() {
    if (!selectedRepo) return;
    if (!rotateConfirm) {
      setRotateConfirm(true);
      return;
    }
    setRotating(true);
    setRotateError(null);
    try {
      const newToken = await rotateIngestToken({ orgId, projectId, repoId: selectedRepo.repoId });
      setRepos((prev) => prev.map((r) => (r.repoId === selectedRepo.repoId ? { ...r, ingestToken: newToken } : r)));
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

  const ownerRepo = selectedRepo ? parseOwnerRepo(selectedRepo.repoUrl) : null;
  const workflowYaml = selectedRepo ? buildCodeHeroWorkflowYaml(orgId, projectId, selectedRepo.repoId) : "";
  const ghCliScript =
    ownerRepo && selectedRepo
      ? buildGithubCliSetupScript({
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          heroCoreUrl: HERO_CORE_URL,
          ingestToken: selectedRepo.ingestToken,
        })
      : null;
  const deepLinkUrl =
    ownerRepo && selectedRepo
      ? `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/new/main?filename=${encodeURIComponent(
          ".github/workflows/codehero.yml",
        )}&value=${encodeURIComponent(workflowYaml)}`
      : null;

  const mcpEnv = selectedRepo
    ? {
        HERO_CORE_URL,
        HERO_TOKEN: selectedRepo.ingestToken,
        HERO_ORG_ID: orgId,
        HERO_PROJECT_ID: projectId,
        HERO_REPO_ID: selectedRepo.repoId,
      }
    : null;
  const mcpServerCommand = "node";
  const mcpServerArgs = ["<caminho-do-repo>/packages/mcp/dist/server.js"];

  const claudeMcpConfig = mcpEnv
    ? JSON.stringify({ mcpServers: { codehero: { command: mcpServerCommand, args: mcpServerArgs, env: mcpEnv } } }, null, 2)
    : "";
  const cursorMcpConfig = claudeMcpConfig;
  const copilotMcpConfig = mcpEnv
    ? JSON.stringify(
        { servers: { codehero: { type: "stdio", command: mcpServerCommand, args: mcpServerArgs, env: mcpEnv } } },
        null,
        2,
      )
    : "";

  const vscodeSettings = selectedRepo
    ? JSON.stringify(
        {
          "codehero.scanOnSave": true,
          "codehero.enableCache": true,
          "codehero.minSeverity": "INFO",
          "codehero.orgId": orgId,
          "codehero.projectId": projectId,
          "codehero.repoId": selectedRepo.repoId,
          "codehero.serverUrl": HERO_CORE_URL,
          "codehero.token": selectedRepo.ingestToken,
        },
        null,
        2,
      )
    : "";

  return (
    <main className="hero-shell">
      <Link href="/" className="hero-breadcrumb hero-link" style={{ textDecoration: "none" }}>
        ← Dashboard
      </Link>
      <header
        className="ch-section-title"
        style={{ marginTop: "0.75rem", alignItems: "flex-start" }}
      >
        <div>
          <p className="hero-caption" style={{ margin: "0 0 0.35rem" }}>
            Admin do repositório
          </p>
          <h1 className="hero-display" style={{ fontSize: "clamp(1.8rem, 5vw, 2.4rem)", margin: "0 0 0.35rem" }}>
            {project.name}
          </h1>
          <p className="hero-caption" style={{ margin: 0 }}>
            {orgId} / {projectId} · {project.repoCount} repositório(s)
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
          <GatePill status={project.qualityGateStatus} />
          <RatingBadges p={project} />
        </div>
      </header>

      <section className="hero-panel" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
        <div className="ch-section-title">
          <h2 style={{ fontSize: "1.2rem" }}>Repositórios</h2>
          <button
            type="button"
            className="hero-btn hero-btn-outline"
            style={{ padding: "0.45rem 0.9rem", fontSize: "0.8rem" }}
            onClick={() => setShowAddRepo((v) => !v)}
          >
            {showAddRepo ? "Fechar" : "+ Adicionar repositório"}
          </button>
        </div>

        {showAddRepo && (
          <form onSubmit={handleAddRepo} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <input
              className="hero-input"
              style={{ flex: 1, minWidth: 220 }}
              required
              placeholder="https://github.com/org/outro-repo"
              value={newRepoUrl}
              onChange={(e) => setNewRepoUrl(e.target.value)}
            />
            <button type="submit" className="hero-btn hero-btn-accent" disabled={addingRepo}>
              {addingRepo ? "Adicionando…" : "Adicionar"}
            </button>
          </form>
        )}
        {addRepoError && (
          <div className="hero-error" style={{ marginBottom: "1rem" }}>
            {addRepoError}
          </div>
        )}
        {newRepoToken && (
          <div className="hero-panel-sm" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <p className="hero-caption" style={{ marginTop: 0 }}>
              token do novo repositório — copie agora
            </p>
            <pre className="hero-code" style={{ marginBottom: "0.5rem" }}>{newRepoToken}</pre>
            <button type="button" className="hero-btn hero-btn-outline" onClick={() => setNewRepoToken(null)}>
              Entendi
            </button>
          </div>
        )}

        {repos.length === 0 ? (
          <p className="hero-caption">Nenhum repositório ainda — adicione um acima para começar a escanear.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.65rem" }}>
            {repos.map((r) => (
              <button
                key={r.repoId}
                type="button"
                onClick={() => selectRepo(r.repoId)}
                className={`ch-repo-card${r.repoId === selectedRepoId ? " is-selected" : ""}`}
              >
                <div className="ch-repo-card-top">
                  <span>
                    <strong style={{ fontSize: "1rem" }}>{r.name}</strong>
                    {r.repoUrl ? (
                      <span className="hero-caption" style={{ display: "block", marginTop: "0.25rem" }}>
                        {r.repoUrl.replace(/^https?:\/\//, "")}
                      </span>
                    ) : null}
                  </span>
                  <RatingBadges p={r} />
                </div>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <span className="hero-caption">{r.openIssues} issues</span>
                  <span className="hero-caption">{Math.round(r.debtMinutes / 60)}h débito</span>
                  <GatePill status={r.qualityGateStatus} />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {!selectedRepo ? (
        <section className="hero-panel" style={{ padding: "1.75rem", marginTop: "1.5rem" }}>
          <p style={{ margin: 0 }}>Adicione um repositório acima para configurar o plugin, a GitHub Action e o MCP.</p>
        </section>
      ) : (
        <>
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
          <p className="hero-caption" style={{ margin: "-1.25rem 0 1rem" }}>
            configurando: <strong>{selectedRepo.name}</strong>
          </p>

          {tab === "overview" && (
            <section className="hero-panel" style={{ padding: "1.5rem" }}>
              <div className="ch-section-title">
                <h2>Saúde do repositório</h2>
                {selectedRepo.repoUrl ? (
                  <a href={selectedRepo.repoUrl} target="_blank" rel="noreferrer" className="hero-link">
                    Abrir no GitHub
                  </a>
                ) : null}
              </div>

              <div className="ch-metric-grid">
                <div className="ch-metric-card">
                  <h3>Ratings</h3>
                  <div className="ch-rings-row">
                    <RatingRing
                      label="Segurança"
                      rating={selectedRepo.securityRating}
                      active={drillOpen === "security"}
                      onClick={() => setDrillOpen((prev) => (prev === "security" ? null : "security"))}
                    />
                    <RatingRing
                      label="Manutenib."
                      rating={selectedRepo.maintainabilityRating}
                      active={drillOpen === "maintainability"}
                      onClick={() => setDrillOpen((prev) => (prev === "maintainability" ? null : "maintainability"))}
                    />
                  </div>
                  <div style={{ marginTop: "0.85rem", textAlign: "center" }}>
                    <GatePill status={selectedRepo.qualityGateStatus} />
                  </div>
                  <p className="hero-caption" style={{ textAlign: "center", marginTop: "0.6rem", marginBottom: 0 }}>
                    clique num anel para ver o detalhe
                  </p>
                </div>
                <div className="ch-metric-card">
                  <h3>Débito técnico</h3>
                  <DebtMeter debtMinutes={selectedRepo.debtMinutes} openIssues={selectedRepo.openIssues} />
                </div>
                <div className="ch-metric-card">
                  <h3>Severidade dos apontamentos</h3>
                  {issuesLoading ? (
                    <p className="hero-caption">Carregando…</p>
                  ) : (
                    <SeverityBars
                      counts={countByField(issues as unknown as Array<Record<string, unknown>>, "severity")}
                      totalHint={issues.length || selectedRepo.openIssues}
                    />
                  )}
                </div>
                <div className="ch-metric-card">
                  <h3>Tipos de issue</h3>
                  {issuesLoading ? (
                    <p className="hero-caption">Carregando…</p>
                  ) : (
                    <VerticalBars
                      data={Object.entries(
                        countByField(issues as unknown as Array<Record<string, unknown>>, "issueType"),
                      ).map(([label, value]) => ({
                        label: label === "undefined" || label === "—" ? "OUTRO" : label,
                        value,
                        color:
                          label === "VULNERABILITY"
                            ? "#e8121f"
                            : label === "BUG"
                              ? "#ea580c"
                              : label === "SECURITY_HOTSPOT"
                                ? "#ca8a04"
                                : "#64748b",
                      }))}
                    />
                  )}
                </div>
              </div>

              {drillOpen && (
                <div className="ch-drill-panel">
                  {(() => {
                    const kind = drillOpen;
                    const relevantType = kind === "security" ? "VULNERABILITY" : "CODE_SMELL";
                    const relevant = issues.filter((i) => (i.issueType ?? "CODE_SMELL") === relevantType);
                    const bySev: Record<string, number> = {};
                    for (const i of relevant) bySev[i.severity] = (bySev[i.severity] ?? 0) + 1;
                    const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
                    const present = order.filter((s) => bySev[s]);
                    return (
                      <>
                        <p className="hero-caption" style={{ margin: "0 0 0.6rem" }}>
                          {kind === "security" ? "Vulnerabilidades" : "Code smells"} abertos por severidade — clique para
                          ver a lista de apontamentos.
                        </p>
                        {present.length === 0 ? (
                          <p className="hero-caption" style={{ margin: 0 }}>
                            Nenhum apontamento de {kind === "security" ? "segurança" : "manutenibilidade"} em aberto.
                          </p>
                        ) : (
                          present.map((sev) => (
                            <button
                              key={sev}
                              type="button"
                              className="ch-drill-chip"
                              onClick={() => {
                                setIssueFilter({
                                  label: `${kind === "security" ? "Segurança" : "Manutenibilidade"} · ${sev}`,
                                  severity: sev,
                                  issueType: relevantType,
                                });
                                document.getElementById("findings-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
                              }}
                            >
                              {sev} <span style={{ opacity: 0.7 }}>({bySev[sev]})</span>
                            </button>
                          ))
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              <h3 className="hero-display" style={{ fontSize: "1.1rem", margin: "1.5rem 0 0.5rem" }}>
                Checagem automática
              </h3>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
                além da GitHub Action, o CodeHero pode reescanear este repositório periodicamente por conta própria.
              </p>
              <div className="hero-panel-sm" style={{ padding: "1rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!selectedRepo.autoScan?.enabled}
                    disabled={autoScanBusy}
                    onChange={(e) => handleSaveAutoScan(e.target.checked, periodicityDraft)}
                  />
                  <span>Habilitar checagem automática</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="hero-caption">a cada</span>
                  <input
                    type="number"
                    className="hero-input"
                    style={{ width: "4.5rem" }}
                    min={1}
                    max={90}
                    value={periodicityDraft}
                    disabled={autoScanBusy}
                    onChange={(e) => setPeriodicityDraft(Math.max(1, Math.min(90, Number(e.target.value) || 7)))}
                    onBlur={() => {
                      if (selectedRepo.autoScan?.enabled && periodicityDraft !== selectedRepo.autoScan.periodicityDays) {
                        void handleSaveAutoScan(true, periodicityDraft);
                      }
                    }}
                  />
                  <span className="hero-caption">dia(s) — padrão: semanal (7)</span>
                </label>
                <button
                  type="button"
                  className="hero-btn hero-btn-outline"
                  style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }}
                  disabled={runNowBusy || !selectedRepo.repoUrl}
                  onClick={handleRunAutoScanNow}
                >
                  {runNowBusy ? "Rodando…" : "Rodar agora"}
                </button>
                <span className="hero-caption">
                  {selectedRepo.autoScan?.lastRunAt
                    ? `última: ${new Date(selectedRepo.autoScan.lastRunAt).toLocaleString("pt-BR")}`
                    : "nunca rodou"}
                  {selectedRepo.autoScan?.enabled && selectedRepo.autoScan?.nextRunAt
                    ? ` · próxima: ${new Date(selectedRepo.autoScan.nextRunAt).toLocaleString("pt-BR")}`
                    : ""}
                </span>
              </div>
              {autoScanError && (
                <div className="hero-error" style={{ marginTop: "0.75rem" }}>
                  {autoScanError}
                </div>
              )}

              <h3 id="findings-list" className="hero-display" style={{ fontSize: "1.1rem", margin: "1.75rem 0 0.5rem" }}>
                Apontamentos (esteira / ingestão)
              </h3>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
                Cada finding tem ficha com risco, motivo, exemplo e como corrigir — clique para abrir e dar feedback.
              </p>
              {issueFilter && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <button type="button" className="ch-drill-chip" style={{ borderColor: "var(--accent)" }} onClick={() => setIssueFilter(null)}>
                    filtro: {issueFilter.label} ✕
                  </button>
                </div>
              )}
              {feedbackError && (
                <div className="hero-error" style={{ marginBottom: "0.75rem" }}>
                  {feedbackError}
                </div>
              )}
              {issuesLoading ? (
                <p className="hero-caption">Carregando apontamentos…</p>
              ) : issues.length === 0 ? (
                <p className="hero-caption">
                  Nenhum apontamento aberto ainda. Rode a GitHub Action ou o scan no IDE e envie o relatório.
                </p>
              ) : (
                <div className="hero-ficha-list">
                  {issues
                    .filter((issue) => {
                      if (!issueFilter) return true;
                      if (issueFilter.severity && issue.severity !== issueFilter.severity) return false;
                      if (issueFilter.issueType && (issue.issueType ?? "CODE_SMELL") !== issueFilter.issueType) return false;
                      return true;
                    })
                    .map((issue) => {
                    const open = openIssueFp === issue.fingerprint;
                    const computed = buildFindingFicha({
                      ruleId: issue.ruleId,
                      message: issue.message,
                      severity: issue.severity,
                      issueType: issue.issueType,
                      sddTemplateId: issue.sddTemplateId,
                      remediationEffortMin: issue.remediationEffortMin,
                      file: issue.file,
                      line: issue.line,
                      snippet: issue.snippet,
                    });
                    // Ficha persistida no issue tem prioridade — cobre regras
                    // de dress code dinâmicas, ausentes do catálogo estático.
                    const ficha = {
                      ...computed,
                      risk: issue.risk ?? computed.risk,
                      reason: issue.reason ?? computed.reason,
                      howToFix: issue.howToFix ?? computed.howToFix,
                      strategy: issue.strategy ?? computed.strategy,
                      constraints: issue.constraints?.length ? issue.constraints : computed.constraints,
                      referenceExample: issue.referenceExample ?? computed.referenceExample,
                      cwe: issue.cwe?.length ? issue.cwe : computed.cwe,
                    };
                    const lastVerdict = issue.feedback?.[issue.feedback.length - 1]?.verdict ?? null;
                    return (
                      <div key={issue.fingerprint}>
                        <button
                          type="button"
                          className={`hero-panel-sm hero-finding-row${open ? " is-open" : ""}`}
                          style={{
                            width: "100%",
                            padding: "0.75rem 1rem",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            flexWrap: "wrap",
                            textAlign: "left",
                            border: "2px solid var(--line)",
                            background: "var(--paper)",
                            font: "inherit",
                            color: "inherit",
                          }}
                          onClick={() => setOpenIssueFp(open ? null : issue.fingerprint)}
                        >
                          <span>
                            <span className="hero-badge" style={{ marginRight: "0.5rem" }}>
                              {issue.severity}
                            </span>
                            <strong>{issue.ruleId}</strong>
                            <span className="hero-caption" style={{ marginLeft: "0.5rem" }}>
                              {issue.file}:{issue.line ?? "?"}
                            </span>
                            {lastVerdict && (
                              <span className="hero-caption" style={{ marginLeft: "0.5rem" }}>
                                · feedback: {lastVerdict === "false_positive" ? "falso positivo" : lastVerdict === "confirmed" ? "confirmado" : lastVerdict}
                              </span>
                            )}
                          </span>
                          <span className="hero-caption">{open ? "fechar ficha" : "ver ficha"}</span>
                        </button>
                        {open ? (
                          <>
                            <FindingFichaCard
                              ficha={{
                                ...ficha,
                                file: issue.file,
                                line: issue.line,
                                snippet: issue.snippet,
                              }}
                            />
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0 0.25rem 0.75rem" }}>
                              <span className="hero-caption">este apontamento é:</span>
                              <button
                                type="button"
                                className="hero-btn hero-btn-outline"
                                style={{ padding: "0.3rem 0.75rem", fontSize: "0.78rem" }}
                                disabled={feedbackBusyFp === issue.fingerprint}
                                onClick={() => handleIssueFeedback(issue, "confirmed")}
                              >
                                ✓ Confirmado (verdadeiro positivo)
                              </button>
                              <button
                                type="button"
                                className="hero-btn hero-btn-outline"
                                style={{ padding: "0.3rem 0.75rem", fontSize: "0.78rem" }}
                                disabled={feedbackBusyFp === issue.fingerprint}
                                onClick={() => handleIssueFeedback(issue, "false_positive")}
                              >
                                ✕ Falso positivo
                              </button>
                              <span className="hero-caption">alimenta o motor determinístico (hero-ruleforge)</span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {tab === "vscode" && (
            <section className="hero-panel" style={{ padding: "1.75rem" }}>
              <h2 className="hero-display" style={{ fontSize: "1.4rem", margin: "0 0 0.35rem" }}>
                Plugin VS Code / Cursor
              </h2>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
                Scan local com regras determinísticas · gráficos de compliance · Problems no editor
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
                    Abra a pasta deste repositório no VS Code/Cursor → ícone <strong>CodeHero</strong> na barra
                    lateral → <strong>Rodar scan no workspace</strong>. Veja o painel Avaliação, o Problems, e o
                    dashboard de compliance (ícone de gráfico).
                  </p>
                </div>
              </div>

              <div className="hero-step" style={{ marginBottom: 0 }}>
                <span className="hero-step-num">3</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 0.6rem" }}>
                    Cole no <code>.vscode/settings.json</code> deste repositório para ligar ao portal:
                  </p>
                  <div className="hero-copyrow">
                    <pre className="hero-code">{vscodeSettings}</pre>
                    <CopyButton text={vscodeSettings} />
                  </div>
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
                vincule este repositório em 1 clique · quality gate bloqueia o merge
              </p>

              {ghaBanner && (
                <div className={ghaBanner.kind === "ok" ? "hero-success" : "hero-error"} style={{ marginBottom: "1.25rem" }} role="status">
                  {ghaBanner.text}
                </div>
              )}

              {selectedRepo.githubActionRepo && (
                <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
                  Já instalada em <strong>{selectedRepo.githubActionRepo}</strong>.
                </p>
              )}

              <div className="hero-step">
                <span className="hero-step-num">1</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 0.6rem" }}>
                    {ownerRepo ? (
                      <>
                        Um clique autoriza o GitHub e configura a esteira em{" "}
                        <strong>
                          {ownerRepo.owner}/{ownerRepo.repo}
                        </strong>
                        . Você não precisa mexer em infraestrutura.
                      </>
                    ) : (
                      <>Este repositório está sem URL de GitHub válida.</>
                    )}
                  </p>
                  {ownerRepo ? (
                    <button type="button" className="hero-btn hero-btn-accent" disabled={installingGha} onClick={handleOneClickInstall}>
                      {installingGha ? "Redirecionando ao GitHub…" : "Configurar Action no GitHub (1 clique)"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="hero-step">
                <span className="hero-step-num">2</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 0.6rem" }}>Alternativa com GitHub CLI:</p>
                  {ghCliScript ? (
                    <div className="hero-copyrow">
                      <pre className="hero-code" style={{ maxHeight: 140 }}>{ghCliScript}</pre>
                      <CopyButton text={ghCliScript} label="Copiar script gh" />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="hero-step">
                <span className="hero-step-num">3</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 0.6rem" }}>Ou só o arquivo do workflow:</p>
                  {deepLinkUrl ? (
                    <a
                      className="hero-btn hero-btn-outline"
                      href={deepLinkUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-block", textDecoration: "none", marginBottom: "0.75rem" }}
                    >
                      Abrir “new file” no GitHub
                    </a>
                  ) : null}
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
                        <td><code>HERO_CORE_URL</code></td>
                        <td>variable</td>
                        <td style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <code style={{ fontSize: "0.78rem" }}>{HERO_CORE_URL}</code>
                          <CopyButton text={HERO_CORE_URL} label="Copiar" />
                        </td>
                      </tr>
                      <tr>
                        <td><code>HERO_TOKEN</code></td>
                        <td>secret</td>
                        <td style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <code style={{ fontSize: "0.78rem" }}>••••••••{selectedRepo.ingestToken.slice(-6)}</code>
                          <CopyButton text={selectedRepo.ingestToken} label="Copiar token" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="hero-step" style={{ marginBottom: 0 }}>
                <span className="hero-step-num">4</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 0.6rem" }}>YAML completo (<code>.github/workflows/codehero.yml</code>):</p>
                  <div className="hero-copyrow">
                    <pre className="hero-code" style={{ maxHeight: 260 }}>{workflowYaml}</pre>
                    <CopyButton text={workflowYaml} />
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === "mcp" && (
            <section className="hero-panel" style={{ padding: "1.75rem" }}>
              <h2 className="hero-display" style={{ fontSize: "1.4rem", margin: "0 0 0.35rem" }}>
                MCP — conectar seu agente de IA
              </h2>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
                get_issues · get_sdd_spec · run_scan · submit_fix_result · mesmo servidor, três clientes
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
                  <p style={{ margin: "0 0 0.75rem" }}>Escolha seu cliente e cole a config correspondente:</p>

                  <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.92rem" }}>Claude Desktop</h3>
                  <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.5rem" }}>arquivo <code>claude_desktop_config.json</code></p>
                  <div className="hero-copyrow">
                    <pre className="hero-code" style={{ maxHeight: 220 }}>{claudeMcpConfig}</pre>
                    <CopyButton text={claudeMcpConfig} />
                  </div>

                  <h3 style={{ margin: "1.25rem 0 0.4rem", fontSize: "0.92rem" }}>Cursor</h3>
                  <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                    arquivo <code>.cursor/mcp.json</code> na raiz do repositório
                  </p>
                  <div className="hero-copyrow">
                    <pre className="hero-code" style={{ maxHeight: 220 }}>{cursorMcpConfig}</pre>
                    <CopyButton text={cursorMcpConfig} />
                  </div>

                  <h3 style={{ margin: "1.25rem 0 0.4rem", fontSize: "0.92rem" }}>GitHub Copilot (VS Code, Agent Mode)</h3>
                  <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                    arquivo <code>.vscode/mcp.json</code> — habilite &quot;Agent mode&quot; no Copilot Chat
                  </p>
                  <div className="hero-copyrow">
                    <pre className="hero-code" style={{ maxHeight: 220 }}>{copilotMcpConfig}</pre>
                    <CopyButton text={copilotMcpConfig} />
                  </div>
                </div>
              </div>

              <hr className="hero-divider" />

              <div>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Token de acesso</h3>
                <p className="hero-caption" style={{ marginTop: 0 }}>
                  o mesmo token usado por CI, IDE e MCP para este repositório — rotacionar invalida todos de uma vez
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <code className="hero-badge">••••••••{selectedRepo.ingestToken.slice(-6)}</code>
                  <CopyButton text={selectedRepo.ingestToken} label="Copiar token completo" />
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
        </>
      )}
    </main>
  );
}

export default function ProjectSettingsPage() {
  return (
    <AuthGate>
      <AppShell>
        <Suspense fallback={<main className="hero-shell"><p className="hero-caption">Carregando projeto…</p></main>}>
          <ProjectSettings />
        </Suspense>
      </AppShell>
    </AuthGate>
  );
}
