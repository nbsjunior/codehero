import type { HeroRule, RuleLanguage } from "./rules.ts";

/**
 * Manutenibilidade — Clean Code / proxies SOLID / higiene 12-Factor detectáveis
 * por L0 (regex por linha).
 *
 * Honestidade do catálogo:
 * - Não fingimos OCP/LSP/ISP sem AST semântico.
 * - SRP/DIP entram via limiares estruturais (HERO-SMELL-LONG-FUNCTION,
 *   CYCLOMATIC, PARAM-COUNT, …) emitidos com `--metrics`.
 * - 12-Factor III (config) → caminho absoluto hardcoded; segredos já estão
 *   nas regras HERO-SEC-0798-*.
 *
 * Keywords nos ids/mensagens alimentam `computeLintCoverage` (lint KB).
 */
export const MAINTAINABILITY_RULES: HeroRule[] = (
  [
    // --- Cross-language hygiene --------------------------------------------
    {
      id: "HERO-SMELL-hardcoded-absolute-path",
      name: "HardcodedAbsolutePath",
      languages: ["any"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-427"],
      owasp: [],
      message:
        "Caminho absoluto hardcoded (C:\\…, /home/…, /Users/…) — quebra fora da máquina do autor (config deve vir do ambiente).",
      sddTemplateId: "sdd.smell.externalize-path",
      category: "code-smell",
      pattern: {
        scope: "any",
        regex:
          "(?i)(['\"`])([A-Za-z]:\\\\(?:[^'\"`\\\\]|\\\\.){2,}|/(?:home|Users|var/www|opt|usr/local)/[^'\"`\\s]{2,})\\1",
        unless: "(?i)(example|exemplo|placeholder|fixture|testdata|dummy|/tmp/|/var/tmp/)",
      },
    },

    // --- JavaScript / TypeScript -------------------------------------------
    {
      id: "HERO-SMELL-loose-equality",
      name: "LooseEquality",
      languages: ["javascript", "typescript"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 2,
      cwe: ["CWE-697"],
      owasp: [],
      message:
        "Comparação frouxa == / != (loose-equality): use === / !==, salvo o idioma `== null` / `!= null`.",
      sddTemplateId: "sdd.smell.strict-equality",
      category: "code-smell",
      pattern: {
        regex: "(?<![=!<>])[=!]=(?!=)",
        unless: "(?:=\\s*null|!=\\s*null|==\\s*undefined|!=\\s*undefined)",
      },
    },
    {
      id: "HERO-SMELL-typescript-any-escape",
      name: "TypeScriptAnyEscape",
      languages: ["typescript"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message:
        "Uso de `any` (any-type / tipagem any) anula a verificação estática — prefira tipo concreto ou `unknown`.",
      sddTemplateId: "sdd.smell.replace-any",
      category: "code-smell",
      pattern: {
        regex: "(?::\\s*any\\b|\\bas\\s+any\\b|<any>|Array<any>|Promise<any>|Record<[^>]*any)",
        unless: "(?i)(eslint-disable|@ts-expect-error|//\\s*allow-any)",
      },
    },
    {
      id: "HERO-SMELL-non-null-assertion",
      name: "NonNullAssertion",
      languages: ["typescript"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message:
        "Asserção não-nula (!) promete ao compilador o que ele não provou — risco de TypeError em runtime.",
      sddTemplateId: "sdd.smell.remove-non-null",
      category: "code-smell",
      pattern: {
        // `foo!.bar` / `arr![0]` / `x!();` — evita `!==` e bangs em strings via máscara code.
        regex: "\\w\\!(?=[.\\[(]|$|\\s*[;,)\\]])",
        unless: "(?i)(eslint-disable|//\\s*allow-non-null)",
      },
    },
    {
      id: "HERO-SMELL-var-declaration",
      name: "VarDeclaration",
      languages: ["javascript", "typescript"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 2,
      cwe: [],
      owasp: [],
      message: "Declaração com `var` (escopo de função / hoisting) — prefira `let` ou `const`.",
      sddTemplateId: "sdd.smell.prefer-let-const",
      category: "code-smell",
      pattern: {
        regex: "(?<![.\\w])var\\s+[A-Za-z_$]",
        unless: "(?i)(varname|variable|//\\s*allow-var)",
      },
    },
    {
      id: "HERO-SMELL-document-write",
      name: "DocumentWrite",
      languages: ["javascript", "typescript"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-79"],
      owasp: ["A03:2021-Injection"],
      message: "document.write em runtime reescreve o documento e é vetor clássico de XSS.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?<![.\\w])document\\.write(ln)?\\s*\\(",
      },
    },
    {
      id: "HERO-SMELL-settimeout-string",
      name: "SetTimeoutStringArg",
      languages: ["javascript", "typescript"],
      severity: "CRITICAL",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: ["CWE-95"],
      owasp: ["A03:2021-Injection"],
      message: "setTimeout/setInterval com string é eval disfarçado — passe uma função.",
      sddTemplateId: "sdd.eval.remove",
      category: "code-smell",
      pattern: {
        regex: "(?<![.\\w])(setTimeout|setInterval)\\s*\\(\\s*['\"`]",
      },
    },

    // --- Python ------------------------------------------------------------
    {
      id: "HERO-SMELL-mutable-default",
      name: "MutableDefaultArgument",
      languages: ["python"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-475"],
      owasp: [],
      message:
        "Argumento default mutável (`=[]` / `={}`) — o estado vaza entre chamadas (mutable-default).",
      sddTemplateId: "sdd.smell.immutable-default",
      category: "code-smell",
      pattern: {
        regex: "def\\s+\\w+\\s*\\([^)]*=\\s*(\\[\\]|\\{\\})",
      },
    },
    {
      id: "HERO-SMELL-bare-except",
      name: "BareExcept",
      languages: ["python"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: ["CWE-396"],
      owasp: [],
      message:
        "`except:` bare-except captura até KeyboardInterrupt/SystemExit e mascara falhas reais.",
      sddTemplateId: "sdd.smell.typed-except",
      category: "code-smell",
      pattern: {
        regex: "(?m)^\\s*except\\s*:",
      },
    },
    {
      id: "HERO-SMELL-type-equality",
      name: "TypeEqualityComparison",
      languages: ["python"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "Comparação `type(x) ==` ignora herança — use `isinstance()` (type-comparison).",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "type\\s*\\([^)]+\\)\\s*==",
      },
    },
    {
      id: "HERO-SMELL-global-statement",
      name: "GlobalStatement",
      languages: ["python"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message:
        "Uso de `global` para estado mutável cria acoplamento invisível (global-statement).",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?m)^\\s*global\\s+\\w+",
      },
    },
    {
      id: "HERO-SMELL-assert-in-production",
      name: "AssertInProduction",
      languages: ["python"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-617"],
      owasp: [],
      message:
        "`assert` some com `python -O` — não use como validação/autorização de produção.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?m)^\\s*assert\\s+",
        unless: "(?i)(test_|_test\\.py|pytest|unittest)",
      },
    },

    // --- Java --------------------------------------------------------------
    {
      id: "HERO-SMELL-catch-throwable",
      name: "CatchThrowable",
      languages: ["java"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-396"],
      owasp: [],
      message:
        "catch (Throwable/Exception) genérico (catch-throwable) impede tratamento específico.",
      sddTemplateId: "sdd.smell.typed-except",
      category: "code-smell",
      pattern: {
        regex: "catch\\s*\\(\\s*(Throwable|Exception)\\s+\\w+",
      },
    },
    {
      id: "HERO-SMELL-system-exit",
      name: "SystemExitInLibrary",
      languages: ["java"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: ["CWE-382"],
      owasp: [],
      message: "System.exit() fora de main derruba a JVM inteira a partir de código de biblioteca.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "System\\.exit\\s*\\(",
        unless: "(?i)\\bpublic\\s+static\\s+void\\s+main\\b",
      },
    },
    {
      id: "HERO-SMELL-thread-sleep",
      name: "ThreadSleepBusyWait",
      languages: ["java", "csharp", "vbnet"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message:
        "Thread.sleep / Thread.Sleep como sincronização é corrida disfarçada — use primitivas adequadas.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?i)Thread\\.Sleep\\s*\\(|Thread\\.sleep\\s*\\(",
      },
    },

    // --- Go ----------------------------------------------------------------
    {
      id: "HERO-SMELL-ignored-error-go",
      name: "IgnoredErrorReturn",
      languages: ["go"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: ["CWE-391"],
      owasp: [],
      message:
        "Erro descartado com `_` (ignored-error / blank identifier) esconde falha idiomática do Go.",
      sddTemplateId: "sdd.smell.check-error",
      category: "code-smell",
      pattern: {
        regex: "(?:,\\s*_\\s*:?=|_\\s*=\\s*\\w)",
        unless: "(?i)(//\\s*nolint|//\\s*ok)",
      },
    },
    {
      id: "HERO-SMELL-panic-go",
      name: "PanicInLibrary",
      languages: ["go"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "panic() em código reutilizável derruba o processo — prefira devolver error.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?<![.\\w])panic\\s*\\(",
        unless: "(?i)(main\\.go|Test|_test\\.go)",
      },
    },
    {
      id: "HERO-SMELL-context-background",
      name: "ContextBackgroundInHandler",
      languages: ["go"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message:
        "context.Background() em caminho de request descarta cancelamento/deadline do cliente.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "context\\.Background\\s*\\(\\s*\\)",
        unless: "(?i)(main\\.go|_test\\.go|//\\s*ok-background)",
      },
    },
    {
      id: "HERO-SMELL-http-client-no-timeout",
      name: "HttpClientNoTimeout",
      languages: ["go"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-400"],
      owasp: [],
      message:
        "http.Client{} sem Timeout — peer lento trava a goroutine indefinidamente.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "&?http\\.Client\\s*\\{\\s*\\}",
      },
    },

    // --- C# / VB.NET -------------------------------------------------------
    {
      id: "HERO-SMELL-async-void",
      name: "AsyncVoid",
      languages: ["csharp"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message:
        "async void fora de event handler — exceções não são capturáveis e podem derrubar o processo.",
      sddTemplateId: "sdd.smell.async-task",
      category: "code-smell",
      pattern: {
        regex: "async\\s+void\\s+\\w+",
        unless: "(?i)(EventArgs|event\\s+handler|On[A-Z]\\w+\\s*\\()",
      },
    },
    {
      id: "HERO-SMELL-blocking-async",
      name: "BlockingOnAsync",
      languages: ["csharp", "vbnet"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message:
        "Bloqueio em assíncrono (.Result / .Wait()) — risco de deadlock e consumo do thread pool.",
      sddTemplateId: "sdd.smell.async-await",
      category: "code-smell",
      pattern: {
        regex: "\\.(Result|Wait)\\s*(\\(|$|\\s|;)",
        unless: "(?i)(test|//\\s*allow-sync)",
      },
    },
    {
      id: "HERO-SMELL-catch-exception-dotnet",
      name: "CatchGeneralExceptionDotNet",
      languages: ["csharp", "vbnet"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: ["CWE-396"],
      owasp: [],
      message: "catch (Exception) genérico captura falhas de infraestrutura que deveriam propagar.",
      sddTemplateId: "sdd.smell.typed-except",
      category: "code-smell",
      pattern: {
        regex: "(?i)catch\\s*\\(\\s*Exception(\\s+\\w+)?\\s*\\)",
      },
    },

    // --- SQL ---------------------------------------------------------------
    {
      id: "HERO-SMELL-select-star",
      name: "SelectStar",
      languages: ["tsql", "db2sql"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message:
        "SELECT * (select star) traz colunas desnecessárias e quebra quando o schema muda.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        scope: "any",
        regex: "(?i)\\bSELECT\\s+\\*",
      },
    },
    {
      id: "HERO-SMELL-nolock",
      name: "NolockHint",
      languages: ["tsql"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "Hint WITH (NOLOCK) permite dirty read de transações não confirmadas.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        scope: "any",
        regex: "(?i)WITH\\s*\\(\\s*NOLOCK\\s*\\)",
      },
    },
    {
      id: "HERO-SMELL-dml-without-where",
      name: "DmlWithoutWhere",
      languages: ["tsql", "db2sql"],
      severity: "BLOCKER",
      type: "CODE_SMELL",
      remediationEffortMin: 20,
      cwe: ["CWE-89"],
      owasp: [],
      message:
        "UPDATE/DELETE sem WHERE afeta a tabela inteira — incidente de dados clássico.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        scope: "any",
        // Linha completa típica de script; JOIN/CTE com WHERE em outra linha
        // não é coberta (limite L0).
        regex: "(?i)^\\s*(UPDATE\\s+\\S+|DELETE\\s+FROM\\s+\\S+)\\s*;?\\s*$",
      },
    },
  ] as HeroRule[]
).map((r) => ({ ...r, implementation: "core" as const }));

/**
 * Metadados das regras de limiar estrutural (SRP / complexidade).
 * Detecção em `structuralFindings()`; emissão SARIF com `--metrics`.
 * Pattern `(?!)` — nunca dispara no matcher L0.
 */
export const METRIC_SMELL_HERO_RULES: HeroRule[] = (
  [
    {
      id: "HERO-SMELL-CYCLOMATIC",
      name: "HighCyclomaticComplexity",
      languages: [
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "csharp",
        "cobol",
        "tsql",
      ] as RuleLanguage[],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 30,
      cwe: ["CWE-1121"],
      owasp: [],
      message:
        "Complexidade ciclomática acima do limite — a função tem caminhos demais para testar com confiança (proxy SRP).",
      sddTemplateId: "sdd.smell.reduce-complexity",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-COGNITIVE",
      name: "HighCognitiveComplexity",
      languages: [
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "csharp",
        "cobol",
        "tsql",
      ] as RuleLanguage[],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 30,
      cwe: ["CWE-1121"],
      owasp: [],
      message:
        "Complexidade cognitiva acima do limite — aninhamento dificulta o acompanhamento do fluxo.",
      sddTemplateId: "sdd.smell.reduce-complexity",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-NESTING",
      name: "DeepNesting",
      languages: [
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "csharp",
        "cobol",
        "tsql",
      ] as RuleLanguage[],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 20,
      cwe: [],
      owasp: [],
      message: "Aninhamento acima do limite — extraia blocos internos ou inverta condições.",
      sddTemplateId: "sdd.smell.reduce-complexity",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-LONG-FUNCTION",
      name: "LongFunction",
      languages: [
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "csharp",
        "cobol",
        "tsql",
      ] as RuleLanguage[],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 25,
      cwe: ["CWE-1080"],
      owasp: [],
      message:
        "Função longa acima do limite de linhas — provavelmente faz mais de uma coisa (proxy SRP).",
      sddTemplateId: "sdd.smell.split-function",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-PARAM-COUNT",
      name: "TooManyParameters",
      languages: [
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "csharp",
        "cobol",
        "tsql",
      ] as RuleLanguage[],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message:
        "Função com parâmetros demais — agrupe num objeto/DTO (proxy ISP/SRP de superfície).",
      sddTemplateId: "sdd.smell.reduce-params",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
  ] as HeroRule[]
).map((r) => ({ ...r, implementation: "structural" as const }));
