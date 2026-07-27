"use client";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import AdminCockpitShell, { type CockpitNavGroup } from "@/components/AdminCockpitShell";
import { Callout, DataSection, KpiCard, KpiGroup, PageHeader } from "@/components/AdminUi";
import ProjectWorkspace from "@/components/admin/ProjectWorkspace";
import WorkspaceWizard from "@/components/admin/WorkspaceWizard";
import InstalacaoHome from "@/components/admin/InstalacaoHome";
import UsersPanel from "@/components/admin/UsersPanel";
import RulesCatalog from "@/components/admin/RulesCatalog";
import FindingsBrowser, { type FindingsBrowserItem } from "@/components/FindingsBrowser";
import { dbClient } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";
import {
  adminGetPlatformSummary,
  adminListAllIssues,
  adminListAllProjects,
  checkPlatformAdmin,
  getOrgQuotasCallable,
  getPlatformOpsSettings,
  listDressCodes,
  listFeatureFlags,
  listRuleforgeRuns,
  repairIngestQueues,
  runDetailPurgeNow,
  runRuleforgeDailyNow,
  setFeatureFlag,
  setOrgQuotas,
  setPlatformOpsSettings,
  submitDressCode,
  type AdminIssueRow,
  type AdminIssuesResult,
  type AdminProjectRow,
  type AdminRepoFindingCount,
  type FeatureFlag,
  type IngestQueueCounts,
  type OrgQuotasView,
  type PlatformOpsConfig,
  type PlatformSummary,
  type RepoRow,
  type RuleforgeRun,
} from "@/lib/api";

const SHARED_GROUPS: CockpitNavGroup[] = [
  {
    id: "instalacao",
    label: "Instalação",
    items: [{ id: "instalacao", label: "Instalação" }],
  },
  {
    id: "visao",
    label: "Visão",
    items: [
      { id: "visao-geral", label: "Visão geral" },
      { id: "apontamentos", label: "Apontamentos" },
      { id: "relatorio", label: "Relatório" },
    ],
  },
  {
    id: "projetos",
    label: "Projetos",
    items: [
      { id: "todos-projetos", label: "Todos os projetos" },
      { id: "regras", label: "Regras do motor" },
      { id: "workspace", label: "Workspace" },
      { id: "novo-workspace", label: "Novo workspace" },
    ],
  },
  {
    id: "docs",
    label: "Docs",
    items: [{ id: "docs", label: "Documentação", href: "/docs/" }],
  },
  {
    id: "estimativa",
    label: "Estimativa de Build",
    items: [{ id: "estimativa", label: "Abrir estimativa", href: "https://produtech.web.app", external: true }],
  },
];

const ADMIN_ONLY_GROUPS: CockpitNavGroup[] = [
  {
    id: "plataforma",
    label: "Plataforma",
    items: [
      { id: "dress-code", label: "Dress code" },
      { id: "esteira", label: "Esteira" },
      { id: "feature-toggles", label: "Feature toggles" },
    ],
  },
  {
    id: "operacoes",
    label: "Operações",
    items: [
      { id: "escala", label: "Escala e filas" },
      { id: "cotas", label: "Cotas" },
    ],
  },
  {
    id: "usuarios",
    label: "Usuários",
    items: [{ id: "usuarios", label: "Todos os usuários" }],
  },
];

const TAB_IDS = new Set(
  [...SHARED_GROUPS, ...ADMIN_ONLY_GROUPS].flatMap((g) => g.items.filter((i) => !i.href).map((i) => i.id)),
);

const ratingColor: Record<string, string> = {
  A: "var(--rating-a)",
  B: "var(--rating-b)",
  C: "var(--rating-c)",
  D: "var(--rating-d)",
  E: "var(--rating-e)",
};
const severityColor: Record<string, string> = {
  BLOCKER: "var(--rating-e)",
  CRITICAL: "var(--rating-d)",
  MAJOR: "var(--rating-c)",
  MINOR: "var(--rating-b)",
  INFO: "var(--rating-a)",
};
const sourceLabel: Record<string, string> = {
  "github-action": "GitHub Action",
  "auto-scan": "Checagem automática",
  cli: "CLI",
};

