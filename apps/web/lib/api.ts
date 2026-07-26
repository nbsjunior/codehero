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
  const fn = httpsCallable<typeof input, PreviewRepoScanResult>(functions, "previewRepoScan");
  const res = await fn(input);
  return res.data;
}
