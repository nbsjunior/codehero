"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import {
  buildCodeHeroWorkflowYaml,
  buildGithubCliSetupScript,
  buildHeroTokenSecretCommand,
} from "@codehero/contracts";
import CopyButton from "@/components/CopyButton";
import HeroTokenCard from "@/components/admin/HeroTokenCard";
import FindingsBrowser, { type FindingsBrowserItem } from "@/components/FindingsBrowser";
import {
  DebtMeter,
  GatePill,
  RatingRing,
  SeverityBars,
  VerticalBars,
  countByField,
} from "@/components/RepoHealthCharts";
import { dbClient } from "@/lib/firebaseDb";
import {
  addRepoToProject,
  applyOfflineTriage,
  applyCodeEmbedClusters,
  exportRuleforgeFeedback,
  flagIssueFeedback,
  getProjectQualityGate,
  rotateIngestToken,
  runRepoAutoScanNow,
  setRepoAutoScan,
  startGithubActionInstall,
  updateProjectQualityGate,
  type IssueFeedbackVerdict,
  type QualityGateThresholdsDto,
  type RepoAutoScan,
} from "@/lib/api";
import { HERO_CORE_URL } from "@/lib/heroCoreUrl";
import OrgMembersPanel from "@/components/admin/OrgMembersPanel";
import RepoSetupWorkflow, { SETUP_STEPS, SetupStepNav, type SetupStepId } from "@/components/admin/RepoSetupWorkflow";
import { SectionTitle } from "@/components/AdminUi";
import { CodeGraphPanel, vizFromIssues } from "@/components/CodeGraphPanel";

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
  /** Present only after provision/add/rotate — never reloaded from Firestore. */
  ingestToken: string;
  ingestTokenHint?: string;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
  githubActionInstalledAt?: unknown;
  githubActionRepo?: string;
  autoScan?: RepoAutoScan;
  codeGraph?: {
    version?: number;
    generatedAt?: string;
    nodes: number;
    edges: number;
    functions: number;
    calls: number;
    imports: number;
    entries: number;
    hotspots: Array<{
      id: string;
      name: string;
      file: string;
      fanIn: number;
      fanOut: number;
      hopsToEntry: number | null;
    }>;
    links: Array<{ from: string; to: string; kind?: string }>;
  } | null;
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
  findingSource?: "native" | "imported" | null;
  tool?: string | null;
  originalRuleId?: string | null;
  engine?: string | null;
  isDependency?: boolean;
  alsoRuleIds?: string[];
  isNewCode?: boolean;
  assertiveness?: number | null;
  fpLikelihood?: number | null;
  triageScore?: number | null;
  likelyTruePositive?: boolean | null;
  triageMode?: string | null;
  gateSuppressed?: boolean | null;
  clusterId?: string | null;
  familySize?: number | null;
  outlierScore?: number | null;
  callGraph?: {
    functionId?: string | null;
    functionName?: string | null;
    fanIn?: number;
    fanOut?: number;
    hopsToEntry?: number | null;
    callers?: Array<{ id: string; name: string; file: string }>;
    callees?: Array<{ id: string; name: string; file: string }>;
    imports?: string[];
    priority?: number;
  } | null;
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

