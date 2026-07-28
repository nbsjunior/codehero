import { z } from "genkit";
import { isUnsafeRegex } from "@codehero/contracts";
import { generateStructured } from "./generate.ts";
import type { ProposalFamily } from "../ruleProposals.ts";

const NewRuleDraftSchema = z.object({
  idSlug: z.string().describe("kebab-case, ex: jwt-none-alg"),
  name: z.string(),
  message: z.string(),
  family: z.enum(["security", "dress", "smell"]),
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
  type: z.enum(["VULNERABILITY", "BUG", "CODE_SMELL", "SECURITY_HOTSPOT"]),
  // Mirrors RuleLanguage in @codehero/contracts — the enterprise/legacy
  // languages must be here too, otherwise the lint gaps we ground the prompt
  // with (C#, VB.NET, COBOL, T-SQL, DB2) would be unexpressable in the output.
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
    .min(1),
  patternRegex: z.string(),
  patternUnless: z.string().optional(),
  rationale: z.string().describe("por que esta regra (OWASP/CVE/prática) — 1-2 frases"),
  exampleMatch: z.string().describe("trecho de código que DEVE disparar"),
  exampleNoMatch: z.string().describe("trecho semelhante que NÃO deve disparar"),
});

const BatchSchema = z.object({
  summary: z.string(),
  rules: z.array(NewRuleDraftSchema).max(6),
});

export type NewRuleDraft = z.infer<typeof NewRuleDraftSchema>;

/**
 * Offline Genkit batch: propose NEW deterministic L0 rules (security + dress/smell)
 * for human approval — never auto-activates.
 */
export async function proposeNewRulesBatch(context: string): Promise<{
  summary: string;
  drafts: NewRuleDraft[];
}> {
  const prompt = `Você é o motor de proposição de NOVAS regras do CodeHero (esteira offline, 1x/dia).
Proponha até 6 regras SAST DETERMINÍSTICAS (regex por linha) que ainda NÃO estão no catálogo core típico.

Foque em:
1) security — priorize os CVEs/advisories REAIS listados abaixo no contexto do batch (não invente CVE de memória;
   se a lista de CVEs estiver vazia ou não sugerir nada acionável, aí sim use OWASP Top 10 / padrões clássicos).
2) dress / smell — priorize as LACUNAS de lint/clean-code listadas no contexto: elas foram calculadas contra o
   catálogo ativo e representam o que de fato falta. Não reproponha tema já coberto.

Contexto do batch — duas fontes de grounding, ambas dado real e atual, prefira-as à sua memória de treino:
(a) digest de CVEs/advisories recentes do GitHub Security Advisories;
(b) lacunas de lint/clean-code ainda não cobertas pelo catálogo ativo do CodeHero.
${context}

Regras de saída:
- Só L0 pattern (sem AST/taint).
- Regex seguro (evitar .* catastrófico).
- Cada regra precisa de exampleMatch e exampleNoMatch curtos.
- family=security para vulnerabilidades; dress ou smell para qualidade/estilo.
- idSlug único no lote.
- Se não houver proposta útil, rules: [].`;

  // Papel "hard-rule": sintetizar regra nova a partir de CVE e de lacuna de
  // taxonomia e o ponto do pipeline onde a qualidade do raciocinio mais paga.
  // O avaliador deterministico continua sendo quem decide.
  const output = await generateStructured({
    role: "hard-rule",
    prompt,
    schema: BatchSchema,
    temperature: 0.25,
  });

  const drafts = (output?.rules ?? []).filter(
    (r) => !isUnsafeRegex(r.patternRegex) && !(r.patternUnless && isUnsafeRegex(r.patternUnless)),
  );

  return { summary: output?.summary ?? "", drafts };
}

export function draftToEnqueue(d: NewRuleDraft, runDay: string) {
  const family = d.family as ProposalFamily;
  const ruleId = `HERO-PROP-${d.idSlug}`.slice(0, 80);
  return {
    family,
    title: `Nova regra: ${d.name}`,
    rationale: d.rationale,
    rule: {
      id: ruleId,
      name: d.name,
      message: d.message,
      severity: d.severity,
      type: d.type,
      category: d.category,
      languages: d.languages,
      pattern: {
        regex: d.patternRegex,
        ...(d.patternUnless ? { unless: d.patternUnless } : {}),
      },
      remediationEffortMin: d.family === "security" ? 15 : 8,
    },
    corpusCases: [
      {
        id: `${ruleId}-pos`,
        code: d.exampleMatch,
        expected: "match" as const,
        note: "exemplo positivo da proposta Genkit",
      },
      {
        id: `${ruleId}-neg`,
        code: d.exampleNoMatch,
        expected: "no_match" as const,
        note: "exemplo negativo da proposta Genkit",
      },
    ],
    source: "genkit-newRulesDaily",
    runDay,
  };
}
