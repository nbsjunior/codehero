import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { db } from "./firebase.ts";

export interface OrgQuotas {
  maxRepos: number;
  maxBuildsPerMonth: number;
  buildsThisMonth: number;
  buildsMonthKey: string;
}

const DEFAULTS: OrgQuotas = {
  maxRepos: 100_000,
  maxBuildsPerMonth: 100_000,
  buildsThisMonth: 0,
  buildsMonthKey: "",
};

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export async function getOrgQuotas(orgId: string): Promise<OrgQuotas> {
  const snap = await db.doc(`orgs/${orgId}/settings/quotas`).get();
  const data = (snap.data() ?? {}) as Partial<OrgQuotas>;
  const key = monthKey();
  const buildsThisMonth = data.buildsMonthKey === key ? (data.buildsThisMonth ?? 0) : 0;
  return {
    maxRepos: data.maxRepos ?? DEFAULTS.maxRepos,
    maxBuildsPerMonth: data.maxBuildsPerMonth ?? DEFAULTS.maxBuildsPerMonth,
    buildsThisMonth,
    buildsMonthKey: key,
  };
}

/** Throws if org is over monthly build quota. Call before heavy ingest work. */
export async function assertBuildQuota(orgId: string): Promise<OrgQuotas> {
  const q = await getOrgQuotas(orgId);
  if (q.buildsThisMonth >= q.maxBuildsPerMonth) {
    throw new HttpsError(
      "resource-exhausted",
      `Cota mensal de builds atingida (${q.maxBuildsPerMonth}/mês). Contate o admin da plataforma.`,
    );
  }
  return q;
}

export async function incrementBuildQuota(orgId: string): Promise<void> {
  const key = monthKey();
  const ref = db.doc(`orgs/${orgId}/settings/quotas`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const sameMonth = data.buildsMonthKey === key;
    tx.set(
      ref,
      {
        maxRepos: data.maxRepos ?? DEFAULTS.maxRepos,
        maxBuildsPerMonth: data.maxBuildsPerMonth ?? DEFAULTS.maxBuildsPerMonth,
        buildsMonthKey: key,
        buildsThisMonth: sameMonth ? (data.buildsThisMonth ?? 0) + 1 : 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function assertRepoQuota(orgId: string, currentRepoCount: number): Promise<void> {
  const q = await getOrgQuotas(orgId);
  if (currentRepoCount >= q.maxRepos) {
    throw new HttpsError(
      "resource-exhausted",
      `Cota de repositórios atingida (${q.maxRepos}). Contate o admin da plataforma.`,
    );
  }
}

const PREVIEW_DAILY_LIMIT = 20;

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Per-USER daily cap on the one-click portal preview (`previewRepoScan`) —
 * distinct from the per-org build quota, since a preview can run with no
 * org/project context at all (anyone signed in, on any public repo). Without
 * this, an unmetered signup + unmetered preview is a free unlimited-compute
 * abuse path.
 */
export async function assertPreviewQuota(uid: string): Promise<void> {
  const snap = await db.doc(`users/${uid}/limits/preview`).get();
  const data = snap.data() ?? {};
  const key = dayKey();
  const count = data.dayKey === key ? (data.count ?? 0) : 0;
  if (count >= PREVIEW_DAILY_LIMIT) {
    throw new HttpsError(
      "resource-exhausted",
      `Limite diário de prévias atingido (${PREVIEW_DAILY_LIMIT}/dia). Tente de novo amanhã, ou adicione o repositório a um projeto para escanear sem esse limite.`,
    );
  }
}

export async function incrementPreviewQuota(uid: string): Promise<void> {
  const key = dayKey();
  const ref = db.doc(`users/${uid}/limits/preview`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const sameDay = data.dayKey === key;
    tx.set(
      ref,
      { dayKey: key, count: sameDay ? (data.count ?? 0) + 1 : 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
}

/**
 * Gate for resource-consuming actions (previewRepoScan): self-signup has no
 * CAPTCHA, so a scripted mass-registration is trivial — requiring a verified
 * email before a fresh account can spend compute closes that loop without
 * adding any bot-detection friction to normal signup.
 */
export async function requireVerifiedEmail(uid: string): Promise<void> {
  const user = await getAuth().getUser(uid);
  if (!user.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "Confirme seu e-mail antes de rodar uma prévia — reenviamos o link na barra de aviso do portal.",
    );
  }
}
