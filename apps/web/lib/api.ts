"use client";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export interface ProvisionResult {
  orgId: string;
  projectId: string;
  ingestToken: string;
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

export interface AdminProjectRow {
  orgId: string;
  orgName: string;
  projectId: string;
  name: string;
  repoUrl: string | null;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
  lastAnalyzedAt: string | null;
}

export async function adminListAllProjects(): Promise<{ orgCount: number; projects: AdminProjectRow[] }> {
  const fn = httpsCallable<undefined, { orgCount: number; projects: AdminProjectRow[] }>(
    functions,
    "adminListAllProjects",
  );
  const res = await fn();
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

export interface PreviewFinding {
  ruleId: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  snippet: string;
}

export interface PreviewRepoScanResult {
  repo: string;
  findingCount: number;
  bySeverity: Record<string, number>;
  topFindings: PreviewFinding[];
  overlayRuleCount: number;
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
  if (code === "functions/unauthenticated") return "Faça login novamente para rodar a prévia.";
  if (code === "functions/not-found") return "Repositório não encontrado ou privado.";
  if (code === "functions/unavailable" || code === "functions/invalid-argument") {
    return raw.replace(/^.*?:\s*/, "") || fallback;
  }
  if (raw && !/^(internal|INTERNAL)$/i.test(raw)) {
    return raw.replace(/^Firebase:\s*/i, "").replace(/\s*\(.*\)\s*$/, "").trim() || fallback;
  }
  return fallback;
}
