"use client";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebaseFunctions";

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
  try {
    const res = await fn();
    return res.data.isAdmin;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao verificar admin da plataforma."));
  }
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

export async function adminListAllProjects(input?: {
  cursor?: string;
  limit?: number;
}): Promise<{ orgCount: number; projects: AdminProjectRow[]; nextCursor: string | null }> {
  const fn = httpsCallable<
    typeof input,
    { orgCount: number; projects: AdminProjectRow[]; nextCursor: string | null }
  >(functions, "adminListAllProjects");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar projetos da plataforma."));
  }
}

export interface PlatformSummary {
  orgCount: number;
  projectCount: number;
  repoCount: number;
  debtMinutes: number;
  openIssues: number;
  failingGates: number;
  worstSecurityRating: string;
  worstMaintainabilityRating: string;
  bySecurityRating: Record<string, number>;
  byMaintainabilityRating: Record<string, number>;
  byQualityGate: Record<string, number>;
}

/** Cheap platform-wide KPIs (aggregation queries, not a fan-out read) — see admin.ts. */
export async function adminGetPlatformSummary(): Promise<PlatformSummary> {
  const fn = httpsCallable<undefined, PlatformSummary>(functions, "adminGetPlatformSummary");
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar o resumo da plataforma."));
  }
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

export interface AdminCreatedRepo {
  repoId: string;
  name: string;
  repoUrl: string;
  ingestToken: string;
}

export async function adminCreateProject(input: {
  orgId?: string;
  orgName?: string;
  projectName: string;
  repoUrls?: string[];
}): Promise<{ orgId: string; projectId: string; slug: string; repos: AdminCreatedRepo[] }> {
  const fn = httpsCallable<
    typeof input,
    { orgId: string; projectId: string; slug: string; repos: AdminCreatedRepo[] }
  >(functions, "adminCreateProject");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao criar o workspace."));
  }
}

export interface OrgQuotasView {
  maxRepos: number;
  maxBuildsPerMonth: number;
  buildsThisMonth: number;
  buildsMonthKey: string;
}

export async function getOrgQuotasCallable(input: {
  orgId: string;
}): Promise<{ orgId: string; orgName: string; quotas: OrgQuotasView }> {
  const fn = httpsCallable<typeof input, { orgId: string; orgName: string; quotas: OrgQuotasView }>(
    functions,
    "getOrgQuotasCallable",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar cotas."));
  }
}

export async function setOrgQuotas(input: {
  orgId: string;
  maxRepos?: number;
  maxBuildsPerMonth?: number;
}): Promise<{ orgId: string; quotas: OrgQuotasView }> {
  const fn = httpsCallable<typeof input, { orgId: string; quotas: OrgQuotasView }>(functions, "setOrgQuotas");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao salvar cotas."));
  }
}

export async function runRuleforgeDailyNow(): Promise<{
  ranAt: string;
  promotedCount: number;
  rejectedCount: number;
  seed: number;
  proposalsEnqueued?: number;
  newRuleProposals?: number;
}> {
  const fn = httpsCallable<
    undefined,
    {
      ranAt: string;
      promotedCount: number;
      rejectedCount: number;
      seed: number;
      proposalsEnqueued?: number;
      newRuleProposals?: number;
    }
  >(functions, "runRuleforgeDaily", { timeout: 540_000 });
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao rodar a esteira agora."));
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
  requireApproval?: boolean;
}): Promise<SubmitDressCodeResult & { proposalsQueued?: number }> {
  const fn = httpsCallable<typeof input, SubmitDressCodeResult & { proposalsQueued?: number }>(
    functions,
    "submitDressCode",
    { timeout: 120_000 },
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao interpretar o dress code."));
  }
}

export async function listDressCodes(input: {
  scope: "global" | "project";
  orgId?: string;
  projectId?: string;
}): Promise<{ items: Array<Record<string, unknown>> }> {
  const fn = httpsCallable<typeof input, { items: Array<Record<string, unknown>> }>(functions, "listDressCodes");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao listar dress codes."));
  }
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
  filesScanned?: number;
  truncated?: boolean;
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

