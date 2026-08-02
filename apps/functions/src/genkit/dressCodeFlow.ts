import { z } from "genkit";
import { generateStructured } from "./generate.ts";

const DraftRuleSchema = z.object({
  idSlug: z
    .string()
    .describe("slug kebab-case curto, ex: no-console-in-prod"),
  name: z.string(),
  message: z.string().describe("mensagem clara para o desenvolvedor"),
  category: z.enum([
    "string-injection",
    "weak-crypto",
    "broken-access-control",
    "sensitive-data-exposure",
    "security-misconfiguration",
    "authentication-failures",
    "data-integrity",
    "ssrf",
    "supply-chain",
    "code-smell",
  ]),
  severity: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]),
  patternRegex: z
    .string()
    .describe("fonte de regex JS (sem delimitadores /.../) para match por linha"),
  patternUnless: z
    .string()
    .optional()
    .describe("regex de exclusão (falsos positivos conhecidos)"),
  languages: z
    .array(
      z.enum([
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "csharp",
        "vbnet",
        "cobol",
        "tsql",
        "db2sql",
        "any",
      ]),
    )
    .min(1)
    .describe("linguagens alvo"),
});

const DressCodeProposalSchema = z.object({
  summary: z.string().describe("resumo em 1-2 frases do dress code interpretado"),
  rules: z.array(DraftRuleSchema).min(1).max(8),
});

export type DressCodeProposal = z.infer<typeof DressCodeProposalSchema>;
export type DressCodeDraftRule = z.infer<typeof DraftRuleSchema>;

/**
 * Genkit flow: linguagem natural → rascunhos de regras L0 determinísticas.
 * Nunca promove sozinho — o callable persiste como draft/active overlay.
 */
export async function interpretDressCode(naturalLanguage: string): Promise<DressCodeProposal> {
  const prompt = `Você é o interpretador de dress code do CodeHero.
Converta a política em linguagem natural em regras SAST DETERMINÍSTICAS (regex por linha).

Dress code do usuário:
"""
${naturalLanguage.trim()}
"""

Regras de saída:
- 1 a 8 regras pequenas e revisáveis.
- patternRegex deve ser seguro (evitar .*), preferir âncoras e classes fechadas.
- idSlug kebab-case único no lote.
- category alinhada à taxonomia de segurança (ou code-smell para estilo).
- NÃO invente taint/AST — só L0 pattern.
- Se o texto for vago demais, proponha as interpretações mais conservadoras (menos FP).`;

  // Papel "hard-rule": traduzir linguagem natural em regra deterministica e
  // o diferencial do produto e e sincrono para o usuario — vale o modelo bom.
  const output = await generateStructured({
    role: "hard-rule",
    prompt,
    schema: DressCodeProposalSchema,
    temperature: 0.15,
  });

  if (!output?.rules?.length) {
    throw new Error("Genkit não retornou regras interpretáveis para este dress code");
  }
  return output;
}
