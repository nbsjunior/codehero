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
    /** Evidência estrutural determinística (code-graph) — sem Gen AI. */
    callGraph: z
      .object({
        functionId: z.string().nullable(),
        functionName: z.string().nullable(),
        fanIn: z.number().int().nonnegative(),
        fanOut: z.number().int().nonnegative(),
        hopsToEntry: z.number().int().nonnegative().nullable(),
        callers: z.array(
          z.object({ id: z.string(), name: z.string(), file: z.string() }),
        ),
        callees: z.array(
          z.object({ id: z.string(), name: z.string(), file: z.string() }),
        ),
        priority: z.number(),
      })
      .optional(),
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
  "sdd.xss.sanitize": {
    id: "sdd.xss.sanitize",
    strategy: "sanitize_dom_sink",
    guidance:
      "Não atribua HTML cru a innerHTML. Use textContent ou sanitize com biblioteca confiável (ex.: DOMPurify) antes do sink.",
    constraints: ["Preservar UX observável.", "Não introduzir XSS residual.", "Manter estilo do arquivo."],
    referenceExample: {
      before: 'el.innerHTML = "<h1>" + name + "</h1>";',
      after: "el.textContent = name;",
    },
  },
  "sdd.cmd.avoid-shell": {
    id: "sdd.cmd.avoid-shell",
    strategy: "avoid_shell_interpolation",
    guidance:
      "Evite shell:true e concatenação de comandos. Prefira execFile/spawn com argument list e allowlist de binários.",
    constraints: ["Não executar shell com input de usuário.", "Manter estilo do arquivo."],
  },
  "sdd.ssrf.allowlist": {
    id: "sdd.ssrf.allowlist",
    strategy: "url_allowlist",
    guidance:
      "Não passe URLs de request do usuário direto a fetch. Valide contra allowlist de hosts/esquemas antes da chamada.",
    constraints: ["Bloquear link-local/metadata IPs.", "Manter estilo do arquivo."],
  },
  "sdd.path.normalize-allowlist": {
    id: "sdd.path.normalize-allowlist",
    strategy: "path_allowlist",
    guidance:
      "Normalize o path (path.resolve), rejeite `..` fora da raiz permitida e use basename quando só o nome do arquivo for necessário.",
    constraints: ["Não confiar em path.normalize sozinho.", "Manter estilo do arquivo."],
  },
  "sdd.redirect.allowlist": {
    id: "sdd.redirect.allowlist",
    strategy: "redirect_allowlist",
    guidance: "Só redirecione para paths relativos internos ou hosts em allowlist explícita.",
    constraints: ["Rejeitar URLs absolutas externas não listadas.", "Manter estilo do arquivo."],
  },
  "sdd.merge.safe-assign": {
    id: "sdd.merge.safe-assign",
    strategy: "safe_object_merge",
    guidance:
      "Não faça Object.assign/merge com objetos de usuário. Copie campos allowlisted ou use Object.create(null) + validação de schema.",
    constraints: ["Bloquear chaves __proto__/constructor/prototype.", "Manter estilo do arquivo."],
  },
  "sdd.crypto.secure-random": {
    id: "sdd.crypto.secure-random",
    strategy: "use_csprng",
    guidance: "Substitua Math.random por crypto.randomBytes / crypto.getRandomValues para tokens e segredos.",
    constraints: ["Manter estilo do arquivo."],
  },
  "sdd.tls.enable-verify": {
    id: "sdd.tls.enable-verify",
    strategy: "enable_tls_verify",
    guidance: "Remova NODE_TLS_REJECT_UNAUTHORIZED=0. Corrija a cadeia de certificados em vez de desabilitar verificação.",
    constraints: ["Não reintroduzir bypass de TLS.", "Manter estilo do arquivo."],
  },
  "sdd.log.redact-secrets": {
    id: "sdd.log.redact-secrets",
    strategy: "redact_secrets",
    guidance: "Não logue password/token/secret. Use redaction ou omita o campo.",
    constraints: ["Manter estilo do arquivo."],
  },
  "sdd.supply.verify-checksum": {
    id: "sdd.supply.verify-checksum",
    strategy: "verify_artifact",
    guidance: "Não pipe curl/wget para shell. Baixe o artefato, verifique checksum/assinatura e então instale.",
    constraints: ["Manter estilo do arquivo."],
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
  "sdd.deserialize.avoid-unsafe": {
    id: "sdd.deserialize.avoid-unsafe",
    strategy: "avoid_unsafe_deserialization",
    guidance:
      "Não desserialize dados não confiáveis com BinaryFormatter/ObjectInputStream. Use um formato de dados (JSON/XML) com um serializador seguro e um allowlist de tipos.",
    constraints: [
      "Não aceitar tipos arbitrários na desserialização.",
      "Preservar o schema de dados já persistido quando possível.",
      "Manter estilo do arquivo.",
    ],
  },
  "sdd.xxe.disable-external-entities": {
    id: "sdd.xxe.disable-external-entities",
    strategy: "disable_xml_external_entities",
    guidance:
      "Desabilite DTD/entidades externas no parser XML (ex.: disallow-doctype-decl, XmlResolver = null, DtdProcessing.Prohibit) antes de processar XML de fontes não confiáveis.",
    constraints: ["Preservar o parsing de XML válido sem DTD externo.", "Manter estilo do arquivo."],
  },
  "sdd.smell.remove-alter-cobol": {
    id: "sdd.smell.remove-alter-cobol",
    strategy: "remove_alter_statement",
    guidance:
      "Remova o ALTER e substitua o destino variável do GO TO por um PERFORM condicional explícito (ex.: uma variável de estado + EVALUATE), tornando o fluxo estático e rastreável.",
    constraints: [
      "Preservar exatamente o comportamento observável do parágrafo.",
      "Manter estilo/indentação fixa de colunas do arquivo COBOL.",
    ],
  },
  "sdd.generic.secure-fix": {
    id: "sdd.generic.secure-fix",
    strategy: "secure_fix",
    guidance:
      "Corrija a vulnerabilidade apontada seguindo a orientação da regra Sonar Way correspondente. Prefira APIs seguras da plataforma, valide entradas e evite padrões inseguros equivalentes.",
    constraints: ["Preservar comportamento funcional legítimo.", "Não enfraquecer outros controles de segurança."],
  },
  "sdd.generic.bugfix": {
    id: "sdd.generic.bugfix",
    strategy: "bug_fix",
    guidance:
      "Corrija o bug apontado pela regra: elimine a condição de erro, trate edge cases e mantenha testes cobrindo o comportamento esperado.",
    constraints: ["Preservar a API pública e contratos existentes."],
  },
  "sdd.generic.smell": {
    id: "sdd.generic.smell",
    strategy: "smell_refactor",
    guidance:
      "Refatore o trecho para eliminar o code smell (clareza, manutenibilidade ou higiene). Prefira a forma idiomática da linguagem.",
    constraints: ["Não alterar comportamento observável sem necessidade."],
  },
  "sdd.smell.externalize-path": {
    id: "sdd.smell.externalize-path",
    strategy: "externalize_path",
    guidance:
      "Remova o caminho absoluto do código. Carregue o diretório/base via variável de ambiente, configuração ou path relativo ao workspace.",
    constraints: ["Preservar o comportamento em todos os ambientes (dev/CI/prod).", "Manter estilo do arquivo."],
  },
  "sdd.smell.strict-equality": {
    id: "sdd.smell.strict-equality",
    strategy: "strict_equality",
    guidance: "Substitua == / != por === / !==. O idioma `== null` / `!= null` (null ou undefined) pode permanecer.",
    constraints: ["Não alterar coerções intencionais documentadas.", "Manter estilo do arquivo."],
  },
  "sdd.smell.replace-any": {
    id: "sdd.smell.replace-any",
    strategy: "replace_any",
    guidance: "Substitua `any` por um tipo concreto, genérico ou `unknown` com narrowing.",
    constraints: ["Não enfraquecer tipos públicos da API.", "Manter estilo do arquivo."],
  },
  "sdd.smell.remove-non-null": {
    id: "sdd.smell.remove-non-null",
    strategy: "remove_non_null_assertion",
    guidance: "Remova `!` e trate o caso null/undefined com early-return, optional chaining ou narrowing.",
    constraints: ["Preservar o contrato da função.", "Manter estilo do arquivo."],
  },
  "sdd.smell.prefer-let-const": {
    id: "sdd.smell.prefer-let-const",
    strategy: "prefer_let_const",
    guidance: "Troque `var` por `const` (imutável) ou `let` (reatribuição).",
    constraints: ["Preservar escopo e ordem de inicialização.", "Manter estilo do arquivo."],
  },
  "sdd.smell.immutable-default": {
    id: "sdd.smell.immutable-default",
    strategy: "immutable_default",
    guidance: "Use `None` como default e crie a lista/dict dentro do corpo da função.",
    constraints: ["Preservar a assinatura pública.", "Manter estilo do arquivo."],
  },
  "sdd.smell.typed-except": {
    id: "sdd.smell.typed-except",
    strategy: "typed_except",
    guidance: "Capture exceções específicas; logue ou relance o restante. Evite bare except / catch (Exception) genérico.",
    constraints: ["Não engolir erros de infraestrutura sem telemetria.", "Manter estilo do arquivo."],
  },
  "sdd.smell.check-error": {
    id: "sdd.smell.check-error",
    strategy: "check_error",
    guidance: "Trate o valor `error` retornado: propague com `fmt.Errorf`, logue ou trate o caso — não descarte com `_`.",
    constraints: ["Preservar o contrato de erro da função.", "Manter estilo do arquivo."],
  },
  "sdd.smell.async-task": {
    id: "sdd.smell.async-task",
    strategy: "async_task",
    guidance: "Troque `async void` por `async Task` (exceto handlers de evento UI).",
    constraints: ["Preservar o fluxo assíncrono observável.", "Manter estilo do arquivo."],
  },
  "sdd.smell.async-await": {
    id: "sdd.smell.async-await",
    strategy: "async_await",
    guidance: "Substitua `.Result` / `.Wait()` por `await` em método async, ou use GetAwaiter().GetResult() só em boundary síncrono consciente.",
    constraints: ["Evitar deadlock em SynchronizationContext.", "Manter estilo do arquivo."],
  },
  "sdd.smell.reduce-complexity": {
    id: "sdd.smell.reduce-complexity",
    strategy: "reduce_complexity",
    guidance:
      "Extraia funções menores, reduza aninhamento (early-return / guard clauses) e limite caminhos de decisão por unidade.",
    constraints: ["Não alterar comportamento observável.", "Manter estilo do arquivo."],
  },
  "sdd.smell.split-function": {
    id: "sdd.smell.split-function",
    strategy: "split_function",
    guidance: "Divida a função longa em unidades com uma responsabilidade cada (SRP).",
    constraints: ["Preservar contratos públicos.", "Manter estilo do arquivo."],
  },
  "sdd.smell.reduce-params": {
    id: "sdd.smell.reduce-params",
    strategy: "reduce_params",
    guidance: "Agrupe parâmetros relacionados num objeto/options/DTO em vez de lista longa.",
    constraints: ["Preservar a API pública quando possível (overload/adapter).", "Manter estilo do arquivo."],
  },
  "sdd.agent.remove-injection": {
    id: "sdd.agent.remove-injection",
    strategy: "remove_prompt_injection",
    guidance:
      "Remova frases de override/jailbreak/marcadores falsos de sistema. Documente anti-padrões só como exemplos rotulados de ataque (never include / detect), nunca como instrução ativa.",
    constraints: [
      "Não enfraquecer guardrails do agente.",
      "Preservar o fluxo AIDLC/HITL e decision gates.",
      "Manter estilo do arquivo markdown.",
    ],
  },
  "sdd.agent.harden-instructions": {
    id: "sdd.agent.harden-instructions",
    strategy: "harden_agent_instructions",
    guidance:
      "Reescreva a instrução para proibir exfiltração de segredos, commit de .env e revelação do system prompt. Prefira allowlist de ferramentas e caminhos.",
    constraints: [
      "Nunca autorizar commit de credenciais.",
      "Manter human-in-the-loop em decisões irreversíveis.",
      "Manter estilo do arquivo markdown.",
    ],
  },
  "sdd.agent.restore-hitl": {
    id: "sdd.agent.restore-hitl",
    strategy: "restore_human_in_the_loop",
    guidance:
      "Restaure decision gates: persista perguntas/respostas em artefato markdown versionado (AIDLC), peça confirmação humana antes de fases irreversíveis e não auto-aprove.",
    constraints: [
      "Não decidir silenciosamente em chat-only.",
      "Manter rastreabilidade requirements → design → tasks.",
      "Manter estilo do arquivo markdown.",
    ],
  },
  "sdd.agent.constrain-tools": {
    id: "sdd.agent.constrain-tools",
    strategy: "constrain_agent_tools",
    guidance:
      "Substitua 'any command / unrestricted shell' por allowlist explícita de ferramentas, diretórios e comandos permitidos.",
    constraints: [
      "Negar por padrão o que não estiver na allowlist.",
      "Manter estilo do arquivo markdown.",
    ],
  },
  "sdd.agent.skill-structure": {
    id: "sdd.agent.skill-structure",
    strategy: "fix_skill_structure",
    guidance:
      "Corrija o SKILL.md: frontmatter YAML com `name` (kebab-case) e `description` (terceira pessoa, WHAT+WHEN, ≤1024 chars); H1; pelo menos uma secção `## Instructions` (Cursor) ou `## Activation` / `## Information Contract` / `## Process` (AIDLC). Mantenha o índice compacto e mova detalhe para `actions/` e `references/`.",
    constraints: [
      "Não duplicar o corpo inteiro da skill no índice.",
      "Preservar compatibilidade multi-plataforma (Kiro/Claude/Cursor).",
      "Manter estilo do arquivo markdown.",
    ],
  },
};
