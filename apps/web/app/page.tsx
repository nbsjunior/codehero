"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { signOut } from "firebase/auth";
import { collectionGroup, getDocs, query } from "firebase/firestore";
import AuthGate from "@/components/AuthGate";
import { auth, dbClient } from "@/lib/firebase";
import {
  adminListAllProjects,
  checkPlatformAdmin,
  provisionProject,
  type AdminProjectRow,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

interface ProjectRow {
  id: string;
  name: string;
  orgName?: string;
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

  const loadProjects = useCallback(async (admin: boolean) => {
    setLoading(true);
    try {
      if (admin) {
        const { projects: rows } = await adminListAllProjects();
        setProjects(
          rows.map((p: AdminProjectRow) => ({
            id: `${p.orgId}/${p.projectId}`,
            name: p.name,
            orgName: p.orgName,
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
          return {
            id: d.id,
            name: data.name,
            debtMinutes: data.debtMinutes ?? 0,
            maintainabilityRating: data.maintainabilityRating ?? "A",
            securityRating: data.securityRating ?? "A",
            qualityGateStatus: data.qualityGateStatus ?? "PASSED",
            openIssues: data.openIssues ?? 0,
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
            painel do herói{isAdmin ? " · admin" : ""}
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

      {showProvision && (
        <form className="hero-panel" style={{ padding: "1.5rem", marginTop: "1.75rem" }} onSubmit={handleProvision}>
          <h2 className="hero-display" style={{ fontSize: "1.6rem", margin: "0 0 1rem" }}>
            Provisionar projeto
          </h2>
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <div>
              <label className="hero-label" htmlFor="orgName">
                Organização
              </label>
              <input
                id="orgName"
                className="hero-input"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Corp"
              />
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
          Nenhum projeto ainda. Clique em <strong>Novo projeto</strong> para chamar{" "}
          <code>provisionProject</code> e criar sua organização no Firebase.
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
