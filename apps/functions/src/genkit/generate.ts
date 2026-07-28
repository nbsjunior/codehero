import Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "genkit";
import { ai, googleAI } from "./ai.ts";
import { resolveRoute, type ModelRole } from "./models.ts";

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

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  // Lazily constructed: the secret is only bound at call time in Functions.
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

  if (route.provider === "anthropic") {
    return generateWithAnthropic(opts, route.model, route.effort);
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

async function generateWithAnthropic<T extends z.ZodTypeAny>(
  opts: GenerateOptions<T>,
  model: string,
  effort: string | undefined,
): Promise<z.infer<T> | null> {
  // `target: "openApi3"` keeps the output to the JSON Schema subset the
  // structured-outputs API accepts, and $refs inlined.
  const jsonSchema = zodToJsonSchema(opts.schema, {
    target: "openApi3",
    $refStrategy: "none",
  });

  const modern = supportsAdaptiveThinking(model);

  const response = await getAnthropic().messages.create({
    model,
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
    logger.warn("anthropic declined the ruleforge prompt", {
      model,
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
    logger.warn("anthropic returned non-JSON under a json_schema format", { model });
    return null;
  }

  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("anthropic output failed schema validation", {
      model,
      issues: parsed.error.issues.slice(0, 3),
    });
    return null;
  }
  return parsed.data as z.infer<T>;
}
