import { createRequire } from "node:module";
import { buildCodeHeroWorkflowYaml, CODEHERO_PUBLIC_API_BASE } from "@codehero/contracts";

// tweetsodium is CJS; createRequire avoids the broken ESM build of libsodium-wrappers
// that Firebase's function analyzer hits at deploy time.
const require = createRequire(import.meta.url);
const sodium = require("tweetsodium") as {
  seal: (message: Uint8Array, key: Uint8Array) => Uint8Array;
};

const WORKFLOW_PATH = ".github/workflows/codehero.yml";
const GH_API = "https://api.github.com";

export function parseGithubOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/.*)?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, "") };
}

async function ghJson<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T; message?: string }> {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T = {} as T;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = { message: text } as T;
    }
  }
  const message =
    data && typeof data === "object" && "message" in data
      ? String((data as { message?: unknown }).message ?? "")
      : "";
  return { ok: res.ok, status: res.status, data, message: message || undefined };
}

function encryptSecret(publicKeyBase64: string, secretValue: string): string {
  const keyBytes = Buffer.from(publicKeyBase64, "base64");
  const messageBytes = Buffer.from(secretValue, "utf8");
  const sealed = sodium.seal(messageBytes, keyBytes);
  return Buffer.from(sealed).toString("base64");
}

export interface InstallGithubActionResult {
  owner: string;
  repo: string;
  defaultBranch: string;
  workflowPath: string;
  workflowCreated: boolean;
  secretSet: boolean;
  variableSet: boolean;
}

/**
 * Creates/updates the CodeHero workflow file and configures HERO_TOKEN (secret)
 * + HERO_CORE_URL (variable) on the target repository.
 */
export async function installCodeHeroOnRepo(input: {
  githubToken: string;
  owner: string;
  repo: string;
  orgId: string;
  projectId: string;
  repoId: string;
  ingestToken: string;
  heroCoreUrl?: string;
}): Promise<InstallGithubActionResult> {
  const { githubToken, owner, repo, orgId, projectId, repoId, ingestToken } = input;
  const heroCoreUrl = input.heroCoreUrl ?? CODEHERO_PUBLIC_API_BASE;
  const repoPath = `/repos/${owner}/${repo}`;

  const repoRes = await ghJson<{ default_branch?: string; message?: string }>(
    githubToken,
    "GET",
    repoPath,
  );
  if (!repoRes.ok) {
    throw new Error(repoRes.message || `Não foi possível acessar ${owner}/${repo} (HTTP ${repoRes.status}).`);
  }
  const defaultBranch = repoRes.data.default_branch?.trim() || "main";

  const yaml = buildCodeHeroWorkflowYaml(orgId, projectId, repoId, { defaultBranch });
  const contentB64 = Buffer.from(yaml, "utf8").toString("base64");

  const existing = await ghJson<{ sha?: string; message?: string }>(
    githubToken,
    "GET",
    `${repoPath}/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(defaultBranch)}`,
  );

  const putBody: Record<string, string> = {
    message: existing.ok
      ? "chore: update CodeHero GitHub Action workflow"
      : "chore: add CodeHero GitHub Action workflow",
    content: contentB64,
    branch: defaultBranch,
  };
  if (existing.ok && existing.data.sha) putBody.sha = existing.data.sha;

  const putRes = await ghJson<{ content?: { path?: string }; message?: string }>(
    githubToken,
    "PUT",
    `${repoPath}/contents/${WORKFLOW_PATH}`,
    putBody,
  );
  if (!putRes.ok) {
    throw new Error(putRes.message || `Falha ao gravar ${WORKFLOW_PATH} (HTTP ${putRes.status}).`);
  }

  const keyRes = await ghJson<{ key?: string; key_id?: string; message?: string }>(
    githubToken,
    "GET",
    `${repoPath}/actions/secrets/public-key`,
  );
  if (!keyRes.ok || !keyRes.data.key || !keyRes.data.key_id) {
    throw new Error(
      keyRes.message ||
        "Não foi possível obter a public key de Actions secrets. Confirme permissão no repositório.",
    );
  }

  const encrypted = encryptSecret(keyRes.data.key, ingestToken);
  const secretRes = await ghJson<{ message?: string }>(
    githubToken,
    "PUT",
    `${repoPath}/actions/secrets/HERO_TOKEN`,
    {
      encrypted_value: encrypted,
      key_id: keyRes.data.key_id,
    },
  );
  if (!secretRes.ok) {
    throw new Error(secretRes.message || `Falha ao definir secret HERO_TOKEN (HTTP ${secretRes.status}).`);
  }

  const varGet = await ghJson<{ name?: string }>(
    githubToken,
    "GET",
    `${repoPath}/actions/variables/HERO_CORE_URL`,
  );
  let variableOk = false;
  if (varGet.ok) {
    const patch = await ghJson<{ message?: string }>(
      githubToken,
      "PATCH",
      `${repoPath}/actions/variables/HERO_CORE_URL`,
      { name: "HERO_CORE_URL", value: heroCoreUrl },
    );
    variableOk = patch.ok;
    if (!patch.ok) {
      throw new Error(patch.message || `Falha ao atualizar variable HERO_CORE_URL (HTTP ${patch.status}).`);
    }
  } else {
    const create = await ghJson<{ message?: string }>(
      githubToken,
      "POST",
      `${repoPath}/actions/variables`,
      { name: "HERO_CORE_URL", value: heroCoreUrl },
    );
    variableOk = create.ok;
    if (!create.ok) {
      throw new Error(create.message || `Falha ao criar variable HERO_CORE_URL (HTTP ${create.status}).`);
    }
  }

  return {
    owner,
    repo,
    defaultBranch,
    workflowPath: WORKFLOW_PATH,
    workflowCreated: !existing.ok,
    secretSet: true,
    variableSet: variableOk,
  };
}
