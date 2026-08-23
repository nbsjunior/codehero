"use client";
import dynamic from "next/dynamic";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import AdminCockpitShell, { type CockpitNavGroup } from "@/components/AdminCockpitShell";
import { Callout, DataSection, KpiCard, KpiGroup, PageHeader } from "@/components/AdminUi";
import InstalacaoHome from "@/components/admin/InstalacaoHome";
import { dbClient } from "@/lib/firebaseDb";
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
  repairIngestQueues,
  runDetailPurgeNow,
  setFeatureFlag,
  setOrgQuotas,
  setPlatformOpsSettings,
  submitDressCode,
  type AdminIssueRow,
  type AdminIssuesResult,
  type AdminProjectRow,
  type FeatureFlag,
  type IngestQueueCounts,
  type OrgQuotasView,
  type PlatformOpsConfig,
  type PlatformSummary,
  type RepoRow,
} from "@/lib/api";
import { loadWorkspaceIssues, summaryFromProjects } from "@/lib/workspaceInsights";

const ProjectWorkspace = dynamic(() => import("@/components/admin/ProjectWorkspace"), { ssr: false });
const WorkspaceWizard = dynamic(() => import("@/components/admin/WorkspaceWizard"), { ssr: false });
const UsersPanel = dynamic(() => import("@/components/admin/UsersPanel"), { ssr: false });
const RulesCatalog = dynamic(() => import("@/components/admin/RulesCatalog"), { ssr: false });
const McpIntegrationPanel = dynamic(() => import("@/components/admin/McpIntegrationPanel"), { ssr: false });
const RelatorioPanel = dynamic(() => import("@/components/admin/RelatorioPanel"), { ssr: false });
const EsteiraPanel = dynamic(() => import("@/components/admin/EsteiraPanel"), { ssr: false });
const ManutenibilidadePanel = dynamic(() => import("@/components/admin/ManutenibilidadePanel"), {
  ssr: false,
});
const FindingsBrowser = dynamic(
  () => import("@/components/FindingsBrowser").then((m) => m.default),
  { ssr: false },
);
type FindingsBrowserItem = import("@/components/FindingsBrowser").FindingsBrowserItem;

const SHARED_GROUPS: CockpitNavGroup[] = [
  {
    id: "instalacao",
    label: "Início",
    tier: "operation",
    items: [{ id: "instalacao", label: "Começar" }],
  },
  {
    id: "visao",
    label: "Inteligência",
    tier: "operation",
    items: [
      { id: "visao-geral", label: "Visão geral" },
      { id: "apontamentos", label: "Apontamentos" },
      { id: "relatorio", label: "Relatório executivo" },
      { id: "manutenibilidade", label: "Manutenibilidade" },
    ],
  },
  {
    id: "projetos",
    label: "Entrega",
    tier: "portfolio",
    items: [
      { id: "todos-projetos", label: "Todos os projetos" },
      { id: "novo-workspace", label: "Novo workspace" },
      { id: "workspace", label: "Workspace ativo" },
      { id: "regras", label: "Regras do motor" },
      { id: "mcp-integracao", label: "Integração MCP" },
    ],
  },
  {
    id: "docs",
    label: "Referência",
    tier: "resources",
    items: [{ id: "docs", label: "Documentação", href: "/docs/" }],
  },
];