export interface PlatformOpsConfig {
  purgeEnabled: boolean;
  retentionDays: number;
  purgeIntervalDays: number;
  purgeBatchSize: number;
  purgeLastRunAt: string | null;
  deferIssueWrites: boolean;
  queueAutoRetry: boolean;
  queueStuckMinutes: number;
  queueLastRepairAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface IngestQueueCounts {
  pending: number;
  running: number;
  failed: number;
  done: number;
}

export async function getPlatformOpsSettings(): Promise<{
  config: PlatformOpsConfig;
  queue: IngestQueueCounts;
}> {
  const fn = httpsCallable<undefined, { config: PlatformOpsConfig; queue: IngestQueueCounts }>(
    functions,
    "getPlatformOpsSettings",
  );
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar configurações de operação."));
  }
}

export async function setPlatformOpsSettings(
  input: Partial<
    Pick<
      PlatformOpsConfig,
      | "purgeEnabled"
      | "retentionDays"
      | "purgeIntervalDays"
      | "purgeBatchSize"
      | "deferIssueWrites"
      | "queueAutoRetry"
      | "queueStuckMinutes"
    >
  >,
): Promise<PlatformOpsConfig> {
  const fn = httpsCallable<typeof input, { config: PlatformOpsConfig }>(functions, "setPlatformOpsSettings");
  try {
    const res = await fn(input);
    return res.data.config;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao salvar configurações de operação."));
  }
}

export async function repairIngestQueues(): Promise<{
  requeued: number;
  markedSuperseded: number;
  queue: IngestQueueCounts;
}> {
  const fn = httpsCallable<
    undefined,
    { requeued: number; markedSuperseded: number; queue: IngestQueueCounts }
  >(functions, "repairIngestQueues", { timeout: 300_000 });
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao corrigir as filas de ingest."));
  }
}

