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

// ATIVAR MODELOS VIA VERTEX (self-host / ops):
//   1. Habilitar os modelos desejados no Model Garden do SEU projeto cloud
//   2. Conceder `roles/aiplatform.user` à service account do runtime
//   3. Definir HERO_VERTEX_ENABLED=true no ambiente das Functions
//
// A ordem importa: sem os passos 1 e 2 a chamada volta 403/404.
// Por isso `vertexAvailable()` exige opt-in EXPLÍCITO.
//
// Enquanto a flag estiver desligada, tudo degrada para o modelo padrão
// configurado em GEMINI_MODEL / HERO_MODEL_*. A API direta de outros
// provedores segue disponível como override (`HERO_MODEL_*=…` + secrets).

export type ModelRole =
  /** Daily batch of rule proposals. High volume, low unit value — the evaluator filters. */
  | "batch"
  /** Rules the L0 regex can barely express: taint shapes, COBOL, SQL semantics. */
  | "hard-rule"
  /** False-positive triage. Needs the surrounding code, not just the line. */
  | "triage"
  /** Turns a finding's ficha into an applied patch. Highest perceived value. */
  | "autofix";

/**
 * `vertex` e `anthropic` servem os MESMOS modelos Claude — muda só por onde
 * a conta passa. O padrão é `vertex`: cobrança na fatura do GCP que já existe,
 * autenticação pela service account do runtime, sem fornecedor novo e sem
 * secret para criar. `anthropic` (API direta, exige ANTHROPIC_API_KEY) fica
 * disponível como override.
 */
export type ModelProvider = "google" | "vertex" | "anthropic";

export interface ModelRoute {
  provider: ModelProvider;
  model: string;
  /** Só vale para Claude (vertex/anthropic); o Gemini ignora. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Cost per million tokens (input / output) at time of writing:
 *   gemini-2.5-flash  — o mais barato; suficiente onde o avaliador é o juiz
 *   claude-haiku-4-5  — $1 / $5
 *   claude-sonnet-5   — $3 / $15
 *
 * Opus foi deliberadamente deixado de fora: no volume desta esteira (um lote
 * por dia) ele custaria ~50% a mais que o Sonnet sem ganho que o avaliador
 * determinístico consiga medir. Se algum dia um papel justificar, basta a
 * variável de ambiente — não precisa deploy.
 */
const DEFAULT_ROUTES: Record<ModelRole, ModelRoute> = {
  // Volume alto, valor unitário baixo: cada mutação é medida no corpus antes
  // de virar qualquer coisa, então o modelo mais barato basta.
  batch: { provider: "google", model: "gemini-2.5-flash" },
  // Síntese de regra nova e tradução de dress code — o diferencial do produto.
  "hard-rule": { provider: "vertex", model: "claude-sonnet-5", effort: "high" },
  // Julgamento simples sobre um trecho curto; é onde o Haiku rende melhor.
  // Sem `effort`: o parâmetro é da família 4.6+ e o Haiku 4.5 o rejeita.
  triage: { provider: "vertex", model: "claude-haiku-4-5" },
  // Escreve o patch: precisa de qualidade, mas roda sob demanda, não em lote.
  autofix: { provider: "vertex", model: "claude-sonnet-5", effort: "xhigh" },
};

const ENV_KEY: Record<ModelRole, string> = {
  batch: "HERO_MODEL_BATCH",
  "hard-rule": "HERO_MODEL_HARD_RULE",
  triage: "HERO_MODEL_TRIAGE",
  autofix: "HERO_MODEL_AUTOFIX",
};

const PROVIDERS: ModelProvider[] = ["google", "vertex", "anthropic"];

/** `vertex:claude-sonnet-5:high` ou `google:gemini-2.5-flash`. */
function parseRoute(raw: string): ModelRoute | null {
  const [provider, model, effort] = raw.split(":").map((s) => s.trim());
  if (!PROVIDERS.includes(provider as ModelProvider)) return null;
  if (!model) return null;
  return {
    provider: provider as ModelProvider,
    model,
    ...(effort ? { effort: effort as ModelRoute["effort"] } : {}),
  };
}

/** Projeto GCP do runtime — as Functions já expõem isto sozinhas. */
export function vertexProjectId(): string | null {
  return (
    process.env.HERO_VERTEX_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    null
  );
}

/** `global` não tem o prêmio de 10% dos endpoints regionais. */
export function vertexRegion(): string {
  return process.env.HERO_VERTEX_REGION?.trim() || "global";
}

/**
 * Vertex exige opt-in EXPLÍCITO, mesmo o projeto GCP estando sempre presente
 * no runtime. Sem isso, o primeiro deploy passaria a chamar o Model Garden
 * antes de alguém ter habilitado o Claude lá ou dado `aiplatform.user` à
 * service account — e a esteira quebraria sozinha. Com o opt-in desligado
 * tudo degrada para o Gemini, exatamente como hoje.
 */
export function vertexAvailable(): boolean {
  return process.env.HERO_VERTEX_ENABLED?.trim() === "true" && Boolean(vertexProjectId());
}

export function anthropicAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function providerAvailable(provider: ModelProvider): boolean {
  if (provider === "vertex") return vertexAvailable();
  if (provider === "anthropic") return anthropicAvailable();
  return true;
}

/**
 * Resolve a rota do papel: override por env primeiro; depois, se o provedor
 * escolhido não estiver configurado, cai na rota `batch` (Gemini) — degradar
 * é sempre melhor que derrubar o run.
 */
export function resolveRoute(role: ModelRole): ModelRoute {
  const override = process.env[ENV_KEY[role]]?.trim();
  const parsed = override ? parseRoute(override) : null;
  if (override && !parsed) {
    logger.warn("ignoring malformed model route override", { role, override });
  }
  const route = parsed ?? DEFAULT_ROUTES[role];

  if (!providerAvailable(route.provider)) {
    const fallback = DEFAULT_ROUTES.batch;
    logger.warn("provedor de modelo não configurado — degradando", {
      role,
      wanted: `${route.provider}:${route.model}`,
      using: `${fallback.provider}:${fallback.model}`,
      hint:
        route.provider === "vertex"
          ? "defina HERO_VERTEX_ENABLED=true após habilitar o Claude no Model Garden"
          : "defina o secret ANTHROPIC_API_KEY",
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
      isFallback: wanted.provider !== "google" && resolved.provider === "google",
    };
  });
}
