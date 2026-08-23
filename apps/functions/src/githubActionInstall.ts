import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  CODEHERO_PORTAL_ORIGIN,
  CODEHERO_PUBLIC_API_BASE,
  codeHeroGithubOAuthCallbackUrl,
  slugifyProjectName,
} from "@codehero/contracts";
import { db, projectRef, repoRef } from "./lib/firebase.ts";
import { installCodeHeroOnRepo, parseGithubOwnerRepo } from "./lib/githubApi.ts";
import { readIngestTokenPlain } from "./lib/ingestToken.ts";

/** Optional — set via Cloud Run env / Secret Manager after OAuth App exists. */
function githubOAuthClientId(): string {
  return (process.env.GITHUB_OAUTH_CLIENT_ID ?? "").trim();
}
function githubOAuthClientSecret(): string {
  return (process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "").trim();
}

const STATE_TTL_MS = 15 * 60 * 1000;
const ALLOWED_RETURN_ORIGINS = new Set([
  CODEHERO_PORTAL_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

interface StartInput {
  orgId: string;
  projectId: string;
  repoId: string;
  returnOrigin?: string;
}

/**
 * Customer-visible OAuth callback on the portal.
 *
 * GitHub OAuth Apps allow only ONE registered Authorization callback URL, so
 * every tenant shares `https://codehero.web.app/projeto/githubOauthCallback`
 * (Hosting rewrite → this function). The customer's project slug/name lives in
 * OAuth `state` and in the post-install redirect — clients never see Firebase.
 */
function oauthCallbackUrl(): string {
  return codeHeroGithubOAuthCallbackUrl("projeto");
}

function sanitizeReturnOrigin(raw: string | undefined): string {
  const origin = (raw ?? CODEHERO_PORTAL_ORIGIN).replace(/\/$/, "");
  if (ALLOWED_RETURN_ORIGINS.has(origin)) return origin;
  return CODEHERO_PORTAL_ORIGIN;
}

function slugFromRequestPath(path: string): string | null {
  // /{slug}/githubOauthCallback or /codehero/{slug}/githubOauthCallback (emulator)
  const m = path.match(/\/([^/]+)\/githubOauthCallback\/?$/i);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

async function ensureProjectSlug(orgId: string, projectId: string, name: string): Promise<string> {
  const pRef = projectRef(orgId, projectId);
  const snap = await pRef.get();
  const existing = (snap.data()?.slug as string | undefined)?.trim();
  if (existing) return existing;

  const base = slugifyProjectName(name || "projeto");
  let slug = base;
  for (let i = 0; i < 6; i++) {
    const slugRef = db.doc(`projectSlugs/${slug}`);
    const taken = await slugRef.get();
    if (!taken.exists || (taken.data()?.orgId === orgId && taken.data()?.projectId === projectId)) {
      await slugRef.set({ orgId, projectId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await pRef.update({ slug });
      return slug;
    }
    slug = `${base}-${randomBytes(2).toString("hex")}`;
  }
  slug = `${base}-${projectId.slice(0, 6)}`;
  await db.doc(`projectSlugs/${slug}`).set({ orgId, projectId, updatedAt: FieldValue.serverTimestamp() });
  await pRef.update({ slug });
  return slug;
}

/**
 * Starts GitHub OAuth for one-click Action install (repo admins / engineers).
 * Platform Firebase details stay server-side — the browser only sees portal URLs.
 */
export const startGithubActionInstall = onCall<StartInput>({ cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

    const { orgId, projectId, repoId } = request.data ?? ({} as StartInput);
    if (!orgId || !projectId || !repoId) {
      throw new HttpsError("invalid-argument", "orgId, projectId and repoId are required");
    }

    const clientId = githubOAuthClientId();
    if (!clientId) {
      throw new HttpsError(
        "failed-precondition",
        "Integração GitHub ainda não habilitada neste ambiente. Use o atalho com gh CLI ou o deep link.",
      );
    }

    const platformAdmin = (await db.doc(`platformAdmins/${uid}`).get()).exists;
    if (!platformAdmin) {
      const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
      if (!member.exists) throw new HttpsError("permission-denied", "not a member of this org");
    }

    const pSnap = await projectRef(orgId, projectId).get();
    if (!pSnap.exists) throw new HttpsError("not-found", "project not found");

    const rSnap = await repoRef(orgId, projectId, repoId).get();
    if (!rSnap.exists) throw new HttpsError("not-found", "repo not found");

    const pdata = pSnap.data() ?? {};
    const rdata = rSnap.data() ?? {};
    const repoUrl = (rdata.repoUrl as string | null | undefined) ?? null;
    const parsed = repoUrl ? parseGithubOwnerRepo(repoUrl) : null;
    if (!parsed) {
      throw new HttpsError(
        "failed-precondition",
        "Este repositório do projeto está sem uma URL de GitHub válida.",
      );
    }

    const projectSlug = await ensureProjectSlug(orgId, projectId, String(pdata.name ?? "projeto"));
    const returnOrigin = sanitizeReturnOrigin(request.data?.returnOrigin);
    const state = randomBytes(24).toString("hex");
    const expiresAt = Timestamp.fromMillis(Date.now() + STATE_TTL_MS);
    const redirectUri = oauthCallbackUrl();

    await db.doc(`githubOAuthStates/${state}`).set({
      uid,
      orgId,
      projectId,
      repoId,
      projectSlug,
      projectName: String(pdata.name ?? projectSlug),
      owner: parsed.owner,
      repo: parsed.repo,
      returnOrigin,
      redirectUri,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "repo workflow",
      state,
      allow_signup: "false",
    });

    return {
      authorizeUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
      owner: parsed.owner,
      repo: parsed.repo,
      projectSlug,
      callbackUrl: redirectUri,
    };
});

/**
 * Portal OAuth callback (Hosting rewrite from /{slug}/githubOauthCallback).
 * Exchanges the code, installs workflow + secrets, redirects back to the project.
 */
export const githubOAuthCallback = onRequest({ cors: false }, async (req, res) => {
    const fail = (origin: string, message: string, orgId?: string, projectId?: string, slug?: string) => {
      const url = new URL("/projects", origin);
      if (orgId) url.searchParams.set("org", orgId);
      if (projectId) url.searchParams.set("id", projectId);
      if (slug) url.searchParams.set("slug", slug);
      url.searchParams.set("tab", "action");
      url.searchParams.set("gha", "error");
      url.searchParams.set("msg", message.slice(0, 180));
      res.redirect(302, url.toString());
    };

    try {
      if (req.method !== "GET") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const oauthError = typeof req.query.error === "string" ? req.query.error : "";
      const pathSlug = slugFromRequestPath(req.path || req.url || "");

      if (!state) {
        fail(CODEHERO_PORTAL_ORIGIN, "Estado OAuth ausente.");
        return;
      }

      const stateRef = db.doc(`githubOAuthStates/${state}`);
      const stateSnap = await stateRef.get();
      if (!stateSnap.exists) {
        fail(CODEHERO_PORTAL_ORIGIN, "Sessão OAuth expirada. Tente de novo no portal.");
        return;
      }

      const st = stateSnap.data() as {
        uid: string;
        orgId: string;
        projectId: string;
        repoId: string;
        projectSlug: string;
        projectName?: string;
        owner: string;
        repo: string;
        returnOrigin: string;
        redirectUri: string;
        expiresAt?: Timestamp;
      };
      const returnOrigin = sanitizeReturnOrigin(st.returnOrigin);
      const failSt = (message: string) =>
        fail(returnOrigin, message, st.orgId, st.projectId, st.projectSlug);

      // Gateway path is always /projeto/…; optional /{slug}/… also accepted if Hosting routes it.
      if (pathSlug && pathSlug !== "projeto" && pathSlug !== st.projectSlug) {
        failSt("URL do callback não corresponde ao projeto.");
        return;
      }

      if (st.expiresAt && st.expiresAt.toMillis() < Date.now()) {
        await stateRef.delete().catch(() => undefined);
        failSt("Sessão OAuth expirada. Tente de novo.");
        return;
      }

      if (oauthError) {
        await stateRef.delete().catch(() => undefined);
        failSt(oauthError === "access_denied" ? "Autorização GitHub negada." : oauthError);
        return;
      }

      if (!code) {
        failSt("Código OAuth ausente.");
        return;
      }

      const clientId = githubOAuthClientId();
      const clientSecret = githubOAuthClientSecret();
      if (!clientId || !clientSecret) {
        failSt("Integração GitHub não configurada no servidor.");
        return;
      }

      const redirectUri = st.redirectUri || oauthCallbackUrl();

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
        scope?: string;
      };
      if (!tokenJson.access_token) {
        await stateRef.delete().catch(() => undefined);
        failSt(tokenJson.error_description || tokenJson.error || "Falha ao obter token GitHub.");
        return;
      }

      const platformAdmin = (await db.doc(`platformAdmins/${st.uid}`).get()).exists;
      if (!platformAdmin) {
        const member = await db.doc(`orgs/${st.orgId}/members/${st.uid}`).get();
        if (!member.exists) {
          await stateRef.delete().catch(() => undefined);
          failSt("Sem permissão nesta organização.");
          return;
        }
      }

      const pRef = projectRef(st.orgId, st.projectId);
      const rRef = repoRef(st.orgId, st.projectId, st.repoId);
      const [pSnap, rSnap] = await Promise.all([pRef.get(), rRef.get()]);
      if (!pSnap.exists || !rSnap.exists) {
        await stateRef.delete().catch(() => undefined);
        failSt("Projeto ou repositório não encontrado.");
        return;
      }

      const ingestToken = await readIngestTokenPlain(rRef);
      if (!ingestToken) {
        await stateRef.delete().catch(() => undefined);
        failSt("Repositório sem token de ingestão — rotacione o token no portal.");
        return;
      }

      let installed;
      try {
        installed = await installCodeHeroOnRepo({
          githubToken: tokenJson.access_token,
          owner: st.owner,
          repo: st.repo,
          orgId: st.orgId,
          projectId: st.projectId,
          repoId: st.repoId,
          ingestToken,
          // CI talks to the portal API gateway — never the raw Functions host.
          heroCoreUrl: CODEHERO_PUBLIC_API_BASE,
        });
      } catch (installErr) {
        await stateRef.delete().catch(() => undefined);
        failSt(installErr instanceof Error ? installErr.message : "Falha ao instalar a Action.");
        return;
      }

      await rRef.update({
        githubActionInstalledAt: FieldValue.serverTimestamp(),
        githubActionInstalledBy: st.uid,
        githubActionRepo: `${installed.owner}/${installed.repo}`,
        githubActionDefaultBranch: installed.defaultBranch,
      });
      await pRef.update({ slug: st.projectSlug });

      await stateRef.delete().catch(() => undefined);

      const ok = new URL("/projects", returnOrigin);
      ok.searchParams.set("org", st.orgId);
      ok.searchParams.set("id", st.projectId);
      ok.searchParams.set("repo", st.repoId);
      ok.searchParams.set("slug", st.projectSlug);
      ok.searchParams.set("tab", "action");
      ok.searchParams.set("gha", "ok");
      res.redirect(302, ok.toString());
    } catch (err) {
      console.error("githubOAuthCallback failed", err);
      const message = err instanceof Error ? err.message : "Falha ao instalar a Action.";
      fail(CODEHERO_PORTAL_ORIGIN, message);
    }
});