const ADMIN_ONLY_GROUPS: CockpitNavGroup[] = [
  {
    id: "plataforma",
    label: "Política",
    tier: "governance",
    items: [
      { id: "dress-code", label: "Dress code" },
      { id: "esteira", label: "Esteira de regras" },
      { id: "feature-toggles", label: "Feature toggles" },
    ],
  },
  {
    id: "operacoes",
    label: "Infraestrutura",
    tier: "governance",
    items: [
      { id: "escala", label: "Escala e filas" },
      { id: "cotas", label: "Cotas" },
    ],
  },
  {
    id: "usuarios",
    label: "Pessoas",
    tier: "governance",
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
  const [summaryError, setSummaryError] = useState<string | null>(null);

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

  const [dressItems, setDressItems] = useState<Array<Record<string, unknown>>>([]);
  const [dressText, setDressText] = useState("");
  const [dressBusy, setDressBusy] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [dressMsg, setDressMsg] = useState<string | null>(null);
  const [dressRequireApproval, setDressRequireApproval] = useState(true);

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
    // Gestor: mesmos itens de projetos (incl. Novo workspace na própria org);
    // menus de governança de plataforma ficam só para platform admin.
    return isPlatformAdmin ? [...SHARED_GROUPS, ...ADMIN_ONLY_GROUPS] : SHARED_GROUPS;
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
    const perOrg = await Promise.all(
      orgIds.map(async (orgId) => {
        const orgSnap = await getDoc(doc(dbClient, "orgs", orgId));
        const orgName = orgSnap.exists() ? ((orgSnap.data().name as string | undefined) ?? orgId) : orgId;
        const projectsSnap = await getDocs(collection(dbClient, "orgs", orgId, "projects"));
        return Promise.all(
          projectsSnap.docs.map(async (p) => {
            const data = p.data();
            // Prefer rolled-up repoCount; only list repos when the UI needs URLs.
            const reposSnap = await getDocs(collection(dbClient, "orgs", orgId, "projects", p.id, "repos"));
            const row: AdminProjectRow = {
              orgId,
              orgName,
              projectId: p.id,
              name: (data.name as string | undefined) ?? p.id,
              repoCount: (data.repoCount as number | undefined) ?? reposSnap.size,
              debtMinutes: (data.debtMinutes as number | undefined) ?? 0,
              maintainabilityRating: (data.maintainabilityRating as string | undefined) ?? "A",
              securityRating: (data.securityRating as string | undefined) ?? "A",
              qualityGateStatus: (data.qualityGateStatus as string | undefined) ?? "PASSED",
              openIssues: (data.openIssues as number | undefined) ?? 0,
              lastAnalyzedAt: null,
              repos: reposSnap.docs.map((r) => {
                const rd = r.data();
                const lastAt =
                  typeof rd.lastAnalyzedAt?.toDate === "function"
                    ? (rd.lastAnalyzedAt.toDate() as Date).toISOString()
                    : typeof rd.lastAnalyzedAt === "string"
                      ? rd.lastAnalyzedAt
                      : null;
                const auto = rd.autoScan as
                  | {
                      enabled?: boolean;
                      periodicityDays?: number;
                      nextRunAt?: { toDate?: () => Date };
                      lastRunAt?: { toDate?: () => Date };
                    }
                  | undefined;
                return {
                  repoId: r.id,
                  name: (rd.name as string | undefined) ?? r.id,
                  repoUrl: (rd.repoUrl as string | null | undefined) ?? null,
                  debtMinutes: (rd.debtMinutes as number | undefined) ?? 0,
                  maintainabilityRating: (rd.maintainabilityRating as string | undefined) ?? "A",
                  securityRating: (rd.securityRating as string | undefined) ?? "A",
                  qualityGateStatus: (rd.qualityGateStatus as string | undefined) ?? "PASSED",
                  openIssues: (rd.openIssues as number | undefined) ?? 0,
                  lastAnalyzedAt: lastAt,
                  codeGraph: (rd.codeGraph as RepoRow["codeGraph"]) ?? null,
                  arquitetura: (rd.arquitetura as RepoRow["arquitetura"]) ?? null,
                  autoScan: auto
                    ? {
                        enabled: !!auto.enabled,
                        periodicityDays: auto.periodicityDays ?? 7,
                        nextRunAt:
                          typeof auto.nextRunAt?.toDate === "function"
                            ? auto.nextRunAt.toDate().toISOString()
                            : null,
                        lastRunAt:
                          typeof auto.lastRunAt?.toDate === "function"
                            ? auto.lastRunAt.toDate().toISOString()
                            : null,
                      }
                    : undefined,
                };
              }),
            };
            const latestRepo = row.repos
              .map((r) => r.lastAnalyzedAt)
              .filter((x): x is string => Boolean(x))
              .sort()
              .at(-1);
            row.lastAnalyzedAt = latestRepo ?? null;
            return row;
          }),
        );
      }),
    );
    return perOrg.flat();
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
          const [{ orgCount: oc, projects: rows, nextCursor }, summaryResult] = await Promise.all([
            adminListAllProjects(),
            adminGetPlatformSummary()
              .then((s) => ({ summary: s, error: null as string | null }))
              .catch((err) => ({
                summary: null as PlatformSummary | null,
                error: err instanceof Error ? err.message : "Falha ao carregar o resumo da plataforma.",
              })),
          ]);
          if (cancelled) return;
          setOrgCount(oc);
          setProjects(rows);
          setNextOrgCursor(nextCursor);
          setPlatformSummary(summaryResult.summary);
          setSummaryError(summaryResult.error);
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

  const refreshWorkspaceInsights = useCallback(async () => {
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      let nextProjects = projects;
      if (user?.uid) {
        nextProjects = await loadMemberProjects(user.uid);
        setProjects(nextProjects);
        setOrgCount(new Set(nextProjects.map((p) => p.orgId)).size);
      }
      setPlatformSummary(summaryFromProjects(nextProjects));
      setSummaryError(null);
      const res = await loadWorkspaceIssues(nextProjects);
      setIssues(res);
    } catch (err) {
      setIssuesError(err instanceof Error ? err.message : "Falha nos apontamentos do workspace.");
    } finally {
      setIssuesLoading(false);
    }
  }, [projects, user?.uid]);

  // Gestor: gráficos e relatório a partir dos projetos/repos da conta.
  useEffect(() => {
    if (status !== "ready" || isPlatformAdmin) return;
    let cancelled = false;
    setIssuesLoading(true);
    setPlatformSummary(summaryFromProjects(projects));
    setSummaryError(null);
    loadWorkspaceIssues(projects)
      .then((res) => {
        if (!cancelled) setIssues(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setIssuesError(err instanceof Error ? err.message : "Falha nos apontamentos do workspace.");
        }
      })
      .finally(() => {
        if (!cancelled) setIssuesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, isPlatformAdmin, projects]);

  // Platform admin: callables globais (issues + ops + flags).
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
      <main className="ex-boot">
        <p className="ex-boot__msg">Carregando painel executivo…</p>
      </main>
    );
  }
  if (status === "denied") {
    return (
      <main className="ex-boot">
        <div className="ex-boot__card">
          <p className="ex-boot__eyebrow">Acesso</p>
          <h1 className="ex-boot__title">Área restrita</h1>
          <p className="ex-boot__desc">Faça login com uma conta válida para abrir o painel.</p>
          <Link href="/" className="ex-btn ex-btn--primary">
            Voltar ao início
          </Link>
        </div>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="ex-boot">
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
    <main className="ex-shell">
      <AdminCockpitShell
        groups={groups}
        tab={tab}
        onSelectTab={selectTab}
        isPlatformAdmin={isPlatformAdmin}
      >
        {tab === "instalacao" && (
          <InstalacaoHome
            onNewWorkspace={() => selectTab("novo-workspace")}
            onOpenWorkspace={navigateWorkspace}
          />
        )}

        {tab === "visao-geral" && (
          <>
            <PageHeader
              eyebrow="Portfólio"
              title="Visão geral"
              description={
                isPlatformAdmin
                  ? `Snapshot da plataforma: ${orgCountDisplay} org(s), ${projectCountDisplay} projeto(s), ${repoCountDisplay} repo(s). Use o Relatório para aprofundar.`
                  : `Seus workspaces: ${projects.length} projeto(s) em ${orgCount} org(s). Próximo passo: Relatório ou primeiro scan.`
              }
            />
            <KpiGroup>
              <KpiCard label="Organizações" value={orgCountDisplay} />
              <KpiCard label="Projetos" value={projectCountDisplay} />
              <KpiCard label="Repositórios" value={repoCountDisplay} />
              <KpiCard label="Débito técnico" value={`${totalDebtHours}h`} />
              <KpiCard label="Apontamentos abertos" value={totalOpenIssues} />
              <KpiCard
                label="Gates a corrigir"
                value={failingGates}
                tone={failingGates > 0 ? "danger" : "ok"}
                sub={failingGates === 0 ? "Todos passando" : "Priorize no Relatório"}
              />
              <KpiCard
                label="Nota de segurança"
                value={worstSecurity}
                tone={worstSecurity === "A" ? "ok" : "warn"}
                sub="pior rating do portfólio"
              />
            </KpiGroup>
            <Callout tone="neutral" title="Por onde começar hoje">
              <p className="hero-caption" style={{ margin: 0 }}>
                <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("instalacao")}>
                  Começar
                </button>
                {" — setup e primeiro scan · "}
                <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("relatorio")}>
                  Relatório
                </button>
                {" — saúde e tendências · "}
                <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("apontamentos")}>
                  Apontamentos
                </button>
                {" — fila de achados · "}
                <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("todos-projetos")}>
                  Projetos
                </button>
                {isPlatformAdmin && (
                  <>
                    {" · "}
                    <button type="button" className="hero-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit" }} onClick={() => selectTab("escala")}>
                      Escala
                    </button>
                  </>
                )}
              </p>
            </Callout>
          </>
        )}

        {tab === "apontamentos" && (
          <>
            <PageHeader
              eyebrow="Portfólio"
              title="Apontamentos"
              description={
                isPlatformAdmin
                  ? "Achados abertos em toda a plataforma — abra a ficha para entender risco e correção"
                  : "Achados abertos nos seus projetos — abra a ficha; para marcar falso positivo, use o Workspace"
              }
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
              emptyMessage="Nada aberto ainda. Rode o primeiro scan em Começar (plugin, Action ou prévia na nuvem)."
            />
          </>
        )}

        {tab === "relatorio" && (
          <RelatorioPanel
            projects={projects}
            platformSummary={platformSummary}
            summaryError={summaryError}
            onSummaryLoaded={(summary, error) => {
              setPlatformSummary(summary);
              setSummaryError(error);
            }}
            issues={issues}
            issuesLoading={issuesLoading}
            issuesError={issuesError}
            onOpenWorkspace={navigateWorkspace}
            scope={isPlatformAdmin ? "platform" : "workspace"}
            onRefreshWorkspace={isPlatformAdmin ? undefined : refreshWorkspaceInsights}
          />
        )}

        {tab === "todos-projetos" && (
          <>
            <PageHeader
              eyebrow="Projetos"
              title="Todos os projetos"
              description="Consolidação por projeto — abra o workspace para configurar Action, scan e plugin"
              actions={
                <button type="button" className="hero-btn hero-btn-accent" onClick={() => selectTab("novo-workspace")}>
                  Novo workspace
                </button>
              }
            />
            {projects.length === 0 ? (
              <Callout tone="neutral" title="Nenhum projeto">
                Use <strong>Novo workspace</strong> (Começar ou Entrega) — organização, projeto e repos num fluxo só.
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
              eyebrow="Entrega"
              title="Workspace"
              description="Selecione o repositório — Action, plugin e token são por repo, não globais do projeto."
            />
            {!wsOrg || !wsProject ? (
              <Callout tone="warn" title="Selecione um projeto">
                Vá em <strong>Todos os projetos</strong>, <strong>Começar</strong> ou{" "}
                <strong>Novo workspace</strong>.
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button type="button" className="hero-btn" onClick={() => selectTab("todos-projetos")}>
                    Ver projetos
                  </button>
                  <button type="button" className="hero-btn hero-btn-outline" onClick={() => selectTab("novo-workspace")}>
                    Novo workspace
                  </button>
                  <button type="button" className="hero-btn hero-btn-outline" onClick={() => selectTab("instalacao")}>
                    Começar
                  </button>
                </div>
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

        {tab === "mcp-integracao" && (
          <McpIntegrationPanel
            projects={projects}
            initialOrgId={wsOrg}
            initialProjectId={wsProject}
            onOpenWorkspace={navigateWorkspace}
          />
        )}

        {tab === "novo-workspace" && (
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
                      activate: !dressRequireApproval,
                      requireApproval: dressRequireApproval,
                    });
                    setDressMsg(
                      dressRequireApproval
                        ? `${res.ruleCount} proposta(s) na Esteira: ${res.summary}`
                        : `${res.ruleCount} regra(s) ativada(s): ${res.summary}`,
                    );
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
                <label className="hero-radio-row">
                  <input
                    type="checkbox"
                    checked={dressRequireApproval}
                    onChange={(e) => setDressRequireApproval(e.target.checked)}
                  />
                  <span>Enviar para aprovação na Esteira (recomendado)</span>
                </label>
                <button type="submit" className="hero-btn hero-btn-accent" disabled={dressBusy}>
                  {dressBusy ? "Interpretando…" : dressRequireApproval ? "Criar propostas" : "Criar e ativar"}
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

        {tab === "manutenibilidade" && (
          <ManutenibilidadePanel projects={projects} isPlatformAdmin={isPlatformAdmin} />
        )}

        {tab === "esteira" && isPlatformAdmin && <EsteiraPanel />}

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

        {tab === "escala" && isPlatformAdmin && (
          <>
            <PageHeader eyebrow="Operações" title="Escala e filas" description="Expurgo, ingest assíncrono e correção de filas" />
            {opsError && <div className="hero-error">{opsError}</div>}
            {opsMsg && <Callout tone="ok">{opsMsg}</Callout>}
            {!ops && !opsError && <p className="hero-caption">Carregando configurações…</p>}
            {ops && (
              <>
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

export default function AdminPage() {
  return (
    <AuthGate>
      <AppShell>
        <Suspense fallback={<main className="ex-boot"><p className="ex-boot__msg">Carregando painel executivo…</p></main>}>
          <AdminPanelInner />
        </Suspense>
      </AppShell>
    </AuthGate>
  );
}
