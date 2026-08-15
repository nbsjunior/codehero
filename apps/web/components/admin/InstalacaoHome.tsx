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
  provisionProject,
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

function InstalacaoHome() {
  const { user } = useAuth();
  const cloudPreviewFlag = useFeatureFlag("cloud-preview-scan");
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
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

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
        hasIngestTokenFlash: !!ingestToken,
      }),
    [user, projects, ingestToken],
  );

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

      // Firestore security rules are NOT query filters: an unconstrained
      // collectionGroup("projects") scan across every org would be denied
      // outright (verified against the emulator's Requests log), since the
      // rule's isOrgMember(orgId) can't be proven for an unbounded result
      // set. Instead, find which orgs this user belongs to via a `members`
      // collectionGroup query filtered by uid (a pattern Firestore CAN
      // evaluate per-document), then read each org's own projects
      // subcollection — a plain, rule-legal single-collection read.
      const membershipSnap = await getDocs(
        query(collectionGroup(dbClient, "members"), where("uid", "==", user.uid)),
      );
      const orgIds = [
        ...new Set(
          membershipSnap.docs.map((d) => d.ref.parent.parent?.id).filter((id): id is string => Boolean(id)),
        ),
      ];

      const rows: ProjectRow[] = [];
      for (const orgId of orgIds) {
        const orgSnap = await getDoc(doc(dbClient, "orgs", orgId));
        const orgName = orgSnap.exists() ? (orgSnap.data().name as string | undefined) : undefined;
        const projectsSnap = await getDocs(collection(dbClient, "orgs", orgId, "projects"));
        for (const p of projectsSnap.docs) {
          const data = p.data() as Omit<ProjectRow, "id">;
          rows.push({
            id: `${orgId}/${p.id}`,
            orgId,
            projectId: p.id,
            name: data.name,
            orgName,
            repoCount: data.repoCount ?? 0,
            debtMinutes: data.debtMinutes ?? 0,
            maintainabilityRating: data.maintainabilityRating ?? "A",
            securityRating: data.securityRating ?? "A",
            qualityGateStatus: data.qualityGateStatus ?? "PASSED",
            openIssues: data.openIssues ?? 0,
          });
        }
      }
      setProjects(rows);
    } finally {
      setLoading(false);
    }
  }, [user]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const inviteOrg = sp.get("inviteOrg");
    const inviteId = sp.get("inviteId");
    const token = sp.get("token");
    if (!inviteOrg || !inviteId || !token || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        await acceptOrgInvite({ orgId: inviteOrg, inviteId, token });
        if (!cancelled) {
          setInviteMsg("Convite aceito — a org já aparece na lista.");
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
      setProvisionError(err instanceof Error ? err.message : "Não consegui criar o projeto. Nada foi salvo — revise os dados e tente de novo.");
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
        activate: false,
        requireApproval: true,
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
      setDressError(err instanceof Error ? err.message : "Não consegui interpretar o dress code. As regras ativas não mudaram.");
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
      setPreviewError(err instanceof Error ? err.message : "Não consegui gerar a prévia. O repositório pode ser privado ou grande demais.");
      console.error("previewRepoScan client error", err);
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Primeiros passos"
        title="Começar"
        description="Crie o projeto, conecte o CI ou o plugin e veja o primeiro resultado — em minutos"
        actions={
          <button type="button" className="hero-btn hero-btn-outline" onClick={() => setShowProvision((v) => !v)}>
            {showProvision ? "Fechar" : "Novo projeto"}
          </button>
        }
      />

      <OnboardingChecklist
        steps={onboardingSteps}
        onCreateProject={() => setShowProvision(true)}
      />

      {inviteMsg && <div className="hero-panel" style={{ padding: "0.85rem 1rem", marginBottom: "1rem" }}>{inviteMsg}</div>}
      {inviteError && <div className="hero-error">{inviteError}</div>}

      <details className="hero-panel" style={{ padding: "1.1rem 1.35rem", marginTop: 0, marginBottom: "1rem" }}>
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
          objetiva. A IA ajuda a redigir; o quality gate continua determinístico — sem “opinião” no
          merge.
        </p>
        <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <Link href="/docs/#aprendizado-continuo" className="hero-btn hero-btn-outline" style={{ textDecoration: "none" }}>
            Ver nas docs
          </Link>
          <a
            href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Esteira-de-aprendizado-de-regras.md"
            target="_blank"
            rel="noreferrer"
            className="hero-link"
          >
            Wiki (markdown)
          </a>
        </p>
      </details>

      {/* Como usar — fluxo simples */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: 0 }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Como usar (3 passos)
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          Plugin no editor para scan local · portal só para dress code e prévia na nuvem
        </p>

        <ol className="howto-steps">
          <li>
            <strong>Instale o plugin</strong>
            <p>
              Baixe o VSIX → no VS Code/Cursor: Extensions → ⋯ → <em>Install from VSIX</em>. Abra a pasta do projeto →
              ícone CodeHero na barra lateral → <em>Rodar scan</em>.
            </p>
            <a className="hero-btn hero-btn-accent" href={PLUGIN_HREF} download style={{ display: "inline-block", textDecoration: "none", marginTop: "0.5rem" }}>
              Baixar plugin VS Code
            </a>
          </li>
          <li>
            <strong>Escreva o dress code (opcional)</strong>
            <p>Em português, abaixo. A IA propõe regras; o scanner determinístico aplica no CI e no plugin.</p>
          </li>
          <li>
            <strong>Prévia na nuvem (opcional)</strong>
            <p>Cole um GitHub público para ver o relatório sem instalar nada no CI.</p>
          </li>
        </ol>

        <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "2px solid var(--line)" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Prévia na Cloud</h3>
          {!cloudPreviewFlag.loading && !cloudPreviewFlag.enabled ? (
            <p className="hero-caption" style={{ margin: 0 }}>
              Prévia na nuvem temporariamente indisponível. Use a GitHub Action ou o plugin enquanto isso.
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
                <button type="submit" className="hero-btn hero-btn-accent" style={{ marginTop: "0.75rem" }} disabled={previewBusy}>
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
        </div>

        {preview && (
          <div style={{ marginTop: "1.25rem" }}>
            <p className="hero-caption" style={{ marginBottom: "0.5rem" }}>
              {preview.repo} · {preview.findingCount} apontamento(s) · overlays: {preview.overlayRuleCount}
              {typeof preview.filesScanned === "number" ? ` · ${preview.filesScanned} arquivo(s) analisado(s)` : ""}
            </p>
            {preview.truncated && (
              <p className="hero-caption" style={{ marginBottom: "0.5rem", color: "var(--rating-c)" }}>
                ⚠ repositório grande — cobertura parcial (limite de arquivos por prévia atingido). Para cobertura
                completa, configure a GitHub Action no repositório (roda direto no CI, sem esse limite).
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
              subtitle="Lista enxuta — clique para abrir a ficha com risco, motivo e como corrigir. ← → navega."
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

      {/* Dress code */}
      <section className="hero-panel" style={{ padding: "1.5rem", marginTop: "1.5rem" }}>
        <h2 className="hero-display" style={{ fontSize: "1.5rem", margin: "0 0 0.35rem" }}>
          Dress code em linguagem natural
        </h2>
        <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Escreva a política · Dress Code Tools interpreta · vira regras determinísticas · por repo ou para todos
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
              {dressBusy ? "Interpretando com Dress Code Tools…" : "Salvar e ativar"}
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
          Nenhum projeto ainda. Clique em <strong>Novo projeto</strong> para começar — um clique cria org + projeto na plataforma.
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
                    <span className="hero-badge" title="qualidade consolidada destes repositórios">
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
                      <Link href={`/admin/?org=${encodeURIComponent(p.orgId)}&id=${encodeURIComponent(p.projectId)}#workspace`} className="hero-btn hero-btn-outline" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", textDecoration: "none", display: "inline-block" }}>
                        Configurar
                      </Link>
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
