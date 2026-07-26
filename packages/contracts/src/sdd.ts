import { z } from "zod";

// ---------------------------------------------------------------------------
// SDD Spec — the verifiable contract handed to an AI agent to remediate an
// issue. Validated at the Function boundary with zod so malformed specs never
// reach an agent.
// ---------------------------------------------------------------------------

export const SddRangeSchema = z.object({
  startLine: z.number().int().positive(),
  startColumn: z.number().int().nonnegative().optional(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().nonnegative().optional(),
});

export const SddSpecSchema = z.object({
  sddVersion: z.literal("1.0"),
  specId: z.string(),
  generatedAt: z.string(),
  intent: z.enum(["REMEDIATE_VULNERABILITY", "REMEDIATE_BUG", "REDUCE_DEBT"]),
  issue: z.object({
    ruleId: z.string(),
    cwe: z.array(z.string()),
    severity: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]),
    title: z.string(),
    fingerprint: z.string(),
  }),
  location: z.object({
    file: z.string(),
    function: z.string().optional(),
    range: SddRangeSchema,
  }),
  context: z.object({
    language: z.string(),
    targetSnippet: z.string(),
    surroundingCode: z.string(),
    imports: z.array(z.string()).default([]),
  }),
  remediation: z.object({
    strategy: z.string(),
    templateId: z.string(),
    guidance: z.string(),
    referenceExample: z.object({ before: z.string(), after: z.string() }).optional(),
    constraints: z.array(z.string()),
  }),
  acceptanceCriteria: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["RULE_RESOLVED", "NO_NEW_ISSUES", "TESTS_PASS"]),
      assert: z.string(),
    }),
  ),
  outputContract: z.object({
    format: z.literal("unified_diff"),
    scope: z.enum(["single_file", "multi_file"]),
    maxHunks: z.number().int().positive(),
  }),
});

export type SddSpec = z.infer<typeof SddSpecSchema>;

// Remediation templates keyed by sddTemplateId — reused to seed the guidance /
// reference example fields when a spec is generated.
export interface SddTemplate {
  id: string;
  strategy: string;
  guidance: string;
  constraints: string[];
  referenceExample?: { before: string; after: string };
}

export const SDD_TEMPLATES: Record<string, SddTemplate> = {
  "sdd.secret.externalize": {
    id: "sdd.secret.externalize",
    strategy: "externalize_secret",
    guidance:
      "Remova a credencial literal e leia-a de uma variável de ambiente ou secret manager. Não faça commit do valor real.",
    constraints: ["Não altere a assinatura pública.", "Não introduzir novas dependências pesadas.", "Manter estilo do arquivo."],
    referenceExample: {
      before: 'API_KEY = "sk_live_abc123def456"',
      after: 'API_KEY = os.environ["API_KEY"]',
    },
  },
  "sdd.sqli.parametrize": {
    id: "sdd.sqli.parametrize",
    strategy: "parametrized_query",
    guidance:
      "Substitua a concatenação por query parametrizada usando os placeholders do driver. Preserve o mesmo result set.",
    constraints: ["Preservar comportamento observável.", "Não introduzir novas dependências.", "Manter estilo do arquivo."],
    referenceExample: {
      before: "cursor.execute(\"SELECT * FROM users WHERE name = '\" + name + \"'\")",
      after: 'cursor.execute("SELECT * FROM users WHERE name = ?", (name,))',
    },
  },
  "sdd.crypto.upgrade-hash": {
    id: "sdd.crypto.upgrade-hash",
    strategy: "upgrade_hash",
    guidance: "Troque MD5/SHA1 por SHA-256+ (ou bcrypt/argon2 para senhas). Ajuste comparações de hash conforme necessário.",
    constraints: ["Manter compatibilidade de dados já armazenados quando aplicável.", "Manter estilo do arquivo."],
  },
  "sdd.eval.remove": {
    id: "sdd.eval.remove",
    strategy: "remove_eval",
    guidance: "Substitua eval/exec por parsing seguro (JSON.parse, ast.literal_eval) ou lógica explícita.",
    constraints: ["Não executar código arbitrário.", "Preservar comportamento observável.", "Manter estilo do arquivo."],
  },
  "sdd.smell.remove-debug": {
    id: "sdd.smell.remove-debug",
    strategy: "remove_debug_statement",
    guidance: "Remova o statement de debug ou substitua por um logger estruturado no nível apropriado.",
    constraints: ["Não remover lógica de negócio adjacente.", "Manter estilo do arquivo."],
  },
  "sdd.smell.resolve-todo": {
    id: "sdd.smell.resolve-todo",
    strategy: "resolve_todo",
    guidance: "Implemente o item pendente do TODO/FIXME ou converta-o em uma issue rastreável e remova o marcador.",
    constraints: ["Não expandir escopo além do TODO.", "Manter estilo do arquivo."],
  },
  "sdd.smell.restructure-goto": {
    id: "sdd.smell.restructure-goto",
    strategy: "restructure_control_flow",
    guidance:
      "Substitua o GO TO por estruturas PERFORM/PERFORM UNTIL equivalentes, preservando a ordem de execução original.",
    constraints: [
      "Preservar exatamente o comportamento observável do parágrafo.",
      "Não consolidar múltiplos parágrafos em um só.",
      "Manter estilo/indentação fixa de colunas do arquivo COBOL.",
    ],
  },
};
