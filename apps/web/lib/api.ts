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
