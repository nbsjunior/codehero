import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
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