export async function runDetailPurgeNow(): Promise<{
  analysesDeleted: number;
  issuesDeleted: number;
  outcomesDeleted: number;
  specsDeleted: number;
  jobsCleaned: number;
  sarifDeleted: number;
}> {
  const fn = httpsCallable<
    undefined,
    {
      analysesDeleted: number;
      issuesDeleted: number;
      outcomesDeleted: number;
      specsDeleted: number;
      jobsCleaned: number;
      sarifDeleted: number;
    }
  >(functions, "runDetailPurgeNow", { timeout: 540_000 });
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao executar o expurgo agora."));
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

export type RuleProposalKind = "evolve" | "new_rule";
export type RuleProposalFamily = "security" | "dress" | "smell";
export type RuleProposalStatus = "pending" | "approved" | "rejected";

export interface RuleProposalRow {
  id: string;
  kind: RuleProposalKind;
  family: RuleProposalFamily;
  status: RuleProposalStatus;
  title: string;
  rationale: string;
  ruleId: string;
  scope?: "global" | "project";
  orgId?: string | null;
  projectId?: string | null;
  baselinePattern?: { regex: string; flags?: string; unless?: string } | null;
  proposedPattern?: { regex: string; flags?: string; unless?: string } | null;
  proposedRule?: {
    id: string;
    name: string;
    message: string;
    severity: string;
    type: string;
    pattern?: { regex: string; unless?: string };
  } | null;
  corpusCases?: Array<{ id: string; code: string; expected: "match" | "no_match"; note?: string }>;
  metrics?: {
    baselineF1?: number;
    bestF1?: number;
    mutationIds?: string[];
    ownPrecision?: number;
    ownRecall?: number;
    ownF1?: number;
    ownCases?: number;
    crossCorpusMatches?: number;
    crossCorpusSampleSize?: number;
  };
  source?: string;
  runDay?: string | null;
  createdAt?: string | null;
}

export async function listRuleProposals(input?: {
  status?: RuleProposalStatus | "all";
  limit?: number;
}): Promise<{ items: RuleProposalRow[]; counts: { pending: number; shown: number } }> {
  const fn = httpsCallable<
    { status?: string; limit?: number },
    { items: RuleProposalRow[]; counts: { pending: number; shown: number } }
  >(functions, "listRuleProposals");
  try {
    const res = await fn(input ?? { status: "pending" });
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao listar propostas da esteira."));
  }
}

export async function reviewRuleProposal(input: {
  proposalId: string;
  decision: "approved" | "rejected";
  note?: string;
}): Promise<{ proposalId: string; status: string; ruleId?: string }> {
  const fn = httpsCallable<typeof input, { proposalId: string; status: string; ruleId?: string }>(
    functions,
    "reviewRuleProposal",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao revisar a proposta."));
  }
}

export interface CveWatchlistEntryRow {
  ghsaId: string;
  cveId: string | null;
  ecosystem: string;
  language: string;
  severity: string;
  summary: string;
  cweIds: string[];
  publishedAt: string;
}

/** CVEs/advisories currently grounding the daily new-rule proposal prompt — see cveSync.ts. */
export async function listCveWatchlist(limit = 100): Promise<{ entries: CveWatchlistEntryRow[] }> {
  const fn = httpsCallable<{ limit: number }, { entries: CveWatchlistEntryRow[] }>(functions, "listCveWatchlist");
  try {
    const res = await fn({ limit });
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar os CVEs monitorados."));
  }
}

export async function runCveWatchlistSyncNow(): Promise<{ fetched: number; ecosystems: string[] }> {
  const fn = httpsCallable<undefined, { fetched: number; ecosystems: string[] }>(functions, "runCveWatchlistSyncNow");
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao sincronizar os CVEs."));
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

export interface AdminRuleCause {
  ruleId: string;
  message: string;
  severity: string;
  count: number;
}

export interface AdminRepoFindingCount {
  repoId: string;
  repoName: string;
  projectId?: string;
  projectName: string;
  orgId?: string;
  orgName: string;
  count: number;
}

export interface AdminIssuesResult {
  total: number;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  items: AdminIssueRow[];
  topCauses: AdminRuleCause[];
  mostFindings: AdminRepoFindingCount[];
  leastFindings: AdminRepoFindingCount[];
  nextCursor?: string | null;
  truncated?: boolean;
}

export async function adminListAllIssues(input?: {
  cursor?: string;
  limit?: number;
}): Promise<AdminIssuesResult> {
  const fn = httpsCallable<{ cursor?: string; limit?: number } | undefined, AdminIssuesResult>(
    functions,
    "adminListAllIssues",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao carregar os apontamentos."));
  }
}

export type IssueFeedbackVerdict = "false_positive" | "confirmed" | "fix_accepted" | "fix_rejected";

export async function flagIssueFeedback(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  fingerprint: string;
  verdict: IssueFeedbackVerdict;
  note?: string;
}): Promise<void> {
  const fn = httpsCallable<typeof input, { ok: true }>(functions, "flagIssueFeedback");
  try {
    await fn(input);
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao registrar o feedback."));
  }
}

/** Exporta rótulos confirmado/FP para treino do ranqueador (`hero-fp-ranker train`). */
export async function exportRuleforgeFeedback(input: {
  orgId: string;
  limit?: number;
  onlyUnmerged?: boolean;
}): Promise<{ orgId: string; count: number; examples: unknown[] }> {
  const fn = httpsCallable<typeof input, { orgId: string; count: number; examples: unknown[] }>(
    functions,
    "exportRuleforgeFeedback",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao exportar feedback."));
  }
}

/** Aplica JSON de triagem offline (Foundation-Sec / heuristic) aos issues do repo. */
export async function applyOfflineTriage(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  triage: {
    generatedAt?: string;
    findings: Array<{
      id?: string;
      fingerprint?: string;
      triageScore: number;
      likelyTruePositive?: boolean;
      triageReason?: string;
      triageMode?: string;
    }>;
  };
}): Promise<{ ok: true; updated: number; skipped: number }> {
  const fn = httpsCallable<typeof input, { ok: true; updated: number; skipped: number }>(
    functions,
    "applyOfflineTriage",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao aplicar triagem offline."));
  }
}

