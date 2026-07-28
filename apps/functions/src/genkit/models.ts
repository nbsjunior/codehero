import { logger } from "firebase-functions";

// ---------------------------------------------------------------------------
// Model routing for the offline ruleforge esteira.
//
// The founding principle is unchanged: the model PROPOSES, the deterministic
// evaluator DECIDES. That is what makes model choice a cost optimization
// rather than a correctness risk — a bad proposal dies on its F1, not in
// production. So route each role to the cheapest model that clears the bar,
// and spend only where reasoning quality actually pays.
//
// Roles are routed independently and every one is env-overridable, so a route
// can be re-pointed without a deploy of new code.
// ---------------------------------------------------------------------------

// Ativar o provedor Anthropic exige DOIS passos, nesta ordem:
//   1. firebase functions:secrets:set ANTHROPIC_API_KEY --project YOUR_CLOUD_PROJECT_ID
//   2. declarar defineSecret("ANTHROPIC_API_KEY") e somar ao `secrets: []`
//      de ruleforgeDaily / runRuleforgeDaily / submitDressCode
// A ordem importa: vincular um secret que ainda nao existe no Secret Manager
// faz `firebase deploy --non-interactive` falhar. Sem a chave, resolveRoute
// degrada tudo para o Gemini e a esteira roda exatamente como hoje.

export type ModelRole =
  /** Daily batch of rule proposals. High volume, low unit value — the evaluator filters. */
  | "batch"
  /** Rules the L0 regex can barely express: taint shapes, COBOL, SQL semantics. */
  | "hard-rule"
  /** False-positive triage. Needs the surrounding code, not just the line. */
  | "triage"
  /** Turns a finding's ficha into an applied patch. Highest perceived value. */
  | "autofix";

export type ModelProvider = "google" | "anthropic";

export interface ModelRoute {
  provider: ModelProvider;
  model: string;
  /** Used only by the Anthropic provider; Gemini ignores it. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Cost per million tokens at time of writing, for the record:
 *   gemini-2.5-flash  — cheapest, fine when the evaluator is the real judge
 *   claude-haiku-4-5  — $1 / $5
 *   claude-sonnet-5   — $3 / $15
 *   claude-opus-4-8   — $5 / $25
 */
const DEFAULT_ROUTES: Record<ModelRole, ModelRoute> = {
  batch: { provider: "google", model: "gemini-2.5-flash" },
  "hard-rule": { provider: "anthropic", model: "claude-opus-4-8", effort: "high" },
  triage: { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" },
  autofix: { provider: "anthropic", model: "claude-opus-4-8", effort: "xhigh" },
};

const ENV_KEY: Record<ModelRole, string> = {
  batch: "HERO_MODEL_BATCH",
  "hard-rule": "HERO_MODEL_HARD_RULE",
  triage: "HERO_MODEL_TRIAGE",
  autofix: "HERO_MODEL_AUTOFIX",
};

/** `anthropic:claude-opus-4-8:high` or `google:gemini-2.5-flash`. */
function parseRoute(raw: string): ModelRoute | null {
  const [provider, model, effort] = raw.split(":").map((s) => s.trim());
  if (provider !== "google" && provider !== "anthropic") return null;
  if (!model) return null;
  return {
    provider,
    model,
    ...(effort ? { effort: effort as ModelRoute["effort"] } : {}),
  };
}

export function anthropicAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Resolves the route for a role, applying two fallbacks in order:
 * an env override, then — if the route needs Anthropic and no key is
 * configured — the batch route, so a missing secret degrades the esteira
 * to today's behaviour instead of breaking it.
 */
export function resolveRoute(role: ModelRole): ModelRoute {
  const override = process.env[ENV_KEY[role]]?.trim();
  const parsed = override ? parseRoute(override) : null;
  if (override && !parsed) {
    logger.warn("ignoring malformed model route override", { role, override });
  }
  const route = parsed ?? DEFAULT_ROUTES[role];

  if (route.provider === "anthropic" && !anthropicAvailable()) {
    const fallback = DEFAULT_ROUTES.batch;
    logger.warn("ANTHROPIC_API_KEY not configured — falling back", {
      role,
      wanted: `${route.provider}:${route.model}`,
      using: `${fallback.provider}:${fallback.model}`,
    });
    return fallback;
  }

  return route;
}

/** Snapshot of every route, for the admin panel and for run logs. */
export function describeRouting(): Array<{ role: ModelRole; resolved: ModelRoute; isFallback: boolean }> {
  const roles: ModelRole[] = ["batch", "hard-rule", "triage", "autofix"];
  return roles.map((role) => {
    const wanted = DEFAULT_ROUTES[role];
    const resolved = resolveRoute(role);
    return {
      role,
      resolved,
      isFallback: wanted.provider === "anthropic" && resolved.provider !== "anthropic",
    };
  });
}
