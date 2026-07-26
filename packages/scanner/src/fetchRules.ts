import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { RULES, type HeroRule } from "@codehero/contracts";

export interface ActiveRulesBundle {
  version: string;
  generatedAt?: string;
  canonicalCount?: number;
  overlayCount?: number;
  rules: HeroRule[];
  source: "server" | "cache" | "bundled";
}

const DEFAULT_SERVER = "https://YOUR_API_BASE_URL";

/**
 * Resolve the active rule set: server (preferred) → disk cache → bundled RULES.
 * Always attempts the server first so dress codes and package updates propagate.
 */
export async function resolveActiveRules(opts: {
  serverUrl?: string;
  token?: string;
  orgId?: string;
  projectId?: string;
  cacheDir?: string;
  /** If true, never skip the network (ignore soft TTL). Default true for scan. */
  forceRefresh?: boolean;
}): Promise<ActiveRulesBundle> {
  const server = (opts.serverUrl ?? process.env.HERO_CORE_URL ?? DEFAULT_SERVER).replace(/\/$/, "");
  const token = opts.token ?? process.env.HERO_TOKEN ?? "";
  const orgId = opts.orgId ?? process.env.HERO_ORG_ID ?? "";
  const projectId = opts.projectId ?? process.env.HERO_PROJECT_ID ?? "";
  const cacheDir = opts.cacheDir ?? join(process.cwd(), ".codehero-cache");
  const cachePath = join(cacheDir, "active-rules.json");

  const cached = readCache(cachePath);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cached?.version) headers["If-None-Match"] = `"${cached.version}"`;

  const url = new URL(`${server}/getActiveRules`);
  if (orgId && projectId) {
    url.searchParams.set("orgId", orgId);
    url.searchParams.set("projectId", projectId);
  }

  try {
    const res = await fetch(url, { headers });
    if (res.status === 304 && cached) {
      return { ...cached, source: "cache" };
    }
    if (!res.ok) {
      throw new Error(`getActiveRules HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      version: string;
      generatedAt?: string;
      canonicalCount?: number;
      overlayCount?: number;
      rules: HeroRule[];
    };
    if (!Array.isArray(body.rules) || body.rules.length === 0) {
      throw new Error("getActiveRules returned empty rules");
    }
    const bundle: ActiveRulesBundle = {
      version: body.version,
      generatedAt: body.generatedAt,
      canonicalCount: body.canonicalCount,
      overlayCount: body.overlayCount,
      rules: body.rules,
      source: "server",
    };
    writeCache(cachePath, bundle);
    return bundle;
  } catch (err) {
    if (cached) {
      console.error(`[codehero] rules fetch failed, using cache ${cached.version}:`, err);
      return { ...cached, source: "cache" };
    }
    console.error("[codehero] rules fetch failed, using bundled RULES:", err);
    return {
      version: "bundled",
      rules: RULES,
      canonicalCount: RULES.length,
      overlayCount: 0,
      source: "bundled",
    };
  }
}

export function loadRulesFile(path: string): HeroRule[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { rules?: HeroRule[] } | HeroRule[];
  const rules = Array.isArray(raw) ? raw : raw.rules;
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error(`Invalid rules file: ${path}`);
  }
  return rules;
}

function readCache(path: string): ActiveRulesBundle | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as ActiveRulesBundle;
    if (!raw?.version || !Array.isArray(raw.rules) || raw.rules.length === 0) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(path: string, bundle: ActiveRulesBundle): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          version: bundle.version,
          generatedAt: bundle.generatedAt,
          canonicalCount: bundle.canonicalCount,
          overlayCount: bundle.overlayCount,
          rules: bundle.rules,
        },
        null,
        0,
      ),
    );
  } catch {
    /* ignore cache write errors */
  }
}
