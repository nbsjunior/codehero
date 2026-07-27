"use client";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export interface ProvisionResult {
  orgId: string;
  projectId: string;
  slug?: string;
  repoId: string | null;
  ingestToken: string | null;
}

export async function provisionProject(input: {
  orgName: string;
  projectName: string;
  repoUrl?: string;
}): Promise<ProvisionResult> {
  const fn = httpsCallable<typeof input, ProvisionResult>(functions, "provisionProject");
  const res = await fn(input);
  return res.data;
}

export async function checkPlatformAdmin(): Promise<boolean> {
  const fn = httpsCallable<undefined, { isAdmin: boolean }>(functions, "checkPlatformAdmin");
  const res = await fn();
  return res.data.isAdmin;
}

export async function rotateIngestToken(input: {
  orgId: string;
  projectId: string;
  repoId: string;
}): Promise<string> {
  const fn = httpsCallable<typeof input, { ingestToken: string }>(functions, "rotateIngestToken");
  const res = await fn(input);
  return res.data.ingestToken;
}

export interface RepoAutoScan {
  enabled: boolean;
  periodicityDays: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface RepoRow {
  repoId: string;
  name: string;
  repoUrl: string | null;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
  lastAnalyzedAt: string | null;
  autoScan?: RepoAutoScan;
}

export interface AdminProjectRow {
  orgId: string;
  orgName: string;
  projectId: string;
  name: string;
  repoCount: number;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
  lastAnalyzedAt: string | null;
  repos: RepoRow[];
}

export async function adminListAllProjects(): Promise<{ orgCount: number; projects: AdminProjectRow[] }> {
  const fn = httpsCallable<undefined, { orgCount: number; projects: AdminProjectRow[] }>(
    functions,
    "adminListAllProjects",
  );
  const res = await fn();
  return res.data;
}

export async function addRepoToProject(input: {
  orgId: string;
  projectId: string;
  repoUrl: string;
  name?: string;
}): Promise<{ repoId: string; ingestToken: string }> {
  const fn = httpsCallable<typeof input, { repoId: string; ingestToken: string }>(functions, "addRepoToProject");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao adicionar repositório."));
  }
}

export async function listProjectRepos(input: { orgId: string; projectId: string }): Promise<{ repos: RepoRow[] }> {
  const fn = httpsCallable<typeof input, { repos: RepoRow[] }>(functions, "listProjectRepos");
  const res = await fn(input);
  return res.data;
}

export interface DressCodeRule {
  id: string;
  name: string;
  message: string;
  severity: string;
  category: string;
  pattern: { regex: string; unless?: string };
}

export interface SubmitDressCodeResult {
  dressCodeId: string;
  summary: string;
  status: string;
  scope: string;
  ruleCount: number;
  rules: DressCodeRule[];
}

export async function submitDressCode(input: {
  naturalLanguage: string;
  scope: "global" | "project";
  orgId?: string;
  projectId?: string;
  activate?: boolean;
}): Promise<SubmitDressCodeResult> {
  const fn = httpsCallable<typeof input, SubmitDressCodeResult>(functions, "submitDressCode");
  const res = await fn(input);
  return res.data;
}

export async function listDressCodes(input: {
  scope: "global" | "project";
  orgId?: string;
  projectId?: string;
}): Promise<{ items: Array<Record<string, unknown>> }> {
  const fn = httpsCallable<typeof input, { items: Array<Record<string, unknown>> }>(functions, "listDressCodes");
  const res = await fn(input);
  return res.data;
}

export interface PreviewFindingFicha {
  risk: string;
  reason: string;
  howToFix: string;
  strategy: string;
  constraints: string[];
  referenceExample?: { before: string; after: string };
  cwe: string[];
  effortMin?: number;
}

export interface PreviewFinding {
  ruleId: string;
  ruleName?: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  snippet: string;
  sddTemplateId?: string | null;
  ficha?: PreviewFindingFicha;
}

export interface PreviewRecommendation {
  ruleId: string;
  ruleName: string;
  severity: string;
  count: number;
  risk: string;
  reason: string;
  strategy: string;
  guidance: string;
  constraints: string[];
  referenceExample?: { before: string; after: string };
  files: Array<{ file: string; line: number }>;
}

export interface PreviewRepoScanResult {
  repo: string;
  findingCount: number;
  bySeverity: Record<string, number>;
  topFindings: PreviewFinding[];
  recommendations?: PreviewRecommendation[];
  overlayRuleCount: number;
  rulesVersion?: string;
  scannedAt: string;
}

export async function previewRepoScan(input: {
  repoUrl: string;
  orgId?: string;
  projectId?: string;
}): Promise<PreviewRepoScanResult> {
  const fn = httpsCallable<typeof input, PreviewRepoScanResult>(functions, "previewRepoScan", {
    timeout: 300_000,
  });
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha na prévia do repositório."));
  }
}

