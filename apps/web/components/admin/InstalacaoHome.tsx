"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import FindingFichaCard from "@/components/FindingFichaCard";
import FindingsBrowser, { type FindingsBrowserItem } from "@/components/FindingsBrowser";
import { PageHeader } from "@/components/AdminUi";
import { dbClient } from "@/lib/firebaseDb";
import {
  adminListAllProjects,
  checkPlatformAdmin,
  previewRepoScan,
  submitDressCode,
  type AdminProjectRow,
  type DressCodeRule,
  type PreviewRepoScanResult,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useFeatureFlag } from "@/lib/useFeatureFlag";
import OnboardingChecklist, { buildOnboardingSteps } from "@/components/admin/OnboardingChecklist";
import { acceptOrgInvite } from "@/lib/api";

interface ProjectRow {
  id: string;
  name: string;
  orgId?: string;
  projectId?: string;
  orgName?: string;
  repoCount: number;
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

export interface InstalacaoHomeProps {
  /** Abre o wizard único de criação (org → projeto → repos → tokens). */
  onNewWorkspace: () => void;
  /** Abre o workspace de um projeto (config por repositório). */
  onOpenWorkspace: (orgId: string, projectId: string, repoId?: string | null) => void;
}

function InstalacaoHome({ onNewWorkspace, onOpenWorkspace }: InstalacaoHomeProps) {
  const { user } = useAuth();
  const cloudPreviewFlag = useFeatureFlag("cloud-preview-scan");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [dressText, setDressText] = useState("");
  const [dressScope, setDressScope] = useState<"global" | "project">("project");
  const [dressTarget, setDressTarget] = useState("");
  const [dressBusy, setDressBusy] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [dressResult, setDressResult] = useState<{ summary: string; rules: DressCodeRule[] } | null>(null);

  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRepoScanResult | null>(null);

  const firstWorkspace = useMemo(() => {
    const p = projects.find((x) => x.orgId && x.projectId);
    return p?.orgId && p.projectId ? { orgId: p.orgId, projectId: p.projectId } : null;
  }, [projects]);

  const previewFindings: FindingsBrowserItem[] = useMemo(
    () =>
      (preview?.topFindings ?? []).map((f, i) => ({
        id: `${f.ruleId}-${f.file}-${f.line}-${i}`,
        ruleId: f.ruleId,
        ruleName: f.ruleName ?? f.ruleId,
        severity: f.severity,
        message: f.message,
        file: f.file,
        line: f.line,
        snippet: f.snippet,
        sddTemplateId: f.sddTemplateId,
        risk: f.ficha?.risk,
        reason: f.ficha?.reason,
        howToFix: f.ficha?.howToFix,
        strategy: f.ficha?.strategy,
        constraints: f.ficha?.constraints,
        referenceExample: f.ficha?.referenceExample,
        cwe: f.ficha?.cwe,
        remediationEffortMin: f.ficha?.effortMin,
      })),
    [preview],
  );

  const onboardingSteps = useMemo(
    () =>
      buildOnboardingSteps({
        user,
        projectCount: projects.length,
        repoCount: projects.reduce((n, p) => n + (p.repoCount || 0), 0),
        openIssues: projects.reduce((n, p) => n + (p.openIssues || 0), 0),
        hasWorkspace: !!firstWorkspace,
      }),
    [user, projects, firstWorkspace],
  );

  const loadProjects = useCallback(async (admin: boolean) => {
    setLoading(true);
    try {
      if (admin) {
        const { projects: rows } = await adminListAllProjects();
        setProjects(
          rows.map((p: AdminProjectRow) => ({
            id: `${p.orgId}/${p.projectId}`,
            name: p.name,
            orgId: p.orgId,
            projectId: p.projectId,
            orgName: p.orgName,
            repoCount: p.repoCount,
            debtMinutes: p.debtMinutes,
            maintainabilityRating: p.maintainabilityRating,
            securityRating: p.securityRating,
            qualityGateStatus: p.qualityGateStatus,
            openIssues: p.openIssues,
          })),
        );
        return;
      }
      if (!user) {
        setProjects([]);
        return;
      }
      const memSnap = await getDocs(query(collectionGroup(dbClient, "members"), where("uid", "==", user.uid)));
      const orgIds = [...new Set(memSnap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean))] as string[];
      const rows: ProjectRow[] = [];
      for (const orgId of orgIds) {
        const orgSnap = await getDoc(doc(dbClient, "orgs", orgId));
        const orgName = (orgSnap.data()?.name as string) ?? orgId;
        const projSnap = await getDocs(collection(dbClient, "orgs", orgId, "projects"));
        for (const pd of projSnap.docs) {
          const data = pd.data();
          rows.push({
            id: `${orgId}/${pd.id}`,
            name: (data.name as string) ?? pd.id,
            orgId,
            projectId: pd.id,
            orgName,
            repoCount: (data.repoCount as number) ?? 0,
            debtMinutes: (data.debtMinutes as number) ?? 0,
            maintainabilityRating: (data.maintainabilityRating as string) ?? "—",
            securityRating: (data.securityRating as string) ?? "—",
            qualityGateStatus: (data.qualityGateStatus as string) ?? "NONE",
            openIssues: (data.openIssues as number) ?? 0,
          });
        }
      }
      setProjects(rows);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const admin = await checkPlatformAdmin().catch(() => false);
      if (cancelled) return;
      setIsAdmin(admin);
      if (!admin) setDressScope("project");
      await loadProjects(admin);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const orgId = params.get("inviteOrg") ?? params.get("org");
    const inviteId = params.get("inviteId");
    const token = params.get("token") ?? params.get("invite");
    if (!orgId || !inviteId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        await acceptOrgInvite({ orgId, inviteId, token });
        if (!cancelled) {
          setInviteMsg("Convite aceito — a organização já aparece nos seus projetos.");
          setInviteError(null);
          await loadProjects(isAdmin);
        }
      } catch (err) {
        if (!cancelled) {
          setInviteError(err instanceof Error ? err.message : "Não foi possível aceitar o convite.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin, loadProjects]);

  useEffect(() => {
    if (dressScope === "project" && !dressTarget && projects[0]?.id) {
      setDressTarget(projects[0].id);
    }
  }, [dressScope, dressTarget, projects]);

  async function handleDressCode(e: FormEvent) {
    e.preventDefault();
    setDressError(null);
    setDressResult(null);
    setDressBusy(true);
    try {
      const [orgId, projectId] =
        dressScope === "project" && dressTarget.includes("/")
          ? dressTarget.split("/")
          : [undefined, undefined];
      const res = await submitDressCode({
        naturalLanguage: dressText.trim(),
        scope: dressScope,
        orgId,
        projectId,
      });
      setDressResult({
        summary:
          res.status === "pending_approval"
            ? `${res.summary} — ${res.ruleCount} proposta(s) na Esteira (aguardando aprovação).`
            : res.summary,
        rules: res.rules,
      });
      setDressText("");
    } catch (err) {
      setDressError(
        err instanceof Error
          ? err.message
          : "Não consegui interpretar o dress code. As regras ativas não mudaram.",
      );
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
      setPreviewError(
        err instanceof Error
          ? err.message
          : "Não consegui gerar a prévia. O repositório pode ser privado ou grande demais.",
      );
      console.error("previewRepoScan client error", err);
    } finally {
      setPreviewBusy(false);
    }
  }

  function openFirstOrList() {
    if (firstWorkspace) {
      onOpenWorkspace(firstWorkspace.orgId, firstWorkspace.projectId);
      return;
    }
    onNewWorkspace();
  }

  return (
    <div>
      <PageHeader
        eyebrow="Primeiros passos"
        title="Começar"
        description="Workspace = projeto. Cada repositório tem token, Action e plugin próprios — configure no workspace."
        actions={
          <button type="button" className="hero-btn hero-btn-accent" onClick={onNewWorkspace}>
            Novo workspace
          </button>
        }
      />

      <OnboardingChecklist
        steps={onboardingSteps}
        onCreateWorkspace={onNewWorkspace}
        onOpenWorkspace={firstWorkspace ? () => openFirstOrList() : undefined}
      />

      {inviteMsg && (
        <div className="hero-panel" style={{ padding: "0.85rem 1rem", marginBottom: "1rem" }}>
          {inviteMsg}
        </div>
      )}
      {inviteError && <div className="hero-error">{inviteError}</div>}

      {/* Fluxo principal — ordem alinhada ao modelo de dados */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: 0 }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Como usar
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          Organização → projeto (workspace) → repositórios → CI/plugin por repo
        </p>

        <ol className="howto-steps">
          <li>
            <strong>1. Crie o workspace</strong>
            <p>
              Defina a organização, o projeto e os repositórios GitHub. No fim você recebe o token de
              cada repo (uma vez) e abre o workspace.
            </p>
            <button type="button" className="hero-btn hero-btn-accent" style={{ marginTop: "0.5rem" }} onClick={onNewWorkspace}>
              Novo workspace
            </button>
          </li>
          <li>
            <strong>2. Configure no workspace (por repositório)</strong>
            <p>
              Action no CI, plugin VS Code e MCP usam o <em>token daquele repo</em> — não um token
              global. Selecione o repositório no workspace e copie o YAML / settings.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button type="button" className="hero-btn hero-btn-outline" onClick={openFirstOrList}>
                {firstWorkspace ? "Abrir workspace" : "Criar primeiro workspace"}
              </button>
              <a
                className="hero-btn hero-btn-outline"
                href={PLUGIN_HREF}
                download
                style={{ textDecoration: "none" }}
              >
                Baixar plugin VS Code
              </a>
            </div>
          </li>
          <li>
            <strong>3. Opcionais no portal</strong>
            <p>
              Dress code (política do <em>projeto</em>) e prévia na nuvem (repo público, sem CI). O
              quality gate continua no scanner determinístico.
            </p>
          </li>
        </ol>
      </section>

      <details className="hero-panel" style={{ padding: "1.1rem 1.35rem", marginTop: "1rem", marginBottom: "1rem" }}>
        <summary
          style={{
            cursor: "pointer",
            fontFamily: "var(--font-headline, inherit)",
            fontSize: "1.15rem",
            fontWeight: 600,
            listStyle: "none",
          }}
        >
          Como as regras evoluem (opcional)
        </summary>
        <p className="hero-caption" style={{ marginTop: "0.75rem", marginBottom: "0.85rem" }}>
          O portal observa padrões, propõe melhorias offline e só publica regra nova depois de prova
          objetiva. A IA ajuda a redigir; o quality gate continua determinístico.
        </p>
        <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <Link href="/docs/#aprendizado-continuo" className="hero-btn hero-btn-outline" style={{ textDecoration: "none" }}>
            Ver nas docs
          </Link>
        </p>
      </details>

      {/* Dress code — escopo = projeto, não repo */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Dress code (opcional)
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Política em português no <strong>projeto</strong>. Regras propostas aplicam a todos os
          repositórios daquele workspace (CI e plugin).
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
            placeholder={`Ex.: "Proibido console.log em produção. Não usar Math.random para tokens."`}
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
                {isAdmin && <option value="global">Plataforma (todos os projetos)</option>}
                <option value="project">Um projeto (workspace)</option>
              </select>
            </div>
            {dressScope === "project" && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="hero-label" htmlFor="dressTarget">
                  Projeto
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
                        {p.repoCount ? ` · ${p.repoCount} repo(s)` : ""}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <button type="submit" className="hero-btn hero-btn-accent" disabled={dressBusy}>
              {dressBusy ? "Interpretando…" : "Salvar e ativar"}
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

      {/* Prévia — secundária */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Prévia na nuvem (opcional)
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Repo GitHub público, sem instalar CI. Para gate de merge, use a Action no workspace do
          repositório.
        </p>
        {!cloudPreviewFlag.loading && !cloudPreviewFlag.enabled ? (
          <p className="hero-caption" style={{ margin: 0 }}>
            Prévia temporariamente indisponível. Use a GitHub Action ou o plugin no workspace.
          </p>
        ) : (
          <>
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
              <button type="submit" className="hero-btn hero-btn-outline" style={{ marginTop: "0.75rem" }} disabled={previewBusy}>
                {previewBusy ? "Analisando…" : "Ver prévia"}
              </button>
            </form>
            {previewError && (
              <div className="hero-error" style={{ marginTop: "0.75rem" }}>
                {previewError}
              </div>
            )}
          </>
        )}

        {preview && (
          <div style={{ marginTop: "1.25rem" }}>
            <p className="hero-caption" style={{ marginBottom: "0.5rem" }}>
              {preview.repo} · {preview.findingCount} apontamento(s) · overlays: {preview.overlayRuleCount}
              {typeof preview.filesScanned === "number" ? ` · ${preview.filesScanned} arquivo(s)` : ""}
            </p>
            {preview.truncated && (
              <p className="hero-caption" style={{ marginBottom: "0.5rem", color: "var(--rating-c)" }}>
                Repositório grande — cobertura parcial. Para cobertura completa, configure a Action no
                workspace desse repositório.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {Object.entries(preview.bySeverity).map(([sev, n]) => (
                <span key={sev} className="hero-badge">
                  {sev}: {n}
                </span>
              ))}
            </div>
            <FindingsBrowser
              title="Apontamentos da prévia"
              subtitle="Clique para abrir a ficha. ← → navega."
              findings={previewFindings}
              emptyMessage="Nenhum apontamento nesta prévia."
            />
            {preview.recommendations && preview.recommendations.length > 0 ? (
              <div style={{ marginTop: "1.25rem" }}>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Fichas por regra</h3>
                <div className="hero-ficha-list">
                  {preview.recommendations.map((r) => (
                    <FindingFichaCard
                      key={r.ruleId}
                      ficha={{
                        ruleId: r.ruleId,
                        ruleName: `${r.ruleName} (${r.count}×)`,
                        severity: r.severity,
                        risk: r.risk,
                        reason: r.reason,
                        howToFix: r.guidance,
                        strategy: r.strategy,
                        constraints: r.constraints,
                        referenceExample: r.referenceExample,
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <hr className="hero-divider" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.35rem", margin: 0 }}>
          Seus workspaces
        </h2>
        <button type="button" className="hero-btn hero-btn-outline" onClick={onNewWorkspace}>
          Novo workspace
        </button>
      </div>

      {loading && <p className="hero-caption">Carregando…</p>}

      {!loading && projects.length === 0 && (
        <p style={{ color: "var(--muted)", maxWidth: 520 }}>
          Nenhum workspace ainda. Crie um para associar repositórios e configurar Action/plugin por
          repo.
        </p>
      )}

      {projects.length > 0 && (
        <div className="hero-panel" style={{ overflowX: "auto" }}>
          <table className="hero-table">
            <thead>
              <tr>
                <th>Projeto</th>
                {isAdmin && <th>Org</th>}
                <th>Repos</th>
                <th>Gate</th>
                <th>Segurança</th>
                <th>Manutenib.</th>
                <th>Débito</th>
                <th>Issues</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                  {isAdmin && <td>{p.orgName}</td>}
                  <td>
                    <span className="hero-badge" title="Cada repo tem token e Action próprios">
                      {p.repoCount} repo{p.repoCount === 1 ? "" : "s"}
                    </span>
                  </td>
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
                  <td>
                    {p.orgId && p.projectId ? (
                      <button
                        type="button"
                        className="hero-btn hero-btn-outline"
                        style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                        onClick={() => onOpenWorkspace(p.orgId!, p.projectId!)}
                      >
                        Abrir workspace
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default InstalacaoHome;