/** Aplica relatório code-embed (famílias AST / K-Means) aos issues. */
export async function applyCodeEmbedClusters(input: {
  orgId: string;
  projectId: string;
  repoId: string;
  report: {
    version?: string;
    functions: Array<{
      file: string;
      startLine: number;
      endLine: number;
      name?: string;
      clusterId: string;
      familySize: number;
      outlierScore: number;
    }>;
  };
}): Promise<{ ok: true; updated: number; functions: number }> {
  const fn = httpsCallable<typeof input, { ok: true; updated: number; functions: number }>(
    functions,
    "applyCodeEmbedClusters",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao aplicar famílias code-embed."));
  }
}

export type MotorRuleSource = "core" | "platform" | "project";

export interface MotorRuleRow {
  id: string;
  name: string;
  message: string;
  severity: string;
  type: string;
  category: string | null;
  languages: string[];
  remediationEffortMin: number;
  patternRegex: string | null;
  source: MotorRuleSource;
  sourceLabel: string;
  implementation?: "core" | "sonar-port" | "structural" | "stub" | "overlay" | null;
  sonarKey?: string | null;
  canDelete: boolean;
  orgId: string | null;
  projectId: string | null;
  orgName: string | null;
  projectName: string | null;
  dressCodeId: string | null;
  active: boolean;
}

export interface MotorRuleGroup {
  id: string;
  label: string;
  count: number;
  rules: MotorRuleRow[];
}

export interface MotorRulesTotals {
  core: number;
  sonar?: number;
  sonarLive?: number;
  sonarStub?: number;
  platform: number;
  project: number;
  all: number;
}

export interface LintCoverageGap {
  id: string;
  title: string;
  family: "security" | "dress" | "smell";
  languages: string[];
}

/** Taxonomy coverage that also grounds the daily rule-proposal prompt. */
export interface MotorLintCoverage {
  covered: number;
  total: number;
  gaps: LintCoverageGap[];
}

export async function listMotorRules(): Promise<{
  groups: MotorRuleGroup[];
  totals: MotorRulesTotals;
  lintCoverage?: MotorLintCoverage;
}> {
  const fn = httpsCallable<
    undefined,
    { groups: MotorRuleGroup[]; totals: MotorRulesTotals; lintCoverage?: MotorLintCoverage }
  >(functions, "listMotorRules");
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao listar as regras do motor."));
  }
}

export async function deleteOverlayRule(input: {
  ruleId: string;
  source: "platform" | "project";
  orgId?: string;
  projectId?: string;
}): Promise<{ deleted: boolean; ruleId: string }> {
  const fn = httpsCallable<typeof input, { deleted: boolean; ruleId: string }>(functions, "deleteOverlayRule");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao excluir a regra."));
  }
}

export interface PlatformUserRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  isPlatformAdmin: boolean;
}

export async function adminListUsers(input?: {
  pageToken?: string;
  pageSize?: number;
}): Promise<{ users: PlatformUserRow[]; pageToken: string | null }> {
  const fn = httpsCallable<typeof input, { users: PlatformUserRow[]; pageToken: string | null }>(
    functions,
    "adminListUsers",
  );
  try {
    const res = await fn(input ?? {});
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao listar usuários."));
  }
}

export async function adminSetPlatformAdmin(input: {
  targetUid: string;
  isAdmin: boolean;
}): Promise<{ targetUid: string; isPlatformAdmin: boolean }> {
  const fn = httpsCallable<typeof input, { targetUid: string; isPlatformAdmin: boolean }>(
    functions,
    "adminSetPlatformAdmin",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao alterar perfil de admin."));
  }
}