export default function ProjectWorkspace({
  orgId: orgIdProp,
  projectId: projectIdProp,
  initialRepoId,
  onNavigate,
}: {
  orgId: string;
  projectId: string;
  initialRepoId?: string | null;
  onNavigate?: (q: { orgId: string; projectId: string; repoId?: string | null }) => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const orgId = (orgIdProp || search.get("org") || "").trim();
  const projectId = (projectIdProp || search.get("id") || "").trim();
  const repoIdParam = (initialRepoId ?? search.get("repo") ?? "").trim();

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

  const [feedbackBusyFp, setFeedbackBusyFp] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [triageBusy, setTriageBusy] = useState(false);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  // Gráfico de manutenibilidade/segurança com drill-down até a lista de apontamentos
  const [drillOpen, setDrillOpen] = useState<"maintainability" | "security" | null>(null);
  const [issueFilter, setIssueFilter] = useState<{ label: string; severity?: string; issueType?: string } | null>(null);

  // Auto-scan (checagem automática periódica)
  const [autoScanBusy, setAutoScanBusy] = useState(false);
  const [autoScanError, setAutoScanError] = useState<string | null>(null);
  const [runNowBusy, setRunNowBusy] = useState(false);
  const [periodicityDraft, setPeriodicityDraft] = useState(7);

  const [gate, setGate] = useState<QualityGateThresholdsDto | null>(null);
  const [gateDefaults, setGateDefaults] = useState<QualityGateThresholdsDto | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

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

      try {
        const g = await getProjectQualityGate({ orgId, projectId });
        setGate(g.thresholds);
        setGateDefaults(g.defaults);
      } catch {
        setGate(null);
      }

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
          ingestToken: "",
          ingestTokenHint:
            (data as { ingestTokenHint?: string }).ingestTokenHint ??
            (typeof (data as { ingestToken?: string }).ingestToken === "string"
              ? String((data as { ingestToken?: string }).ingestToken).slice(-6)
              : ""),
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
    if (!repoIdParam) return;
    setSelectedRepoId((prev) => {
      if (prev === repoIdParam) return prev;
      if (repos.length > 0 && !repos.some((r) => r.repoId === repoIdParam)) return prev;
      return repoIdParam;
    });
  }, [repoIdParam, repos]);

  useEffect(() => {
    const gha = search.get("gha");
    if (gha === "ok") {
      goToTab("action");
      setGhaBanner({
        kind: "ok",
        text: "GitHub Action configurada: workflow + HERO_TOKEN + HERO_CORE_URL. O próximo push/PR já roda o scan.",
      });
      void load();
    } else if (gha === "error") {
      goToTab("action");
      setGhaBanner({
        kind: "error",
        text: search.get("msg") || "Não consegui instalar a Action. Verifique se você tem permissão de admin no repositório.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selectedRepo = repos.find((r) => r.repoId === selectedRepoId) ?? null;

  const browserFindings: FindingsBrowserItem[] = useMemo(
    () =>
      issues.map((issue) => ({
        id: issue.fingerprint,
        ruleId: issue.ruleId,
        severity: issue.severity,
        issueType: issue.issueType,
        message: issue.message,
        file: issue.file,
        line: issue.line,
        snippet: issue.snippet,
        sddTemplateId: issue.sddTemplateId,
        remediationEffortMin: issue.remediationEffortMin,
        risk: issue.risk,
        reason: issue.reason,
        howToFix: issue.howToFix,
        strategy: issue.strategy,
        constraints: issue.constraints,
        referenceExample: issue.referenceExample,
        cwe: issue.cwe,
        feedbackVerdict: issue.feedback?.[issue.feedback.length - 1]?.verdict ?? null,
        findingSource: issue.findingSource ?? null,
        tool: issue.tool ?? null,
        originalRuleId: issue.originalRuleId ?? null,
        engine: issue.engine ?? null,
        isDependency: issue.isDependency === true,
        alsoRuleIds: Array.isArray(issue.alsoRuleIds) ? issue.alsoRuleIds : [],
        isNewCode: issue.isNewCode === true,
        assertiveness: issue.assertiveness ?? null,
        fpLikelihood: issue.fpLikelihood ?? null,
        triageScore: issue.triageScore ?? null,
        likelyTruePositive: issue.likelyTruePositive ?? null,
        triageMode: issue.triageMode ?? null,
        gateSuppressed: issue.gateSuppressed === true,
        clusterId: issue.clusterId ?? null,
        familySize: issue.familySize ?? null,
        outlierScore: issue.outlierScore ?? null,
        callGraph: issue.callGraph ?? null,
      })),
    [issues],
  );

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
    if (onNavigate) {
      onNavigate({ orgId, projectId, repoId });
    } else {
      const q = new URLSearchParams();
      q.set("org", orgId);
      q.set("id", projectId);
      q.set("repo", repoId);
      router.replace(`/admin/?${q.toString()}#workspace`, { scroll: false });
    }
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
      setAddRepoError(err instanceof Error ? err.message : "Não consegui adicionar o repositório. Confira se a URL está correta e se a Action tem acesso.");
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
        text: err instanceof Error ? err.message : "Não consegui iniciar a autorização no GitHub. Nada foi alterado — tente de novo.",
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
      setFeedbackError(err instanceof Error ? err.message : "Não consegui registrar seu feedback. O apontamento continua no estado anterior.");
    } finally {
      setFeedbackBusyFp(null);
    }
  }

  async function handleExportFeedback() {
    setExportBusy(true);
    setOfflineError(null);
    setOfflineMsg(null);
    try {
      const res = await exportRuleforgeFeedback({ orgId, limit: 1000, onlyUnmerged: false });
      const blob = new Blob([JSON.stringify(res.examples, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ruleforge-feedback-${orgId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setOfflineMsg(
        `Exportados ${res.count} rótulo(s). Próximo: npm run fp:feedback-to-training -- <arquivo> reports/fp-training.json && npm run fp-ranker:train -- reports/fp-training.json`,
      );
    } catch (err) {
      setOfflineError(err instanceof Error ? err.message : "Não consegui exportar o feedback. Nenhum dado foi perdido — tente de novo.");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleTriageFile(file: File | null) {
    if (!file || !selectedRepo) return;
    setTriageBusy(true);
    setOfflineError(null);
    setOfflineMsg(null);
    try {
      const raw = JSON.parse(await file.text()) as {
        generatedAt?: string;
        findings?: Array<{
          id?: string;
          fingerprint?: string;
          triageScore: number;
          likelyTruePositive?: boolean;
          triageReason?: string;
          triageMode?: string;
        }>;
        version?: string;
        functions?: Array<{
          file: string;
          startLine: number;
          endLine: number;
          name?: string;
          clusterId: string;
          familySize: number;
          outlierScore: number;
        }>;
      };
      if (raw.functions?.length) {
        const res = await applyCodeEmbedClusters({
          orgId,
          projectId,
          repoId: selectedRepo.repoId,
          report: { version: raw.version, functions: raw.functions },
        });
        setOfflineMsg(`Famílias AST aplicadas: ${res.updated} issue(s) · ${res.functions} funções no relatório.`);
      } else if (raw.findings?.length) {
        const findings = raw.findings;
        const res = await applyOfflineTriage({
          orgId,
          projectId,
          repoId: selectedRepo.repoId,
          triage: { generatedAt: raw.generatedAt, findings },
        });
        setOfflineMsg(`Triagem aplicada: ${res.updated} issue(s) atualizado(s), ${res.skipped} ignorado(s).`);
      } else {
        throw new Error("Arquivo não reconhecido. Esperava um JSON com findings[] (triagem) ou functions[] (code-embed).");
      }
      const snap = await getDocs(
        query(
          collection(dbClient, "orgs", orgId, "projects", projectId, "repos", selectedRepo.repoId, "issues"),
          where("status", "==", "open"),
          limit(80),
        ),
      );
      const rows: RepoIssue[] = snap.docs.map((d) => {
        const data = d.data() as Omit<RepoIssue, "fingerprint">;
        return { fingerprint: d.id, ...data };
      });
      const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
      rows.sort((a, b) => order.indexOf(b.severity) - order.indexOf(a.severity));
      setIssues(rows);
    } catch (err) {
      setOfflineError(err instanceof Error ? err.message : "Não consegui aplicar o arquivo. Nada foi alterado no projeto.");
    } finally {
      setTriageBusy(false);
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
      setAutoScanError(err instanceof Error ? err.message : "Não consegui salvar a configuração. A checagem automática segue como estava.");
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
      setAutoScanError(err instanceof Error ? err.message : "Não consegui iniciar a checagem. A programação automática não foi afetada.");
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
      const { ingestToken, ingestTokenHint } = await rotateIngestToken({
        orgId,
        projectId,
        repoId: selectedRepo.repoId,
      });
      setRepos((prev) =>
        prev.map((r) =>
          r.repoId === selectedRepo.repoId ? { ...r, ingestToken, ingestTokenHint } : r,
        ),
      );
      setRotateConfirm(false);
      setGhaBanner({
        kind: "ok",
        text: "HERO_TOKEN rotacionado. Copie o token ou o comando gh abaixo e atualize o secret no GitHub (o valor completo só aparece agora).",
      });
      goToTab("action");
    } catch (err) {
      setRotateError(
        err instanceof Error
          ? err.message
          : "Não consegui rotacionar o token. O token atual continua válido.",
      );
    } finally {
      setRotating(false);
    }
  }

  function goToTab(next: Tab) {
    setTab(next);
    const q = new URLSearchParams(search.toString());
    if (orgId) q.set("org", orgId);
    if (projectId) q.set("id", projectId);
    if (selectedRepoId) q.set("repo", selectedRepoId);
    q.set("tab", next);
    router.replace(`/admin/?${q.toString()}#workspace`, { scroll: false });
  }

  function goSetupStep(delta: -1 | 1) {
    const idx = SETUP_STEPS.findIndex((s) => s.id === tab);
    const next = SETUP_STEPS[idx + delta];
    if (next) goToTab(next.id);
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
    ownerRepo && selectedRepo?.ingestToken
      ? buildGithubCliSetupScript({
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          heroCoreUrl: HERO_CORE_URL,
          ingestToken: selectedRepo.ingestToken,
        })
      : null;
  const heroTokenGhCmd =
    ownerRepo && selectedRepo?.ingestToken
      ? buildHeroTokenSecretCommand({
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
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
        HERO_SCANNER_CMD: "node <caminho-do-repo>/packages/scanner/dist/index.js",
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
          <p className="ex-eyebrow" style={{ margin: "0 0 0.35rem" }}>
            Projeto
          </p>
          <h1 className="ex-page-title">{project.name}</h1>
          <p className="hero-caption" style={{ margin: 0 }}>
            {project.repoCount} repositório(s) · selecione um repo e siga o fluxo de configuração
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
          <GatePill status={project.qualityGateStatus} />
          <RatingBadges p={project} />
        </div>
      </header>

      {gate && (
        <details className="ex-advanced" style={{ marginTop: "1.25rem" }}>
          <summary>Quality gate do projeto (avançado)</summary>
        <section className="hero-panel" style={{ padding: "1.25rem", marginTop: "0.75rem" }}>
          <SectionTitle as="h3">Limites do gate</SectionTitle>
          <p className="hero-caption" style={{ marginTop: 0 }}>
            Usado no ingest (Action/CLI). Defaults: cobertura {gateDefaults?.minNewCodeCoverage}% · blockers{" "}
            {gateDefaults?.maxNewBlockerIssues} · ratings {gateDefaults?.maxSecurityRating}/
            {gateDefaults?.maxMaintainabilityRating}.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!gate) return;
              setGateBusy(true);
              setGateError(null);
              setGateMsg(null);
              try {
                const res = await updateProjectQualityGate({ orgId, projectId, thresholds: gate });
                setGate(res.thresholds);
                setGateMsg("Gate salvo — vale no próximo ingest.");
              } catch (err) {
                setGateError(err instanceof Error ? err.message : "Falha ao salvar.");
              } finally {
                setGateBusy(false);
              }
            }}
            style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
          >
            {(
              [
                ["minNewCodeCoverage", "Cobertura mín. %"],
                ["minBranchCoverage", "Branch mín. % (0=pula)"],
                ["maxNewCodeDuplication", "Duplicação máx. %"],
                ["maxNewBlockerIssues", "Blockers novos máx."],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="hero-label">
                {label}
                <input
                  className="hero-input"
                  type="number"
                  value={gate[key]}
                  onChange={(ev) => setGate({ ...gate, [key]: Number(ev.target.value) })}
                />
              </label>
            ))}
            <label className="hero-label">
              Security máx.
              <select
                className="hero-input"
                value={gate.maxSecurityRating}
                onChange={(ev) => setGate({ ...gate, maxSecurityRating: ev.target.value })}
              >
                {["A", "B", "C", "D", "E"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="hero-label">
              Maintainability máx.
              <select
                className="hero-input"
                value={gate.maxMaintainabilityRating}
                onChange={(ev) => setGate({ ...gate, maxMaintainabilityRating: ev.target.value })}
              >
                {["A", "B", "C", "D", "E"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className="hero-btn hero-btn-accent" disabled={gateBusy}>
                {gateBusy ? "Salvando…" : "Salvar gate"}
              </button>
            </div>
          </form>
          {gateError && <div className="hero-error">{gateError}</div>}
          {gateMsg && <p className="hero-caption">{gateMsg}</p>}
        </section>
        </details>
      )}

      <OrgMembersPanel orgId={orgId} />

      <section className="hero-panel" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
        <div className="ch-section-title">
          <SectionTitle as="h2">Repositórios</SectionTitle>
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
        <div className="ex-setup-shell" style={{ marginTop: "1.5rem" }}>
          <RepoSetupWorkflow
            activeStep={tab as SetupStepId}
            hasRepo
            hasToken={!!selectedRepo.ingestToken}
            actionInstalled={!!selectedRepo.githubActionRepo}
            hasScan={selectedRepo.openIssues > 0 || issues.length > 0}
            repoName={selectedRepo.name}
            onSelectStep={(step) => goToTab(step)}
          />

          <div className="ex-setup-panel hero-panel" style={{ padding: "1.5rem", marginTop: "1rem" }}>
          {tab === "overview" && (
            <>
              <div className="ch-section-title">
                <SectionTitle as="h2">Saúde do repositório</SectionTitle>
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

              <CodeGraphPanel
                loading={issuesLoading}
                graph={
                  selectedRepo.codeGraph && selectedRepo.codeGraph.functions > 0
                    ? selectedRepo.codeGraph
                    : vizFromIssues(issues)
                }
              />

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

              <div
                className="hero-panel-sm"
                style={{ margin: "1.25rem 0", padding: "0.9rem 1rem", display: "grid", gap: "0.65rem" }}
              >
                <strong style={{ fontSize: "0.9rem" }}>Modelos offline (Fase 4)</strong>
                <p className="hero-caption" style={{ margin: 0 }}>
                  LLM não entra no gate do PR. Exporte feedback para treinar o fp-ranker, ou aplique triagem
                  Triagem offline / heurística gerada por <code>npm run triage:offline</code>.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <button
                    type="button"
                    className="hero-btn hero-btn-outline"
                    style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }}
                    disabled={exportBusy}
                    onClick={() => void handleExportFeedback()}
                  >
                    {exportBusy ? "Exportando…" : "Exportar feedback (treino)"}
                  </button>
                  <label
                    className="hero-btn hero-btn-outline"
                    style={{
                      padding: "0.4rem 0.9rem",
                      fontSize: "0.8rem",
                      cursor: triageBusy || !selectedRepo ? "not-allowed" : "pointer",
                      opacity: triageBusy || !selectedRepo ? 0.6 : 1,
                    }}
                  >
                    {triageBusy ? "Aplicando…" : "Aplicar triage / code-embed JSON"}
                    <input
                      type="file"
                      accept="application/json,.json"
                      hidden
                      disabled={triageBusy || !selectedRepo}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        e.target.value = "";
                        void handleTriageFile(f);
                      }}
                    />
                  </label>
                </div>
                <p className="hero-caption" style={{ margin: 0 }}>
                  Também aceita <code>reports/code-embed-clusters.json</code> (
                  <code>npm run code-embed:cluster</code>).
                </p>
                {offlineMsg && <p className="hero-caption" style={{ margin: 0, color: "var(--ok, #2a7)" }}>{offlineMsg}</p>}
                {offlineError && <div className="hero-error">{offlineError}</div>}
              </div>

              <FindingsBrowser
                title="Apontamentos"
                subtitle="Lista simples — clique para abrir a ficha. Use ← → no modal e marque confirmado ou falso positivo."
                findings={browserFindings}
                loading={issuesLoading}
                emptyMessage="Nenhum apontamento aberto ainda. Rode a Action ou o scan no IDE e envie o relatório."
                externalFilter={issueFilter}
                onClearExternalFilter={() => setIssueFilter(null)}
                enableFeedback
                feedbackBusyId={feedbackBusyFp}
                feedbackError={feedbackError}
                onFeedback={async (item, verdict) => {
                  const issue = issues.find((i) => i.fingerprint === item.id);
                  if (issue) await handleIssueFeedback(issue, verdict);
                }}
              />

            </>
          )}

          {tab === "vscode" && (
            <>
              <SectionTitle>Plugin VS Code / Cursor</SectionTitle>
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
            </>
          )}

          {tab === "action" && (
            <>
              <SectionTitle>Token e GitHub Action</SectionTitle>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.35rem" }}>
                1) Gere o HERO_TOKEN · 2) Copie para o GitHub · 3) Instale a Action
              </p>

              {ghaBanner && (
                <div className={ghaBanner.kind === "ok" ? "hero-success" : "hero-error"} style={{ marginBottom: "1.25rem" }} role="status">
                  {ghaBanner.text}
                </div>
              )}

              <HeroTokenCard
                hint={selectedRepo.ingestTokenHint || selectedRepo.ingestToken.slice(-6) || ""}
                fullToken={selectedRepo.ingestToken}
                ghCommand={heroTokenGhCmd}
                rotating={rotating}
                rotateConfirm={rotateConfirm}
                rotateError={rotateError}
                onRotate={handleRotate}
                onCancelConfirm={() => setRotateConfirm(false)}
              />

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
                  ) : (
                    <p className="hero-muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                      Rotacione o <code>HERO_TOKEN</code> acima para gerar o script com o token completo.
                    </p>
                  )}
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
                          <code style={{ fontSize: "0.78rem" }}>
                            ••••••••{selectedRepo.ingestTokenHint || selectedRepo.ingestToken.slice(-6) || "??????"}
                          </code>
                          {selectedRepo.ingestToken ? (
                            <CopyButton text={selectedRepo.ingestToken} label="Copiar token" />
                          ) : (
                            <span className="hero-muted" style={{ fontSize: "0.8rem" }}>
                              Token só é exibido na criação/rotação — rotacione para obter um novo.
                            </span>
                          )}
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
            </>
          )}

          {tab === "mcp" && (
            <>
              <SectionTitle>MCP — conectar seu agente de IA</SectionTitle>
              <p className="hero-caption" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
                get_generation_context · get_active_rules · get_issues · get_sdd_spec · run_scan · submit_fix_result
              </p>

              <div
                style={{
                  marginBottom: "1.5rem",
                  padding: "1rem 1.1rem",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--surface-2, transparent)",
                }}
              >
                <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem" }}>Entrada de contexto de geração</h3>
                <p className="hero-caption" style={{ marginTop: 0, marginBottom: "0.65rem" }}>
                  Peça ao agente para chamar <code>get_generation_context</code> com esta entrada antes de gerar
                  código — ele busca as regras CodeHero e injeta no contexto. Configuração completa em{" "}
                  <strong>Projetos → Integração MCP</strong>.
                </p>
                <div className="hero-copyrow">
                  <pre className="hero-code" style={{ maxHeight: 100 }}>
                    {`Use o MCP CodeHero. Chame get_generation_context com entry:
"Buscar as regras de avaliação de código (CodeHero) e aplicar no contexto que está sendo gerado"
Aplique o retorno no contexto e só então gere/edite o código.`}
                  </pre>
                  <CopyButton
                    text={`Use o MCP CodeHero. Chame get_generation_context com entry:\n"Buscar as regras de avaliação de código (CodeHero) e aplicar no contexto que está sendo gerado"\nAplique o retorno no contexto e só então gere/edite o código.`}
                  />
                </div>
              </div>

              <div className="hero-step">
                <span className="hero-step-num">1</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 0.6rem" }}>
                    Compile o servidor: <code>npm run build -w codehero-mcp</code>
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

              <HeroTokenCard
                dense
                hint={selectedRepo.ingestTokenHint || selectedRepo.ingestToken.slice(-6) || ""}
                fullToken={selectedRepo.ingestToken}
                ghCommand={heroTokenGhCmd}
                rotating={rotating}
                rotateConfirm={rotateConfirm}
                rotateError={rotateError}
                onRotate={handleRotate}
                onCancelConfirm={() => setRotateConfirm(false)}
              />
            </>
          )}

          <SetupStepNav
            activeStep={tab as SetupStepId}
            hasRepo
            onPrev={() => goSetupStep(-1)}
            onNext={() => goSetupStep(1)}
          />
          </div>
        </div>
      )}
    </main>
  );
}
