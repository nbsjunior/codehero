import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { logger } from "firebase-functions";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "genkit";
import { ai, googleAI } from "./ai.ts";
import {
  resolveRoute,
  vertexProjectId,
  vertexRegion,
  type ModelProvider,
  type ModelRole,
} from "./models.ts";

// ---------------------------------------------------------------------------
// One structured-generation entry point for every ruleforge flow, so a role
// can be re-routed to another provider without touching flow code.
//
// Both providers are asked for the SAME zod schema; the Anthropic path
// converts it to JSON Schema and re-validates the reply with zod, so a
// malformed structured output fails here rather than downstream.
// ---------------------------------------------------------------------------

/**
 * `thinking: {type: "adaptive"}` e `output_config.effort` são da família 4.6+;
 * enviá-los para um modelo anterior (Haiku 4.5, por exemplo) devolve 400.
 * A lista é de inclusão e o default é NÃO enviar, porque omitir os dois é
 * sempre válido — um modelo novo que não esteja aqui roda sem thinking, o que
 * degrada a qualidade mas nunca quebra a esteira.
 */
const SUPPORTS_ADAPTIVE_THINKING = [
  /^claude-opus-4-(6|7|8)/,
  /^claude-sonnet-(5|4-6)/,
  /^claude-fable-5/,
  /^claude-mythos-5/,
];

export function supportsAdaptiveThinking(model: string): boolean {
  return SUPPORTS_ADAPTIVE_THINKING.some((re) => re.test(model));
}

/**
 * IDs no Vertex nem sempre batem com os da API direta: modelos de geração
 * atual usam o ID puro, mas snapshots datados levam separador `@`. Errar isso
 * dá 404 no Model Garden, não erro de validação — por isso a tradução é
 * explícita em vez de heurística.
 */
const VERTEX_MODEL_IDS: Record<string, string> = {
  "claude-haiku-4-5": "claude-haiku-4-5@20251001",
  "claude-sonnet-4-5": "claude-sonnet-4-5@20250929",
  "claude-opus-4-5": "claude-opus-4-5@20251101",
};

export function toVertexModelId(model: string): string {
  return VERTEX_MODEL_IDS[model] ?? model;
}

let anthropicClient: Anthropic | null = null;
let vertexClient: AnthropicVertex | null = null;

/**
 * Ambos os clientes expõem a mesma `messages.create`, então o resto do
 * adaptador não precisa saber por onde a chamada saiu.
 */
function getClaudeClient(provider: ModelProvider): Anthropic | AnthropicVertex {
  if (provider === "vertex") {
    // Autenticação por Application Default Credentials: nas Functions é a
    // própria service account do runtime, sem chave para guardar.
    vertexClient ??= new AnthropicVertex({
      projectId: vertexProjectId() ?? undefined,
      region: vertexRegion(),
    });
    return vertexClient;
  }
  // Construído tarde: o secret só existe no momento da chamada.
  anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

export interface GenerateOptions<T extends z.ZodTypeAny> {
  role: ModelRole;
  prompt: string;
  schema: T;
  /** Applies to the Gemini path only; the Anthropic models reject sampling params. */
  temperature?: number;
  maxTokens?: number;
}

export async function generateStructured<T extends z.ZodTypeAny>(
  opts: GenerateOptions<T>,
): Promise<z.infer<T> | null> {
  const route = resolveRoute(opts.role);

  if (route.provider === "vertex" || route.provider === "anthropic") {
    return generateWithClaude(opts, route.provider, route.model, route.effort);
  }
  return generateWithGemini(opts, route.model);
}

async function generateWithGemini<T extends z.ZodTypeAny>(
  opts: GenerateOptions<T>,
  model: string,
): Promise<z.infer<T> | null> {
  const { output } = await ai.generate({
    model: googleAI.model(model),
    prompt: opts.prompt,
    output: { schema: opts.schema },
    config: { temperature: opts.temperature ?? 0.25 },
  });
  return (output as z.infer<T> | undefined) ?? null;
}

async function generateWithClaude<T extends z.ZodTypeAny>(
  opts: GenerateOptions<T>,
  provider: ModelProvider,
  model: string,
  effort: string | undefined,
): Promise<z.infer<T> | null> {
  // `target: "openApi3"` keeps the output to the JSON Schema subset the
  // structured-outputs API accepts, and $refs inlined.
  const jsonSchema = zodToJsonSchema(opts.schema, {
    target: "openApi3",
    $refStrategy: "none",
  });

  // A checagem de capacidade usa o ID canônico; o sufixo `@data` do Vertex
  // quebraria os padrões.
  const modern = supportsAdaptiveThinking(model);
  const wireModel = provider === "vertex" ? toVertexModelId(model) : model;

  const response = await getClaudeClient(provider).messages.create({
    model: wireModel,
    max_tokens: opts.maxTokens ?? 16000,
    // Adaptive é o único on-mode no Sonnet 5, e fica desligado se não for
    // pedido explicitamente. Sem temperature — esses modelos a rejeitam.
    ...(modern ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: {
      ...(modern && effort
        ? { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" }
        : {}),
      format: { type: "json_schema", schema: jsonSchema as Record<string, unknown> },
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  if (response.stop_reason === "refusal") {
    logger.warn("claude declinou o prompt da ruleforge", {
      provider,
      model: wireModel,
      category: response.stop_details?.type,
    });
    return null;
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    logger.warn("claude devolveu não-JSON sob json_schema", { provider, model: wireModel });
    return null;
  }

  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("saída do claude falhou na validação de schema", {
      provider,
      model: wireModel,
      issues: parsed.error.issues.slice(0, 3),
    });
    return null;
  }
  return parsed.data as z.infer<T>;
}