export interface StartGithubActionInstallResult {
  authorizeUrl: string;
  owner: string;
  repo: string;
  projectSlug?: string;
  callbackUrl?: string;
}

export async function startGithubActionInstall(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  returnOrigin?: string;
}): Promise<StartGithubActionInstallResult> {
  const fn = httpsCallable<typeof input, StartGithubActionInstallResult>(
    functions,
    "startGithubActionInstall",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao iniciar instalação da GitHub Action."));
  }
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function listFeatureFlags(): Promise<{ flags: FeatureFlag[] }> {
  const fn = httpsCallable<undefined, { flags: FeatureFlag[] }>(functions, "listFeatureFlags");
  const res = await fn();
  return res.data;
}

export async function setFeatureFlag(input: { key: string; enabled: boolean; description?: string }): Promise<void> {
  const fn = httpsCallable<typeof input, { ok: true }>(functions, "setFeatureFlag");
  try {
    await fn(input);
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao salvar o feature flag."));
  }
}

export interface RuleforgeRuleOutcome {
  ruleId: string;
  decision: "PROMOTED" | "REJECTED";
  reason: string;
  baselineF1: number;
  bestF1: number;
  mutationIds: string[];
  proposedMutationIds: string[];
}

export interface RuleforgeRun {
  day: string;
  ranAt: string;
  seed: number;
  promotedCount: number;
  rejectedCount: number;
  rules: RuleforgeRuleOutcome[];
}

export async function listRuleforgeRuns(limit = 30): Promise<{ runs: RuleforgeRun[] }> {
  const fn = httpsCallable<{ limit: number }, { runs: RuleforgeRun[] }>(functions, "listRuleforgeRuns");
  try {
    const res = await fn({ limit });
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar a esteira de inteligência agêntica."));
  }
}

export async function setRepoAutoScan(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  enabled: boolean;
  periodicityDays?: number;
}): Promise<{ enabled: boolean; periodicityDays: number; nextRunAt: string | null }> {
  const fn = httpsCallable<typeof input, { enabled: boolean; periodicityDays: number; nextRunAt: string | null }>(
    functions,
    "setRepoAutoScan",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao salvar a configuração de checagem automática."));
  }
}

export async function runRepoAutoScanNow(input: {
  orgId: string;
  projectId: string;
  repoId: string;
}): Promise<void> {
  const fn = httpsCallable<typeof input, { ok: true }>(functions, "runRepoAutoScanNow", { timeout: 300_000 });
  try {
    await fn(input);
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao rodar a checagem automática agora."));
  }
}

export interface AdminIssueRow {
  issueId: string;
  repoId: string;
  repoName: string;
  projectId: string | null;
  projectName: string;
  orgId: string | null;
  orgName: string;
  ruleId: string;
  severity: string;
  issueType: string;
  message: string;
  file: string;
  line: number;
  source: "github-action" | "auto-scan" | "cli";
  lastSeen: string | null;
}

export interface AdminIssuesResult {
  total: number;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  items: AdminIssueRow[];
}

export async function adminListAllIssues(): Promise<AdminIssuesResult> {
  const fn = httpsCallable<undefined, AdminIssuesResult>(functions, "adminListAllIssues");
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar os apontamentos da esteira."));
  }
}

function formatCallableError(err: unknown, fallback: string): string {
  const fe = err as { code?: string; message?: string; details?: unknown };
  const code = fe?.code ?? "";
  const raw = (fe?.message ?? "").trim();
  const details =
    typeof fe?.details === "string"
      ? fe.details
      : fe?.details && typeof fe.details === "object" && "message" in (fe.details as object)
        ? String((fe.details as { message?: unknown }).message ?? "")
        : "";

  // Firebase strips messages for status INTERNAL — surface a usable fallback.
  if (/^(internal|INTERNAL)$/i.test(raw) || code === "functions/internal") {
    if (details && !/^(internal|INTERNAL)$/i.test(details)) return details;
    return `${fallback} Erro interno no runner (sem detalhe no cliente). Tente de novo.`;
  }
  if (code === "functions/unauthenticated") return "Faça login novamente e tente de novo.";
  if (code === "functions/not-found") return raw.replace(/^.*?:\s*/, "") || "Recurso não encontrado.";
  if (
    code === "functions/unavailable" ||
    code === "functions/invalid-argument" ||
    code === "functions/failed-precondition" ||
    code === "functions/permission-denied"
  ) {
    return raw.replace(/^.*?:\s*/, "") || fallback;
  }
  if (raw && !/^(internal|INTERNAL)$/i.test(raw)) {
    return raw.replace(/^Firebase:\s*/i, "").replace(/\s*\(.*\)\s*$/, "").trim() || fallback;
  }
  return fallback;
}
