import { z } from "genkit";
import {
  evolveAllRules,
  isSafeMutationSpec,
  mutationFromSpec,
  type CandidateGenerationInput,
  type MutationSpec,
  type RuleCandidateGenerator,
} from "@codehero/ruleforge";
import { RULES_BY_ID } from "@codehero/contracts";
import { ai } from "./ai.ts";
import { generateStructured } from "./generate.ts";

const MutationSpecSchema = z.object({
  id: z.string().describe("slug único, ex: llm-widen-template-literal"),
  description: z.string(),
  kind: z.enum(["append_regex_alt", "replace_in_regex", "set_unless", "append_unless_alt"]),
  value: z
    .string()
    .describe(
      "Fragmento regex. Para replace_in_regex use 'from=>to'. Para append_* um alternativo a OR-juntar.",
    ),
});

const ProposalSchema = z.object({
  mutations: z.array(MutationSpecSchema).max(4),
});

function buildPrompt(
  input: CandidateGenerationInput,
  currentRegex: string,
  currentUnless: string | undefined,
  category: string | undefined,
): string {
  const failures = input.failingExamples
    .slice(0, 8)
    .map((f) => `- expected=${f.expected} :: ${JSON.stringify(f.code)}`)
    .join("\n");

  return `Você é o motor agêntico do CodeHero (hero-ruleforge), rodando 1x/dia (nunca por arquivo/scan).
Sua ÚNICA tarefa é PROPOR mutações pequenas e revisáveis no matcher regex (L0) de uma regra de SAST, baseado no seu
conhecimento atualizado de: (a) boas práticas de qualidade e segurança de código, (b) categorias OWASP Top 10 /
OWASP ASVS, e (c) padrões de vulnerabilidade associados a CVEs conhecidos na linguagem/framework relevante à regra.
Você NÃO decide promoção — um avaliador determinístico (corpus golden + evolve) rejeita regressões.
Você NÃO analisa arquivos em produção: no CodeHero a IA é offline (como as detecções AI do GitHub complementam CodeQL, sem substituí-lo).
Todo cliente (plugin VS Code, MCP, GitHub Action) busca o resultado desta esteira no máximo 1x/dia via getActiveRules.

Taxonomia (GitHub AI-powered security detections, alinhada a OWASP Top 10):
string-injection | weak-crypto | broken-access-control | sensitive-data-exposure |
security-misconfiguration | authentication-failures | data-integrity | ssrf | supply-chain

Regra: ${input.ruleId}
Categoria: ${category ?? "(não classificada)"}
Regex atual: ${currentRegex}
Unless atual: ${currentUnless ?? "(nenhum)"}
Contexto do batch: ${input.context}

Casos que a regra atual erra:
${failures || "(nenhum gap conhecido — proponha só se houver melhoria óbvia de recall sem abrir FP)"}

Regras de saída:
- No máximo 4 mutações.
- Prefira append_regex_alt / append_unless_alt / replace_in_regex cirúrgicos.
- Nunca proponha regex catastrófico (sem .*, sem lookbehind gigante).
- id deve ser kebab-case começando com "llm-".
- Priorize padrões que reduzam FN da categoria sem criar FP em fixtures.
- Se não houver proposta útil, devolva mutations: [].`;
}

/** Genkit-backed candidate generator — proposes MutationSpecs, returns live Mutations. */
export function createGenkitCandidateGenerator(): RuleCandidateGenerator {
  return {
    async propose(input) {
      const rule = RULES_BY_ID[input.ruleId];
      if (!rule) return [];

      // Papel "batch": mutacao de regra existente, alto volume e baixo valor
      // unitario — cada proposta e medida no corpus antes de virar qualquer
      // coisa, entao o modelo mais barato basta.
      const output = await generateStructured({
        role: "batch",
        prompt: buildPrompt(input, rule.pattern.regex, rule.pattern.unless, rule.category),
        schema: ProposalSchema,
        temperature: 0.2,
      });

      const specs = (output?.mutations ?? []) as MutationSpec[];
      return specs
        .filter((s) => isSafeMutationSpec(s, rule.pattern))
        .map(mutationFromSpec);
    },
  };
}

const DailyReportSchema = z.object({
  ranAt: z.string(),
  seed: z.number(),
  promotedCount: z.number(),
  rejectedCount: z.number(),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      decision: z.enum(["PROMOTED", "REJECTED"]),
      reason: z.string(),
      baselineF1: z.number(),
      bestF1: z.number(),
      mutationIds: z.array(z.string()),
      proposedMutationIds: z.array(z.string()),
      promotedPattern: z
        .object({
          regex: z.string(),
          flags: z.string().optional(),
          unless: z.string().optional(),
        })
        .nullable(),
    }),
  ),
});

export type RuleforgeDailyReport = z.infer<typeof DailyReportSchema>;

/**
 * Genkit flow: once-per-day agentic propose → deterministic evolve → report.
 * Deployed via Cloud Scheduler (`ruleforgeDaily` onSchedule), not on the scan path.
 */
export const ruleforgeDailyFlow = ai.defineFlow(
  {
    name: "ruleforgeDaily",
    inputSchema: z.object({
      context: z.string().optional(),
      seed: z.number().optional(),
      /** Optional extended corpus (packaged golden + Firestore approved cases). */
      corpus: z
        .array(
          z.object({
            id: z.string(),
            ruleId: z.string(),
            code: z.string(),
            expected: z.enum(["match", "no_match"]),
            note: z.string().optional(),
          }),
        )
        .optional(),
    }),
    outputSchema: DailyReportSchema,
  },
  async (input) => {
    const report = await evolveAllRules({
      seed: input.seed,
      context: input.context,
      corpus: input.corpus,
      generator: createGenkitCandidateGenerator(),
    });

    return {
      ranAt: report.ranAt,
      seed: report.seed,
      promotedCount: report.promotedCount,
      rejectedCount: report.rejectedCount,
      rules: report.rules.map((r) => ({
        ruleId: r.outcome.ruleId,
        decision: r.outcome.decision,
        reason: r.outcome.reason,
        baselineF1: r.outcome.baseline.f1,
        bestF1: r.outcome.best.f1,
        mutationIds: r.outcome.mutationIds,
        proposedMutationIds: r.proposedMutationIds,
        promotedPattern: r.promotedPattern,
      })),
    };
  },
);
