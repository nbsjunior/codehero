"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { signOut } from "firebase/auth";
import { collectionGroup, getDocs, query } from "firebase/firestore";
import AuthGate from "@/components/AuthGate";
import { auth, dbClient } from "@/lib/firebase";
import {
  adminListAllProjects,
  checkPlatformAdmin,
  previewRepoScan,
  provisionProject,
  submitDressCode,
  type AdminProjectRow,
  type DressCodeRule,
  type PreviewRepoScanResult,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

interface ProjectRow {
  id: string;
  name: string;
  orgId?: string;
  projectId?: string;
  orgName?: string;
  repoUrl?: string | null;
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

const PLUGIN_HREF = "/downloads/codehero-vscode.vsix";

function DashboardHome() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [ingestToken, setIngestToken] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);

  // Dress code
  const [dressText, setDressText] = useState("");
  const [dressScope, setDressScope] = useState<"global" | "project">("global");
  const [dressTarget, setDressTarget] = useState(""); // orgId/projectId
  const [dressBusy, setDressBusy] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [dressResult, setDressResult] = useState<{ summary: string; rules: DressCodeRule[] } | null>(null);

  // One-click preview
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRepoScanResult | null>(null);

  const loadProjects = useCallback(async (admin: boolean) => {
    setLoading(true);
    try {
      if (admin) {
        const { projects: rows } = await adminListAllProjects();
        setProjects(
          rows.map((p: AdminProjectRow) => ({
            id: `${p.orgId}/${p.projectId}`,
            orgId: p.orgId,
            projectId: p.projectId,
            name: p.name,
            orgName: p.orgName,
            repoUrl: p.repoUrl,
            debtMinutes: p.debtMinutes,
            maintainabilityRating: p.maintainabilityRating,
            securityRating: p.securityRating,
            qualityGateStatus: p.qualityGateStatus,
            openIssues: p.openIssues,
          })),
        );
        return;
      }

      const snap = await getDocs(query(collectionGroup(dbClient, "projects")));
      setProjects(
        snap.docs.map((d) => {
          const data = d.data() as Omit<ProjectRow, "id">;
          const orgId = d.ref.parent.parent?.id;
          return {
            id: orgId ? `${orgId}/${d.id}` : d.id,
            orgId,
            projectId: d.id,
            name: data.name,
            debtMinutes: data.debtMinutes ?? 0,
            maintainabilityRating: data.maintainabilityRating ?? "A",
            securityRating: data.securityRating ?? "A",
            qualityGateStatus: data.qualityGateStatus ?? "PASSED",
            openIssues: data.openIssues ?? 0,
            repoUrl: (data as { repoUrl?: string }).repoUrl ?? null,
          };
        }),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      let admin = false;
      try {
        admin = await checkPlatformAdmin();
      } catch {
        admin = false;
      }
      if (cancelled) return;
      setIsAdmin(admin);
      if (admin) setDressScope("global");
      else setDressScope("project");
      await loadProjects(admin);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadProjects]);

  async function handleProvision(e: FormEvent) {
    e.preventDefault();
    setProvisionError(null);
    setIngestToken(null);
    setProvisioning(true);
    try {
      const result = await provisionProject({
        orgName: orgName.trim(),
        projectName: projectName.trim(),
        repoUrl: repoUrl.trim() || undefined,
      });
      setIngestToken(result.ingestToken);
      setOrgName("");
      setProjectName("");
      setRepoUrl("");
      setShowProvision(false);
      await loadProjects(isAdmin);
    } catch (err) {
      setProvisionError(err instanceof Error ? err.message : "Falha ao provisionar o projeto.");
    } finally {
      setProvisioning(false);
    }
  }

  async function handleDressCode(e: FormEvent) {
    e.preventDefault();
    setDressError(null);
    setDressResult(null);
    setDressBusy(true);
    try {
      let orgId: string | undefined;
      let projectId: string | undefined;
      if (dressScope === "project") {
        const target = dressTarget || projects[0]?.id;
        if (!target?.includes("/")) throw new Error("Selecione um repositório.");
        [orgId, projectId] = target.split("/");
      }
      const res = await submitDressCode({
        naturalLanguage: dressText.trim(),
        scope: dressScope,
        orgId,
        projectId,
        activate: true,
      });
      setDressResult({ summary: res.summary, rules: res.rules });
      setDressText("");
    } catch (err) {
      setDressError(err instanceof Error ? err.message : "Falha ao interpretar o dress code.");
    } finally {
      setDressBusy(false);
    }
  }

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    setPreviewError(null);
    setPreview(null);
    setPreviewBusy(true);
    try {
      const target = dressTarget.includes("/") ? dressTarget : projects[0]?.id ?? "";
      const [orgId, projectId] = target.includes("/") ? target.split("/") : [undefined, undefined];
      const res = await previewRepoScan({
        repoUrl: previewUrl.trim(),
        orgId,
        projectId,
      });
      setPreview(res);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Falha na prévia do repositório.");
      console.error("previewRepoScan client error", err);
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <main className="hero-shell">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <span className="hero-burst" style={{ marginBottom: "0.75rem" }}>
            ⚡
          </span>
          <h1 className="hero-display" style={{ fontSize: "2.75rem", margin: "0.4rem 0 0.25rem" }}>
            CodeHero
          </h1>
          <p className="hero-caption" style={{ margin: 0 }}>
            {isAdmin ? "admin da plataforma · one-click" : "painel do herói · one-click"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <span className="hero-caption" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.displayName ?? user?.email}
          </span>
          <button type="button" className="hero-btn hero-btn-outline" onClick={() => setShowProvision((v) => !v)}>
            {showProvision ? "Fechar" : "Novo projeto"}
          </button>
          <button type="button" className="hero-btn" onClick={() => signOut(auth)}>
            Sair
          </button>
        </div>
      </header>

      {/* One-click tools */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: "1.75rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Uso em 1 clique
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          Plugin no editor · prévia no Firebase · sem configuração pesada
        </p>
        <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>1. Plugin VS Code / Cursor</h3>
            <p className="hero-caption" style={{ marginTop: 0 }}>
              Baixe o VSIX e instale: Extensions → … → Install from VSIX
            </p>
            <a className="hero-btn hero-btn-accent" href={PLUGIN_HREF} download style={{ display: "inline-block", textDecoration: "none" }}>
              Baixar plugin
            </a>
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>2. Prévia no runner Firebase</h3>
            <form onSubmit={handlePreview}>
              <label className="hero-label" htmlFor="previewUrl">
                Repo GitHub público
              </label>
              <input
                id="previewUrl"
                className="hero-input"
                required
                value={previewUrl}
                onChange={(e) => setPreviewUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
              />
              <button type="submit" className="hero-btn hero-btn-accent" style={{ marginTop: "0.75rem" }} disabled={previewBusy}>
                {previewBusy ? "Analisando…" : "Ver prévia"}
              </button>
            </form>
            {previewError && (
              <div className="hero-error" style={{ marginTop: "0.75rem" }}>
                {previewError}
              </div>
            )}
          </div>
        </div>

        {preview && (
          <div style={{ marginTop: "1.25rem" }}>
            <p className="hero-caption" style={{ marginBottom: "0.5rem" }}>
              {preview.repo} · {preview.findingCount} finding(s) · overlays: {preview.overlayRuleCount}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {Object.entries(preview.bySeverity).map(([sev, n]) => (
                <span key={sev} className="hero-badge">
                  {sev}: {n}
                </span>
              ))}
            </div>
            <div style={{ maxHeight: 280, overflow: "auto" }}>
              <table className="hero-table">
                <thead>
                  <tr>
                    <th>Sev</th>
                    <th>Regra</th>
                    <th>Arquivo</th>
                    <th>Trecho</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.topFindings.map((f, i) => (
                    <tr key={`${f.ruleId}-${f.file}-${f.line}-${i}`}>
                      <td>{f.severity}</td>
                      <td>{f.ruleId}</td>
                      <td>
                        {f.file}:{f.line}
                      </td>
                      <td>
                        <code style={{ fontSize: "0.75rem" }}>{f.snippet}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Dress code */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: "1.5rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Dress code em linguagem natural
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Escreva a política · Genkit interpreta · vira regras determinísticas (L0) · por repo ou para todos
        </p>
        <form onSubmit={handleDressCode}>
          <label className="hero-label" htmlFor="dressText">
            Política
          </label>
          <textarea
            id="dressText"
            className="hero-input"
            required
            rows={5}
            value={dressText}
            onChange={(e) => setDressText(e.target.value)}
            placeholder={`Ex.: "Proibido console.log em produção. Não usar Math.random para tokens. Sem curl | bash em scripts de setup."`}
            style={{ resize: "vertical", minHeight: 120 }}
          />
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem", alignItems: "flex-end" }}>
            <div>
              <label className="hero-label" htmlFor="dressScope">
                Escopo
              </label>
              <select
                id="dressScope"
                className="hero-input"
                value={dressScope}
                onChange={(e) => setDressScope(e.target.value as "global" | "project")}
                disabled={!isAdmin && dressScope === "global"}
              >
                {isAdmin && <option value="global">Todos os repositórios</option>}
                <option value="project">Um repositório</option>
              </select>
            </div>
            {dressScope === "project" && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="hero-label" htmlFor="dressTarget">
                  Repositório
                </label>
                <select
                  id="dressTarget"
                  className="hero-input"
                  value={dressTarget}
                  onChange={(e) => setDressTarget(e.target.value)}
                  required
                >
                  <option value="">Selecione…</option>
                  {projects
                    .filter((p) => p.orgId && p.projectId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.orgName ? `${p.orgName} / ` : ""}
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <button type="submit" className="hero-btn hero-btn-accent" disabled={dressBusy}>
              {dressBusy ? "Interpretando com Genkit…" : "Salvar e ativar"}
            </button>
          </div>
        </form>
        {dressError && (
          <div className="hero-error" style={{ marginTop: "1rem" }}>
            {dressError}
          </div>
        )}
        {dressResult && (
          <div style={{ marginTop: "1.25rem" }}>
            <p style={{ margin: "0 0 0.5rem", fontWeight: 700 }}>{dressResult.summary}</p>
            <p className="hero-caption">{dressResult.rules.length} regra(s) ativas no motor determinístico</p>
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
              {dressResult.rules.map((r) => (
                <li key={r.id} style={{ marginBottom: "0.35rem" }}>
                  <strong>{r.id}</strong> · {r.severity} · {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {showProvision && (
        <form className="hero-panel" style={{ padding: "1.5rem", marginTop: "1.5rem" }} onSubmit={handleProvision}>
          <h2 className="hero-display" style={{ fontSize: "1.6rem", margin: "0 0 1rem" }}>
            Provisionar projeto
          </h2>
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <div>
              <label className="hero-label" htmlFor="orgName">
                Organização
              </label>
              <input id="orgName" className="hero-input" required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Corp" />
            </div>
            <div>
              <label className="hero-label" htmlFor="projectName">
                Projeto
              </label>
              <input
                id="projectName"
                className="hero-input"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="api-core"
              />
            </div>
            <div>
              <label className="hero-label" htmlFor="repoUrl">
                Repo (opcional)
              </label>
              <input
                id="repoUrl"
                className="hero-input"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
              />
            </div>
          </div>
          {provisionError && (
            <div className="hero-error" style={{ marginTop: "1rem" }}>
              {provisionError}
            </div>
          )}
          <button type="submit" className="hero-btn hero-btn-accent" style={{ marginTop: "1.25rem" }} disabled={provisioning}>
            {provisioning ? "Provisionando…" : "Criar org + projeto"}
          </button>
        </form>
      )}

      {ingestToken && (
        <div className="hero-panel" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
          <p className="hero-caption" style={{ marginTop: 0 }}>
            ingest token — copie agora; não será mostrado de novo
          </p>
          <pre className="hero-code">{ingestToken}</pre>
          <button type="button" className="hero-btn hero-btn-outline" style={{ marginTop: "0.75rem" }} onClick={() => setIngestToken(null)}>
            Entendi
          </button>
        </div>
      )}

      <hr className="hero-divider" />

      {loading && <p className="hero-caption">Carregando projetos…</p>}

      {!loading && projects.length === 0 && (
        <p style={{ color: "var(--muted)", maxWidth: 480 }}>
          Nenhum projeto ainda. Clique em <strong>Novo projeto</strong> para começar — um clique cria org + projeto no Firebase.
        </p>
      )}

      {projects.length > 0 && (
        <div className="hero-panel" style={{ overflowX: "auto" }}>
          <table className="hero-table">
            <thead>
              <tr>
                <th>Projeto</th>
                {isAdmin && <th>Org</th>}
                <th>Gate</th>
                <th>Segurança</th>
                <th>Manutenib.</th>
                <th>Débito</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                  {isAdmin && <td>{p.orgName}</td>}
                  <td>
                    <span
                      className="hero-badge"
                      style={{
                        background: p.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)",
                        color: "#fff",
                      }}
                    >
                      {p.qualityGateStatus}
                    </span>
                  </td>
                  <td>
                    <span className="hero-rating" style={{ background: ratingColor[p.securityRating] ?? "var(--muted)" }}>
                      {p.securityRating}
                    </span>
                  </td>
                  <td>
                    <span className="hero-rating" style={{ background: ratingColor[p.maintainabilityRating] ?? "var(--muted)" }}>
                      {p.maintainabilityRating}
                    </span>
                  </td>
                  <td>{Math.round((p.debtMinutes ?? 0) / 60)}h</td>
                  <td>{p.openIssues ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function Dashboard() {
  return (
    <AuthGate>
      <DashboardHome />
    </AuthGate>
  );
}