function worseRating(a: string, b: string): string {
  const order = ["A", "B", "C", "D", "E"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function AdminPanelInner() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<"checking" | "denied" | "loading" | "ready" | "error">("checking");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [tab, setTab] = useState("instalacao");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [orgCount, setOrgCount] = useState(0);
  const [projects, setProjects] = useState<AdminProjectRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nextOrgCursor, setNextOrgCursor] = useState<string | null>(null);
  const [loadingMoreOrgs, setLoadingMoreOrgs] = useState(false);
  const [platformSummary, setPlatformSummary] = useState<PlatformSummary | null>(null);

  const [issues, setIssues] = useState<AdminIssuesResult | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [flagKey, setFlagKey] = useState("");
  const [flagDesc, setFlagDesc] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  const [ops, setOps] = useState<PlatformOpsConfig | null>(null);
  const [queue, setQueue] = useState<IngestQueueCounts | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsMsg, setOpsMsg] = useState<string | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState("90");
  const [intervalDraft, setIntervalDraft] = useState("7");
  const [stuckDraft, setStuckDraft] = useState("30");

  const [runs, setRuns] = useState<RuleforgeRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const [dressItems, setDressItems] = useState<Array<Record<string, unknown>>>([]);
  const [dressText, setDressText] = useState("");
  const [dressBusy, setDressBusy] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [dressMsg, setDressMsg] = useState<string | null>(null);

  const [quotaOrgId, setQuotaOrgId] = useState("");
  const [quotas, setQuotas] = useState<OrgQuotasView | null>(null);
  const [quotaBusy, setQuotaBusy] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [maxReposDraft, setMaxReposDraft] = useState("");
  const [maxBuildsDraft, setMaxBuildsDraft] = useState("");

  const wsOrg = searchParams.get("org") ?? "";
  const wsProject = searchParams.get("id") ?? "";
  const wsRepo = searchParams.get("repo");

  const orgs = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.orgId, p.orgName);
    return [...m.entries()].map(([orgId, orgName]) => ({ orgId, orgName }));
  }, [projects]);

  const groups = useMemo(() => {
    const shared = SHARED_GROUPS.map((g) => {
      if (isPlatformAdmin) return g;
      if (g.id === "visao") return { ...g, items: g.items.filter((i) => i.id !== "apontamentos" && i.id !== "relatorio") };
      if (g.id === "projetos") return { ...g, items: g.items.filter((i) => i.id !== "novo-workspace") };
      return g;
    });
    return isPlatformAdmin ? [...shared, ...ADMIN_ONLY_GROUPS] : shared;
  }, [isPlatformAdmin]);

  const navigateWorkspace = useCallback(
    (orgId: string, projectId: string, repoId?: string | null) => {
      const q = new URLSearchParams({ org: orgId, id: projectId });
      if (repoId) q.set("repo", repoId);
      router.replace(`/admin/?${q.toString()}#workspace`);
      setTab("workspace");
    },
    [router],
  );

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (id === "dashboard") {
        setTab("visao-geral");
        return;
      }
      if (TAB_IDS.has(id)) setTab(id);
      else if (!id) setTab("instalacao");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    if (wsOrg && wsProject && !window.location.hash) {
      setTab("workspace");
    }
  }, [wsOrg, wsProject]);

  function selectTab(id: string) {
    setTab(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  async function loadMemberProjects(uid: string): Promise<AdminProjectRow[]> {
    const membershipSnap = await getDocs(
      query(collectionGroup(dbClient, "members"), where("uid", "==", uid)),
    );
    const orgIds = [
      ...new Set(
        membershipSnap.docs.map((d) => d.ref.parent.parent?.id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const rows: AdminProjectRow[] = [];
    for (const orgId of orgIds) {
      const orgSnap = await getDoc(doc(dbClient, "orgs", orgId));
      const orgName = orgSnap.exists() ? ((orgSnap.data().name as string | undefined) ?? orgId) : orgId;
      const projectsSnap = await getDocs(collection(dbClient, "orgs", orgId, "projects"));
      for (const p of projectsSnap.docs) {
        const data = p.data();
        const reposSnap = await getDocs(collection(dbClient, "orgs", orgId, "projects", p.id, "repos"));
        rows.push({
          orgId,
          orgName,
          projectId: p.id,
          name: (data.name as string | undefined) ?? p.id,
          repoCount: reposSnap.size,
          debtMinutes: (data.debtMinutes as number | undefined) ?? 0,
          maintainabilityRating: (data.maintainabilityRating as string | undefined) ?? "A",
          securityRating: (data.securityRating as string | undefined) ?? "A",
          qualityGateStatus: (data.qualityGateStatus as string | undefined) ?? "PASSED",
          openIssues: (data.openIssues as number | undefined) ?? 0,
          lastAnalyzedAt: null,
          repos: reposSnap.docs.map((r) => {
            const rd = r.data();
            return {
              repoId: r.id,
              name: (rd.name as string | undefined) ?? r.id,
              repoUrl: (rd.repoUrl as string | null | undefined) ?? null,
              debtMinutes: (rd.debtMinutes as number | undefined) ?? 0,
              maintainabilityRating: (rd.maintainabilityRating as string | undefined) ?? "A",
              securityRating: (rd.securityRating as string | undefined) ?? "A",
              qualityGateStatus: (rd.qualityGateStatus as string | undefined) ?? "PASSED",
              openIssues: (rd.openIssues as number | undefined) ?? 0,
              lastAnalyzedAt: null,
            };
          }),
        });
      }
    }
    return rows;
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        let admin = false;
        try {
          admin = (await getDoc(doc(dbClient, "platformAdmins", user.uid))).exists();
        } catch {
          admin = await checkPlatformAdmin();
        }
        if (cancelled) return;
        setIsPlatformAdmin(admin);

        setStatus("loading");
        if (admin) {
          const [{ orgCount: oc, projects: rows, nextCursor }, summary] = await Promise.all([
            adminListAllProjects(),
            adminGetPlatformSummary().catch(() => null),
          ]);
          if (cancelled) return;
          setOrgCount(oc);
          setProjects(rows);
          setNextOrgCursor(nextCursor);
          setPlatformSummary(summary);
          if (rows[0]) setQuotaOrgId((prev) => prev || rows[0].orgId);
        } else {
          if (wsOrg && wsProject) {
            const member = await getDoc(doc(dbClient, "orgs", wsOrg, "members", user.uid));
            if (!member.exists()) {
              // still allow instalacao / own projects; workspace will gate itself
            }
          }
          const rows = await loadMemberProjects(user.uid);
          if (cancelled) return;
          setOrgCount(new Set(rows.map((r) => r.orgId)).size);
          setProjects(rows);
        }
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Falha ao carregar o painel.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, wsOrg, wsProject]);

  /**
   * adminListAllProjects is paginated by org (25/page) — a full unbounded
   * fan-out breaks down well before 20k repos. The KPI cards use
   * adminGetPlatformSummary (aggregation queries) instead of summing this
   * list, so they stay accurate regardless of how many pages are loaded.
   */
  async function loadMoreOrgs() {
    if (!nextOrgCursor || loadingMoreOrgs) return;
    setLoadingMoreOrgs(true);
    try {
      const { projects: rows, nextCursor } = await adminListAllProjects({ cursor: nextOrgCursor });
      setProjects((prev) => [...prev, ...rows]);
      setNextOrgCursor(nextCursor);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao carregar mais organizações.");
    } finally {
      setLoadingMoreOrgs(false);
    }
  }

  useEffect(() => {
    if (status !== "ready" || !isPlatformAdmin) return;
    let cancelled = false;
    adminListAllIssues()
      .then((res) => {
        if (!cancelled) setIssues(res);
      })
      .catch((err) => {
        if (!cancelled) setIssuesError(err instanceof Error ? err.message : "Falha nos apontamentos.");
      })
      .finally(() => {
        if (!cancelled) setIssuesLoading(false);
      });
    listFeatureFlags()
      .then(({ flags: f }) => {
        if (!cancelled) setFlags(f);
      })
      .catch(() => undefined);
    getPlatformOpsSettings()
      .then(({ config, queue: q }) => {
        if (cancelled) return;
        setOps(config);
        setQueue(q);
        setRetentionDraft(String(config.retentionDays));
        setIntervalDraft(String(config.purgeIntervalDays));
        setStuckDraft(String(config.queueStuckMinutes));
      })
      .catch((err) => {
        if (!cancelled) setOpsError(err instanceof Error ? err.message : "Falha nas ops.");
      });
    listRuleforgeRuns(14)
      .then(({ runs: r }) => {
        if (!cancelled) setRuns(r);
      })
      .catch((err) => {
        if (!cancelled) setRunsError(err instanceof Error ? err.message : "Falha na esteira.");
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    listDressCodes({ scope: "global" })
      .then(({ items }) => {
        if (!cancelled) setDressItems(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, isPlatformAdmin]);

  useEffect(() => {
    if (!quotaOrgId || !isPlatformAdmin || tab !== "cotas") return;
    let cancelled = false;
    setQuotaBusy(true);
    getOrgQuotasCallable({ orgId: quotaOrgId })
      .then((res) => {
        if (cancelled) return;
        setQuotas(res.quotas);
        setMaxReposDraft(String(res.quotas.maxRepos));
        setMaxBuildsDraft(String(res.quotas.maxBuildsPerMonth));
        setQuotaError(null);
      })
      .catch((err) => {
        if (!cancelled) setQuotaError(err instanceof Error ? err.message : "Falha ao carregar cotas.");
      })
      .finally(() => {
        if (!cancelled) setQuotaBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quotaOrgId, isPlatformAdmin, tab]);

  async function patchOps(patch: Parameters<typeof setPlatformOpsSettings>[0], okMsg?: string) {
    setOpsBusy(true);
    setOpsError(null);
    setOpsMsg(null);
    try {
      const config = await setPlatformOpsSettings(patch);
      setOps(config);
      setRetentionDraft(String(config.retentionDays));
      setIntervalDraft(String(config.purgeIntervalDays));
      setStuckDraft(String(config.queueStuckMinutes));
      if (okMsg) setOpsMsg(okMsg);
    } catch (err) {
      setOpsError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setOpsBusy(false);
    }
  }

  if (status === "checking" || status === "loading") {
    return (
      <main className="hero-shell">
        <p className="hero-caption">Carregando painel…</p>
      </main>
    );
  }
  if (status === "denied") {
    return (
      <main className="hero-shell">
        <div className="hero-panel" style={{ padding: "2rem", textAlign: "center" }}>
          <h1 className="hero-display" style={{ fontSize: "1.8rem" }}>
            Acesso restrito
          </h1>
          <p style={{ color: "var(--muted)" }}>Faça login com uma conta válida para abrir o painel.</p>
          <Link href="/" className="hero-link" style={{ display: "inline-block", marginTop: "1rem" }}>
            ← Voltar
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

  const allRepos = projects.flatMap((p) => p.repos);
  // Platform admin: KPIs come from adminGetPlatformSummary (aggregation
  // queries over the whole platform) rather than summing `projects`, which
  // is now just the currently-loaded page(s) of orgs. Org members (not
  // platform admin) never paginate — loadMemberProjects already returns
  // just their own orgs — so the local reduce stays correct for them.
  const orgCountDisplay = isPlatformAdmin ? platformSummary?.orgCount ?? orgCount : orgCount;
  const projectCountDisplay = isPlatformAdmin ? platformSummary?.projectCount ?? projects.length : projects.length;
  const repoCountDisplay = isPlatformAdmin ? platformSummary?.repoCount ?? allRepos.length : allRepos.length;
  const totalDebtHours = Math.round(
    (isPlatformAdmin ? platformSummary?.debtMinutes ?? projects.reduce((s, p) => s + p.debtMinutes, 0) : projects.reduce((s, p) => s + p.debtMinutes, 0)) / 60,
  );
  const totalOpenIssues = isPlatformAdmin
    ? platformSummary?.openIssues ?? projects.reduce((s, p) => s + p.openIssues, 0)
    : projects.reduce((s, p) => s + p.openIssues, 0);
  const failingGates = isPlatformAdmin
    ? platformSummary?.failingGates ?? projects.filter((p) => p.qualityGateStatus !== "PASSED").length
    : projects.filter((p) => p.qualityGateStatus !== "PASSED").length;
  const worstSecurity = isPlatformAdmin
    ? platformSummary?.worstSecurityRating ?? projects.reduce((acc, p) => worseRating(acc, p.securityRating), "A")
    : projects.reduce((acc, p) => worseRating(acc, p.securityRating), "A");

  return (
    <main className="hero-shell hero-shell--cockpit">
      <AdminCockpitShell groups={groups} tab={tab} onSelectTab={selectTab}>
        {tab === "instalacao" && <InstalacaoHome />}

        {tab === "visao-geral" && (
          <>
            <PageHeader
              eyebrow="Visão"
              title="Visão geral"
              description={
                isPlatformAdmin
                  ? `${orgCountDisplay} org(s) · ${projectCountDisplay} projeto(s) · ${repoCountDisplay} repo(s)`
                  : `${orgCount} org(s) · ${projects.length} projeto(s) seus`
              }
            />
            <KpiGroup>
              <KpiCard label="Organizações" value={orgCountDisplay} />
              <KpiCard label="Projetos" value={projectCountDisplay} />
              <KpiCard label="Repositórios" value={repoCountDisplay} />
              <KpiCard label="Débito" value={`${totalDebtHours}h`} />
              <KpiCard label="Issues" value={totalOpenIssues} />
              <KpiCard label="Gates falhando" value={failingGates} tone={failingGates > 0 ? "danger" : "ok"} />
              <KpiCard label="Pior segurança" value={worstSecurity} tone={worstSecurity === "A" ? "ok" : "warn"} />
            </KpiGroup>
            <p className="hero-caption" style={{ marginTop: "1.25rem" }}>
              Atalhos:{" "}
              <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("instalacao")}>
                Instalação
              </button>
              {" · "}
              <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("todos-projetos")}>
                Projetos
              </button>
              {isPlatformAdmin && (
                <>
                  {" · "}
                  <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("escala")}>
                    Escala e filas
                  </button>
                </>
              )}
            </p>
          </>
        )}

        {tab === "apontamentos" && isPlatformAdmin && (
          <>
            <PageHeader
              eyebrow="Visão"
              title="Apontamentos"
              description="Achados abertos em toda a plataforma — clique para abrir a ficha"
            />
            {issuesError && <div className="hero-error">{issuesError}</div>}
            <FindingsBrowser
              title={`${issues?.total ?? 0} abertos`}
              subtitle="Navegue com ← → no modal. Para marcar falso positivo, abra o Workspace do repositório."
              findings={(issues?.items ?? []).slice(0, 80).map(
                (it: AdminIssueRow): FindingsBrowserItem => ({
                  id: it.issueId,
                  ruleId: it.ruleId,
                  severity: it.severity,
                  issueType: it.issueType,
                  message: it.message,
                  file: it.file,
                  line: it.line,
                  meta: `${it.repoName} · ${it.orgName} · ${sourceLabel[it.source] ?? it.source}`,
                }),
              )}
              loading={issuesLoading}
              emptyMessage="Nenhum apontamento aberto."
            />
          </>
        )}

        {tab === "relatorio" && isPlatformAdmin && (
          <>
            <PageHeader
              eyebrow="Visão"
              title="Relatório"
              description="Manutenibilidade da plataforma, principais causas e repositórios com mais/menos apontamentos"
            />

            <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1fr)", marginBottom: "1.5rem" }}>
              <DataSection title="Manutenibilidade" description="Distribuição do rating de manutenibilidade entre projetos">
                {!platformSummary ? (
                  <p className="hero-caption">Carregando…</p>
                ) : (
                  <RatingDistribution buckets={platformSummary.byMaintainabilityRating} />
                )}
              </DataSection>
              <DataSection title="Segurança" description="Distribuição do rating de segurança entre projetos">
                {!platformSummary ? (
                  <p className="hero-caption">Carregando…</p>
                ) : (
                  <RatingDistribution buckets={platformSummary.bySecurityRating} />
                )}
              </DataSection>
            </div>

            <DataSection
              title="Principais causas"
              description="Regras que mais geram apontamentos abertos em toda a plataforma"
            >
              {issuesLoading ? (
                <p className="hero-caption">Carregando…</p>
              ) : !issues || issues.topCauses.length === 0 ? (
                <p className="hero-caption">Nenhum apontamento aberto ainda.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="hero-table">
                    <thead>
                      <tr>
                        <th>Regra</th>
                        <th>Severidade</th>
                        <th>Ocorrências</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.topCauses.map((c) => (
                        <tr key={c.ruleId}>
                          <td>
                            <code style={{ fontSize: "0.8rem" }}>{c.ruleId}</code>
                            <div className="hero-caption" style={{ marginTop: "0.15rem" }}>{c.message}</div>
                          </td>
                          <td>
                            <span
                              className="hero-badge"
                              style={{ background: severityColor[c.severity] ?? "var(--muted)", color: "#fff" }}
                            >
                              {c.severity}
                            </span>
                          </td>
                          <td>{c.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataSection>

            <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1fr)" }}>
              <DataSection title="Mais apontamentos" description="Repositórios que mais precisam de atenção agora">
                {issuesLoading ? (
                  <p className="hero-caption">Carregando…</p>
                ) : !issues || issues.mostFindings.length === 0 ? (
                  <p className="hero-caption">Nenhum dado ainda.</p>
                ) : (
                  <RepoFindingList items={issues.mostFindings} tone="danger" />
                )}
              </DataSection>
              <DataSection title="Menos apontamentos" description="Repositórios mais limpos da plataforma">
                {issuesLoading ? (
                  <p className="hero-caption">Carregando…</p>
                ) : !issues || issues.leastFindings.length === 0 ? (
                  <p className="hero-caption">Nenhum dado ainda.</p>
                ) : (
                  <RepoFindingList items={issues.leastFindings} tone="ok" />
                )}
              </DataSection>
            </div>
          </>
        )}

        {tab === "todos-projetos" && (
          <>
            <PageHeader
              eyebrow="Projetos"
              title="Todos os projetos"
              description="Consolidação por projeto — abra o workspace para configurar Action, scan e plugin"
              actions={
                isPlatformAdmin ? (
                  <button type="button" className="hero-btn hero-btn-accent" onClick={() => selectTab("novo-workspace")}>
                    Novo workspace
                  </button>
                ) : undefined
              }
            />
            {projects.length === 0 ? (
              <Callout tone="neutral" title="Nenhum projeto">
                Use <strong>Instalação → Novo projeto</strong>
                {isPlatformAdmin ? " ou Novo workspace" : ""} para começar.
              </Callout>
            ) : (
              <div className="hero-panel" style={{ overflowX: "auto" }}>
                <table className="hero-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Projeto</th>
                      <th>Org</th>
                      <th>Repos</th>
                      <th>Gate</th>
                      <th>Seg</th>
                      <th>Issues</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => {
                      const key = `${p.orgId}/${p.projectId}`;
                      const open = expanded.has(key);
                      return (
                        <Fragment key={key}>
                          <tr
                            style={{ cursor: "pointer" }}
                            onClick={() =>
                              setExpanded((prev) => {
                                const n = new Set(prev);
                                if (n.has(key)) n.delete(key);
                                else n.add(key);
                                return n;
                              })
                            }
                          >
                            <td>{open ? "▾" : "▸"}</td>
                            <td style={{ fontWeight: 700 }}>{p.name}</td>
                            <td>{p.orgName}</td>
                            <td>
                              <span className="hero-badge">{p.repoCount}</span>
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
                              <span className="hero-rating" style={{ background: ratingColor[p.securityRating] }}>
                                {p.securityRating}
                              </span>
                            </td>
                            <td>{p.openIssues}</td>
                            <td>
                              <button
                                type="button"
                                className="hero-btn hero-btn-outline"
                                style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigateWorkspace(p.orgId, p.projectId, p.repos[0]?.repoId);
                                }}
                              >
                                Workspace
                              </button>
                            </td>
                          </tr>
                          {open &&
                            p.repos.map((r: RepoRow) => (
                              <tr key={r.repoId} style={{ background: "color-mix(in srgb, var(--line) 4%, transparent)" }}>
                                <td />
                                <td colSpan={2} style={{ paddingLeft: "1.5rem" }}>
                                  ↳ {r.name}
                                </td>
                                <td />
                                <td>
                                  <span className="hero-badge">{r.qualityGateStatus}</span>
                                </td>
                                <td>
                                  <span className="hero-rating" style={{ background: ratingColor[r.securityRating] }}>
                                    {r.securityRating}
                                  </span>
                                </td>
                                <td>{r.openIssues}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="hero-link"
                                    style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: "0.78rem" }}
                                    onClick={() => navigateWorkspace(p.orgId, p.projectId, r.repoId)}
                                  >
                                    abrir
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {isPlatformAdmin && nextOrgCursor && (
              <button
                type="button"
                className="hero-btn hero-btn-outline"
                style={{ marginTop: "1rem" }}
                disabled={loadingMoreOrgs}
                onClick={loadMoreOrgs}
              >
                {loadingMoreOrgs ? "Carregando…" : "Carregar mais organizações"}
              </button>
            )}
          </>
        )}

        {tab === "workspace" && (
          <>
            <PageHeader
              eyebrow="Projetos"
              title="Workspace"
              description="Configuração do projeto e repositórios (Action, scan, plugin, issues)"
            />
            {!wsOrg || !wsProject ? (
              <Callout tone="warn" title="Selecione um projeto">
                Vá em <strong>Todos os projetos</strong>
                {isPlatformAdmin ? " ou Novo workspace" : " ou Instalação"}.
                <button type="button" className="hero-btn" style={{ marginTop: "0.75rem" }} onClick={() => selectTab("todos-projetos")}>
                  Ver projetos
                </button>
              </Callout>
            ) : (
              <Suspense fallback={<p className="hero-caption">Carregando workspace…</p>}>
                <ProjectWorkspace
                  orgId={wsOrg}
                  projectId={wsProject}
                  initialRepoId={wsRepo}
                  onNavigate={({ orgId, projectId, repoId }) => navigateWorkspace(orgId, projectId, repoId)}
                />
              </Suspense>
            )}
          </>
        )}

        {tab === "regras" && <RulesCatalog />}

        {tab === "novo-workspace" && isPlatformAdmin && (
          <WorkspaceWizard projects={projects} onOpenWorkspace={navigateWorkspace} />
        )}

        {tab === "dress-code" && isPlatformAdmin && (
          <>
            <PageHeader eyebrow="Plataforma" title="Dress code" description="Políticas em linguagem natural → regras ativas em todos os scans" />
            {dressError && <div className="hero-error">{dressError}</div>}
            {dressMsg && <Callout tone="ok">{dressMsg}</Callout>}
            <DataSection title="Novo dress code global">
              <form
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  setDressBusy(true);
                  setDressError(null);
                  setDressMsg(null);
                  try {
                    const res = await submitDressCode({
                      naturalLanguage: dressText,
                      scope: "global",
                      activate: true,
                    });
                    setDressMsg(`${res.ruleCount} regra(s) ativada(s): ${res.summary}`);
                    setDressText("");
                    const { items } = await listDressCodes({ scope: "global" });
                    setDressItems(items);
                  } catch (err) {
                    setDressError(err instanceof Error ? err.message : "Falha.");
                  } finally {
                    setDressBusy(false);
                  }
                }}
                style={{ display: "grid", gap: "0.75rem" }}
              >
                <textarea
                  className="hero-input"
                  rows={4}
                  placeholder="Ex.: Sem console.log em produção; sem Math.random em tokens…"
                  value={dressText}
                  onChange={(e) => setDressText(e.target.value)}
                  required
                  minLength={8}
                />
                <button type="submit" className="hero-btn hero-btn-accent" disabled={dressBusy}>
                  {dressBusy ? "Interpretando…" : "Criar e ativar"}
                </button>
              </form>
            </DataSection>
            <DataSection title="Recentes">
              {dressItems.length === 0 ? (
                <p className="hero-caption">Nenhum dress code global ainda.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {dressItems.slice(0, 20).map((d) => (
                    <div key={String(d.id)} className="hero-panel-sm" style={{ padding: "0.75rem 1rem" }}>
                      <strong>{String(d.status ?? "")}</strong>
                      <p className="hero-caption" style={{ margin: "0.25rem 0 0" }}>
                        {String(d.summary ?? d.naturalLanguage ?? "").slice(0, 200)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </DataSection>
          </>
        )}

        {tab === "esteira" && isPlatformAdmin && (
          <>
            <PageHeader
              eyebrow="Plataforma"
              title="Esteira de regras"
              description="1×/dia propõe melhorias; o motor determinístico decide promoção"
              actions={
                <button
                  type="button"
                  className="hero-btn hero-btn-accent"
                  disabled={runBusy}
                  onClick={async () => {
                    setRunBusy(true);
                    setRunsError(null);
                    try {
                      await runRuleforgeDailyNow();
                      const { runs: r } = await listRuleforgeRuns(14);
                      setRuns(r);
                    } catch (err) {
                      setRunsError(err instanceof Error ? err.message : "Falha ao rodar.");
                    } finally {
                      setRunBusy(false);
                    }
                  }}
                >
                  {runBusy ? "Rodando…" : "Rodar agora"}
                </button>
              }
            />
            {runsError && <div className="hero-error">{runsError}</div>}
            {runsLoading ? (
              <p className="hero-caption">Carregando…</p>
            ) : runs.length === 0 ? (
              <p className="hero-caption">Nenhuma execução ainda.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {runs.map((r) => (
                  <div key={r.day} className="hero-panel-sm" style={{ padding: "0.85rem 1rem" }}>
                    <button
                      type="button"
                      onClick={() => setExpandedRun(expandedRun === r.day ? null : r.day)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        width: "100%",
                        background: "none",
                        border: 0,
                        cursor: "pointer",
                        font: "inherit",
                        color: "inherit",
                        padding: 0,
                      }}
                    >
                      <span>
                        {expandedRun === r.day ? "▾" : "▸"} <strong>{r.day}</strong>
                      </span>
                      <span>
                        <span className="hero-badge" style={{ background: "var(--rating-a)", color: "#fff", marginRight: 6 }}>
                          {r.promotedCount} ok
                        </span>
                        <span className="hero-badge">{r.rejectedCount} rejeitadas</span>
                      </span>
                    </button>
                    {expandedRun === r.day && (
                      <ul className="hero-caption" style={{ marginTop: "0.75rem" }}>
                        {r.rules.map((ro) => (
                          <li key={ro.ruleId}>
                            <code>{ro.ruleId}</code> — {ro.decision} ({ro.baselineF1.toFixed(2)} → {ro.bestF1.toFixed(2)})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "feature-toggles" && isPlatformAdmin && (
          <>
            <PageHeader eyebrow="Plataforma" title="Feature toggles" description="Liga/desliga recursos do portal" />
            {flagError && <div className="hero-error">{flagError}</div>}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setFlagBusy(true);
                setFlagError(null);
                try {
                  await setFeatureFlag({ key: flagKey.trim(), enabled: true, description: flagDesc.trim() });
                  const { flags: f } = await listFeatureFlags();
                  setFlags(f);
                  setFlagKey("");
                  setFlagDesc("");
                } catch (err) {
                  setFlagError(err instanceof Error ? err.message : "Falha.");
                } finally {
                  setFlagBusy(false);
                }
              }}
              style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}
            >
              <input className="hero-input" style={{ flex: "1 1 160px" }} required placeholder="chave" value={flagKey} onChange={(e) => setFlagKey(e.target.value)} />
              <input className="hero-input" style={{ flex: "2 1 220px" }} placeholder="descrição" value={flagDesc} onChange={(e) => setFlagDesc(e.target.value)} />
              <button type="submit" className="hero-btn hero-btn-accent" disabled={flagBusy}>
                Criar
              </button>
            </form>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {flags.map((f) => (
                <div key={f.key} className="hero-panel-sm" style={{ padding: "0.7rem 1rem", display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div>
                    <code style={{ fontWeight: 700 }}>{f.key}</code>
                    {f.description ? <span className="hero-caption" style={{ marginLeft: "0.5rem" }}>{f.description}</span> : null}
                  </div>
                  <button
                    type="button"
                    className="hero-btn"
                    style={{
                      padding: "0.3rem 0.7rem",
                      fontSize: "0.75rem",
                      background: f.enabled ? "var(--rating-a)" : "var(--rating-e)",
                      color: "#fff",
                      border: 0,
                    }}
                    onClick={async () => {
                      try {
                        await setFeatureFlag({ key: f.key, enabled: !f.enabled, description: f.description });
                        setFlags((prev) => prev.map((x) => (x.key === f.key ? { ...x, enabled: !x.enabled } : x)));
                      } catch (err) {
                        setFlagError(err instanceof Error ? err.message : "Falha.");
                      }
                    }}
                  >
                    {f.enabled ? "Ligado" : "Desligado"}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "escala" && isPlatformAdmin && ops && (
          <>
            <PageHeader eyebrow="Operações" title="Escala e filas" description="Expurgo, ingest assíncrono e correção de filas" />
            {opsError && <div className="hero-error">{opsError}</div>}
            {opsMsg && <Callout tone="ok">{opsMsg}</Callout>}
            <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.25rem" }}>
              {(
                [
                  ["purgeEnabled", "Expurgo de detalhe", ops.purgeEnabled],
                  ["deferIssueWrites", "Ingest assíncrono", ops.deferIssueWrites],
                  ["queueAutoRetry", "Correção auto das filas", ops.queueAutoRetry],
                ] as const
              ).map(([key, label, enabled]) => (
                <div key={key} className="hero-panel-sm" style={{ padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
                  <strong>{label}</strong>
                  <button
                    type="button"
                    className="hero-btn"
                    disabled={opsBusy}
                    style={{ background: enabled ? "var(--rating-a)" : "var(--rating-e)", color: "#fff", border: 0, padding: "0.3rem 0.7rem", fontSize: "0.75rem" }}
                    onClick={() => patchOps({ [key]: !enabled })}
                  >
                    {enabled ? "Ligado" : "Desligado"}
                  </button>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void patchOps(
                  {
                    retentionDays: Number(retentionDraft),
                    purgeIntervalDays: Number(intervalDraft),
                    queueStuckMinutes: Number(stuckDraft),
                  },
                  "Periodicidade salva.",
                );
              }}
              style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", alignItems: "end", marginBottom: "1rem" }}
            >
              <label style={{ display: "grid", gap: "0.3rem" }}>
                <span className="hero-label">Retenção (dias)</span>
                <input className="hero-input" type="number" value={retentionDraft} onChange={(e) => setRetentionDraft(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: "0.3rem" }}>
                <span className="hero-label">Intervalo expurgo</span>
                <input className="hero-input" type="number" value={intervalDraft} onChange={(e) => setIntervalDraft(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: "0.3rem" }}>
                <span className="hero-label">Fila travada (min)</span>
                <input className="hero-input" type="number" value={stuckDraft} onChange={(e) => setStuckDraft(e.target.value)} />
              </label>
              <button type="submit" className="hero-btn hero-btn-accent" disabled={opsBusy}>
                Salvar
              </button>
            </form>
            {queue && (
              <p className="hero-caption">
                Fila: pending {queue.pending} · running {queue.running} · failed {queue.failed} · done {queue.done}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="hero-btn"
                disabled={opsBusy}
                onClick={async () => {
                  setOpsBusy(true);
                  try {
                    const res = await repairIngestQueues();
                    setQueue(res.queue);
                    setOpsMsg(`${res.requeued} job(s) reenfileirado(s).`);
                  } catch (err) {
                    setOpsError(err instanceof Error ? err.message : "Falha.");
                  } finally {
                    setOpsBusy(false);
                  }
                }}
              >
                Corrigir filas
              </button>
              <button
                type="button"
                className="hero-btn hero-btn-outline"
                disabled={opsBusy || !ops.purgeEnabled}
                onClick={async () => {
                  if (!window.confirm("Rodar expurgo agora?")) return;
                  setOpsBusy(true);
                  try {
                    const res = await runDetailPurgeNow();
                    setOpsMsg(`Expurgo: ${res.analysesDeleted} analyses, ${res.issuesDeleted} issues.`);
                  } catch (err) {
                    setOpsError(err instanceof Error ? err.message : "Falha.");
                  } finally {
                    setOpsBusy(false);
                  }
                }}
              >
                Expurgo agora
              </button>
            </div>
          </>
        )}

        {tab === "cotas" && isPlatformAdmin && (
          <>
            <PageHeader eyebrow="Operações" title="Cotas" description="Limites de repos e builds por organização" />
            {quotaError && <div className="hero-error">{quotaError}</div>}
            <label style={{ display: "grid", gap: "0.35rem", marginBottom: "1rem", maxWidth: 360 }}>
              <span className="hero-label">Organização</span>
              <select className="hero-input" value={quotaOrgId} onChange={(e) => setQuotaOrgId(e.target.value)}>
                {orgs.map((o) => (
                  <option key={o.orgId} value={o.orgId}>
                    {o.orgName}
                  </option>
                ))}
              </select>
            </label>
            {quotas && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setQuotaBusy(true);
                  setQuotaError(null);
                  try {
                    const res = await setOrgQuotas({
                      orgId: quotaOrgId,
                      maxRepos: Number(maxReposDraft),
                      maxBuildsPerMonth: Number(maxBuildsDraft),
                    });
                    setQuotas(res.quotas);
                  } catch (err) {
                    setQuotaError(err instanceof Error ? err.message : "Falha.");
                  } finally {
                    setQuotaBusy(false);
                  }
                }}
                style={{ display: "grid", gap: "0.75rem", maxWidth: 400 }}
              >
                <label style={{ display: "grid", gap: "0.3rem" }}>
                  <span className="hero-label">Máx. repositórios</span>
                  <input className="hero-input" type="number" value={maxReposDraft} onChange={(e) => setMaxReposDraft(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "0.3rem" }}>
                  <span className="hero-label">Máx. builds / mês</span>
                  <input className="hero-input" type="number" value={maxBuildsDraft} onChange={(e) => setMaxBuildsDraft(e.target.value)} />
                </label>
                <p className="hero-caption">Builds neste mês: {quotas.buildsThisMonth}</p>
                <button type="submit" className="hero-btn hero-btn-accent" disabled={quotaBusy}>
                  Salvar cotas
                </button>
              </form>
            )}
          </>
        )}

        {tab === "usuarios" && isPlatformAdmin && <UsersPanel />}
      </AdminCockpitShell>
    </main>
  );
}

function RatingDistribution({ buckets }: { buckets: Record<string, number> }) {
  const order = ["A", "B", "C", "D", "E"];
  const total = order.reduce((s, r) => s + (buckets[r] ?? 0), 0);
  if (total === 0) return <p className="hero-caption">Sem dados ainda.</p>;
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {order.map((r) => {
        const count = buckets[r] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={r} style={{ display: "grid", gridTemplateColumns: "1.5rem 1fr 3rem", alignItems: "center", gap: "0.5rem" }}>
            <span className="hero-rating" style={{ background: ratingColor[r], width: "1.5rem", height: "1.5rem", fontSize: "0.75rem" }}>
              {r}
            </span>
            <div style={{ background: "color-mix(in srgb, var(--line) 12%, transparent)", borderRadius: 4, overflow: "hidden", height: 10 }}>
              <div style={{ width: `${pct}%`, background: ratingColor[r], height: "100%" }} />
            </div>
            <span className="hero-caption" style={{ textAlign: "right" }}>
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RepoFindingList({ items, tone }: { items: AdminRepoFindingCount[]; tone: "danger" | "ok" }) {
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {items.map((it) => (
        <div
          key={it.repoId}
          className="hero-panel-sm"
          style={{ padding: "0.6rem 0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}
        >
          <div>
            <strong>{it.repoName}</strong>
            <div className="hero-caption">
              {it.projectName} · {it.orgName}
            </div>
          </div>
          <span
            className="hero-badge"
            style={{
              background: tone === "danger" ? "var(--rating-e)" : "var(--rating-a)",
              color: "#fff",
            }}
          >
            {it.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AppShell>
        <Suspense fallback={<p className="hero-caption" style={{ padding: "2rem" }}>Carregando…</p>}>
          <AdminPanelInner />
        </Suspense>
      </AppShell>
    </AuthGate>
  );
}