export async function adminUpdateUser(input: {
  targetUid: string;
  displayName?: string;
  email?: string;
  disabled?: boolean;
}): Promise<{ uid: string; email: string | null; displayName: string | null; disabled: boolean }> {
  const fn = httpsCallable<
    typeof input,
    { uid: string; email: string | null; displayName: string | null; disabled: boolean }
  >(functions, "adminUpdateUser");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao atualizar usuário."));
  }
}

export async function adminResetUserPassword(input: {
  targetUid: string;
  newPassword?: string;
  generateResetLink?: boolean;
}): Promise<{ targetUid: string; passwordUpdated: boolean; resetLink: string | null }> {
  const fn = httpsCallable<
    typeof input,
    { targetUid: string; passwordUpdated: boolean; resetLink: string | null }
  >(functions, "adminResetUserPassword");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao redefinir senha."));
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

export interface QualityGateThresholdsDto {
  minNewCodeCoverage: number;
  maxNewCodeDuplication: number;
  maxNewBlockerIssues: number;
  maxSecurityRating: string;
  maxMaintainabilityRating: string;
}

export async function getProjectQualityGate(input: {
  orgId: string;
  projectId: string;
}): Promise<{ thresholds: QualityGateThresholdsDto; defaults: QualityGateThresholdsDto }> {
  const fn = httpsCallable<
    typeof input,
    { thresholds: QualityGateThresholdsDto; defaults: QualityGateThresholdsDto }
  >(functions, "getProjectQualityGate");
  const res = await fn(input);
  return res.data;
}

export async function updateProjectQualityGate(input: {
  orgId: string;
  projectId: string;
  thresholds: QualityGateThresholdsDto;
}): Promise<{ ok: boolean; thresholds: QualityGateThresholdsDto }> {
  const fn = httpsCallable<typeof input, { ok: boolean; thresholds: QualityGateThresholdsDto }>(
    functions,
    "updateProjectQualityGate",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao salvar o quality gate."));
  }
}

export interface OrgMemberRow {
  uid: string;
  role: string;
  email: string | null;
  displayName: string | null;
  joinedAt: string | null;
}

export interface OrgInviteRow {
  inviteId: string;
  email: string;
  role: string;
  createdAt: string | null;
  expiresAt: string | null;
}

export async function listOrgMembers(orgId: string): Promise<{
  members: OrgMemberRow[];
  invites: OrgInviteRow[];
}> {
  const fn = httpsCallable<{ orgId: string }, { members: OrgMemberRow[]; invites: OrgInviteRow[] }>(
    functions,
    "listOrgMembers",
  );
  try {
    const res = await fn({ orgId });
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao listar membros."));
  }
}

export async function inviteOrgMember(input: {
  orgId: string;
  email: string;
  role?: "admin" | "member";
}): Promise<{ inviteId: string; email: string; role: string; acceptToken: string; expiresAt: string }> {
  const fn = httpsCallable<
    typeof input,
    { inviteId: string; email: string; role: string; acceptToken: string; expiresAt: string }
  >(functions, "inviteOrgMember");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao convidar."));
  }
}

export async function acceptOrgInvite(input: {
  orgId: string;
  inviteId: string;
  token: string;
}): Promise<{ ok: boolean; orgId: string; role: string }> {
  const fn = httpsCallable<typeof input, { ok: boolean; orgId: string; role: string }>(
    functions,
    "acceptOrgInvite",
  );
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao aceitar convite."));
  }
}

export async function removeOrgMember(input: {
  orgId: string;
  memberUid: string;
}): Promise<{ ok: boolean }> {
  const fn = httpsCallable<typeof input, { ok: boolean }>(functions, "removeOrgMember");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao remover membro."));
  }
}

export async function setOrgMemberRole(input: {
  orgId: string;
  memberUid: string;
  role: "admin" | "member";
}): Promise<{ ok: boolean }> {
  const fn = httpsCallable<typeof input, { ok: boolean }>(functions, "setOrgMemberRole");
  try {
    const res = await fn(input);
    return res.data;
  } catch (err) {
    throw new Error(formatCallableError(err, "Falha ao alterar role."));
  }
}
