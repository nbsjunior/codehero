"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import { adminListAllProjects, checkPlatformAdmin, type AdminProjectRow } from "@/lib/api";

const ratingColor: Record<string, string> = {
  A: "var(--rating-a)",
  B: "var(--rating-b)",
  C: "var(--rating-c)",
  D: "var(--rating-d)",
  E: "var(--rating-e)",
};

function AdminHome() {
  const [status, setStatus] = useState<"checking" | "denied" | "loading" | "ready" | "error">("checking");
  const [orgCount, setOrgCount] = useState(0);
  const [projects, setProjects] = useState<AdminProjectRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isAdmin = await checkPlatformAdmin();
        if (cancelled) return;
        if (!isAdmin) {
          setStatus("denied");
          return;
        }
        setStatus("loading");
        const { orgCount: oc, projects: rows } = await adminListAllProjects();
        if (cancelled) return;
        setOrgCount(oc);
        setProjects(rows);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Falha ao carregar dados de admin.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking" || status === "loading") {
    return (
      <main className="hero-shell">
        <p className="hero-caption">Carregando painel de admin…</p>
      </main>
    );
  }

  if (status === "denied") {
    return (
      <main className="hero-shell">
        <div className="hero-panel" style={{ padding: "2rem", textAlign: "center" }}>
          <span className="hero-burst" style={{ margin: "0 auto 1rem" }}>
            🚫
          </span>
          <h1 className="hero-display" style={{ fontSize: "1.8rem", margin: "0 0 0.5rem" }}>
            Acesso restrito
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Esta área é exclusiva de administradores da plataforma. Se você deveria ter acesso, peça para outro admin
            rodar <code>node scripts/seed-admin.mjs seu-email@dominio.com</code>.
          </p>
          <Link href="/" className="hero-link" style={{ display: "inline-block", marginTop: "1rem" }}>
            ← Voltar ao dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="hero-shell">
        <div className="hero-error">{errorMsg}</div>
      </main>
    );
  }

  const totalDebtHours = Math.round(projects.reduce((sum, p) => sum + p.debtMinutes, 0) / 60);
  const totalOpenIssues = projects.reduce((sum, p) => sum + p.openIssues, 0);
  const failingGates = projects.filter((p) => p.qualityGateStatus !== "PASSED").length;

  return (
    <main className="hero-shell">
      <header>
        <h1 className="hero-display" style={{ fontSize: "2.25rem", margin: "0 0 0.25rem" }}>
          Painel do Admin
        </h1>
        <p className="hero-caption" style={{ margin: 0 }}>
          visão de toda a plataforma · {orgCount} organização(ões) · {projects.length} projeto(s)
        </p>
      </header>

      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", margin: "1.75rem 0" }}>
        <StatCard label="Organizações" value={orgCount} />
        <StatCard label="Projetos" value={projects.length} />
        <StatCard label="Débito total" value={`${totalDebtHours}h`} />
        <StatCard label="Issues abertas" value={totalOpenIssues} />
        <StatCard label="Gates falhando" value={failingGates} accent={failingGates > 0} />
      </div>

      {projects.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Nenhum projeto foi provisionado na plataforma ainda.</p>
      ) : (
        <div className="hero-panel" style={{ overflowX: "auto" }}>
          <table className="hero-table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Organização</th>
                <th>Gate</th>
                <th>Segurança</th>
                <th>Manutenib.</th>
                <th>Débito</th>
                <th>Issues</th>
                <th>Última análise</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={`${p.orgId}/${p.projectId}`}>
                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                  <td>{p.orgName}</td>
                  <td>
                    <span
                      className="hero-badge"
                      style={{ background: p.qualityGateStatus === "PASSED" ? "var(--rating-a)" : "var(--rating-e)", color: "#fff" }}
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
                  <td>{Math.round(p.debtMinutes / 60)}h</td>
                  <td>{p.openIssues}</td>
                  <td className="hero-caption">{p.lastAnalyzedAt ? new Date(p.lastAnalyzedAt).toLocaleDateString("pt-BR") : "—"}</td>
                  <td>
                    <Link
                      href={`/projects?org=${encodeURIComponent(p.orgId)}&id=${encodeURIComponent(p.projectId)}`}
                      className="hero-btn hero-btn-outline"
                      style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", textDecoration: "none", display: "inline-block" }}
                    >
                      Configurar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="hero-panel-sm" style={{ padding: "1.1rem" }}>
      <p className="hero-label" style={{ marginBottom: "0.4rem" }}>
        {label}
      </p>
      <p className="hero-display" style={{ fontSize: "1.8rem", margin: 0, color: accent ? "var(--accent)" : "var(--ink)" }}>
        {value}
      </p>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AppShell>
        <AdminHome />
      </AppShell>
    </AuthGate>
  );
}
