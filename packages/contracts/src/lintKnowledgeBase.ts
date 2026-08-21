import type { RuleLanguage } from "./rules.ts";

// ---------------------------------------------------------------------------
// Lint / clean-code knowledge base.
//
// This is a TAXONOMY of well-known defect classes, not a copy of any vendor's
// rule catalog: each topic is described in our own words, with the shape a
// deterministic CodeHero check would take. Its purpose is to ground the
// offline rule-proposal prompt so Genkit proposes rules that fill real gaps
// in our catalog instead of re-proposing the same handful of OWASP patterns.
//
// The taxonomy is drawn from the defect classes that the mainstream linters
// converge on (SonarQube "Sonar way", ESLint/typescript-eslint, Pylint,
// Checkstyle/SpotBugs, StyleCop/Roslyn analyzers, go vet/staticcheck) — the
// categories themselves are common engineering knowledge.
// ---------------------------------------------------------------------------

export type LintFamily = "security" | "dress" | "smell";

export interface LintTopic {
  /** kebab-case, stable — used to dedupe across runs. */
  id: string;
  title: string;
  languages: RuleLanguage[];
  family: LintFamily;
  /** What a deterministic check should look for — goes into the prompt. */
  hint: string;
  /**
   * Lowercase substrings that mean the catalog already covers this topic.
   * Matched against a rule's id + name + message.
   */
  keywords: string[];
  /**
   * False when the defect fundamentally needs AST/metrics (complexity,
   * coupling, duplication) and cannot be expressed as an L0 line regex.
   * The proposal prompt only receives regex-feasible gaps, since
   * newRulesFlow is constrained to L0 patterns.
   */
  regexFeasible: boolean;
}

export const LINT_KNOWLEDGE_BASE: LintTopic[] = [
  // --- Cross-language hygiene -------------------------------------------
  {
    id: "empty-catch-block",
    title: "Bloco catch/except vazio (erro engolido)",
    languages: ["any"],
    family: "smell",
    hint: "catch/except que não loga, não relança e não trata — falha some silenciosamente em produção.",
    keywords: ["empty-catch", "catch vazio", "swallow", "erro engolido"],
    regexFeasible: true,
  },
  {
    id: "commented-out-code",
    title: "Código comentado deixado no fonte",
    languages: ["any"],
    family: "smell",
    hint: "Linha comentada que ainda parece código (atribuição, chamada de função, if) — o histórico do git já cumpre esse papel.",
    keywords: ["commented-out", "codigo comentado", "dead-code"],
    regexFeasible: true,
  },
  {
    id: "magic-number",
    title: "Número mágico em regra de negócio",
    languages: ["any"],
    family: "smell",
    hint: "Literal numérico não-trivial (fora de 0/1/-1) usado direto em comparação ou cálculo, sem constante nomeada.",
    keywords: ["magic-number", "numero magico", "literal"],
    regexFeasible: true,
  },
  {
    id: "hardcoded-absolute-path",
    title: "Caminho absoluto hardcoded",
    languages: ["any"],
    family: "smell",
    hint: "Caminho tipo C:\\... ou /home/<user>/... embutido no código — quebra fora da máquina do autor.",
    keywords: ["hardcoded-path", "caminho absoluto", "absolute-path"],
    regexFeasible: true,
  },
  {
    id: "long-function",
    title: "Função longa demais",
    languages: ["any"],
    family: "smell",
    hint: "Função acima de ~60 linhas — exige contagem de corpo, não é expressável em regex de linha.",
    keywords: ["long-function", "funcao longa", "method-length"],
    regexFeasible: false,
  },
  {
    id: "high-cyclomatic-complexity",
    title: "Complexidade ciclomática alta",
    languages: ["any"],
    family: "smell",
    hint: "Excesso de caminhos de decisão — precisa de CFG, fora do alcance do L0.",
    keywords: ["complexity", "complexidade", "cyclomatic"],
    regexFeasible: false,
  },
  {
    id: "deep-nesting",
    title: "Aninhamento profundo de blocos",
    languages: ["any"],
    family: "smell",
    hint: "Mais de 4 níveis de if/for aninhados — depende de estrutura de blocos, não de uma linha.",
    keywords: ["nesting", "aninhamento"],
    regexFeasible: false,
  },
  {
    id: "duplicated-block",
    title: "Bloco duplicado",
    languages: ["any"],
    family: "smell",
    hint: "Trechos repetidos — exige comparação entre arquivos, fora do alcance do L0.",
    keywords: ["duplicat", "duplicad"],
    regexFeasible: false,
  },

  // --- JavaScript / TypeScript -------------------------------------------
  {
    id: "loose-equality",
    title: "Comparação frouxa == / != em JS/TS",
    languages: ["javascript", "typescript"],
    family: "smell",
    hint: "== e != aplicam coerção de tipo e escondem bugs; salvo o idioma `== null`, o correto é === / !==.",
    keywords: ["loose-equality", "igualdade frouxa", "triple-equal"],
    regexFeasible: true,
  },
  {
    id: "floating-promise",
    title: "Promise não aguardada nem tratada",
    languages: ["javascript", "typescript"],
    family: "smell",
    hint: "Chamada async invocada sem await, .then/.catch ou void — rejeição vira unhandled rejection.",
    keywords: ["floating-promise", "promise", "unhandled-rejection"],
    regexFeasible: true,
  },
  {
    id: "await-in-loop",
    title: "await dentro de laço sequencial",
    languages: ["javascript", "typescript"],
    family: "smell",
    hint: "await em for/while serializa I/O que poderia ir em Promise.all — degrada latência linearmente.",
    keywords: ["await-in-loop", "await no laco"],
    regexFeasible: true,
  },
  {
    id: "typescript-any-escape",
    title: "Uso de `any` anulando a tipagem",
    languages: ["typescript"],
    family: "smell",
    hint: "Anotação `: any` ou `as any` desliga a verificação justamente onde ela protegeria.",
    keywords: ["any-type", "tipagem any", "no-explicit-any"],
    regexFeasible: true,
  },
  {
    id: "non-null-assertion",
    title: "Asserção não-nula (!) em TypeScript",
    languages: ["typescript"],
    family: "smell",
    hint: "O operador `!` promete ao compilador algo que ele não provou — vira TypeError em runtime.",
    keywords: ["non-null", "nao-nula", "assertion"],
    regexFeasible: true,
  },
  {
    id: "var-declaration",
    title: "Declaração com `var`",
    languages: ["javascript", "typescript"],
    family: "dress",
    hint: "`var` tem escopo de função e hoisting; let/const são o padrão desde ES6.",
    keywords: ["var-declaration", "declaracao var", "prefer-const"],
    regexFeasible: true,
  },
  {
    id: "settimeout-string-arg",
    title: "setTimeout/setInterval com string",
    languages: ["javascript", "typescript"],
    family: "security",
    hint: "String como primeiro argumento é avaliada como código — eval disfarçado.",
    keywords: ["settimeout", "setinterval"],
    regexFeasible: true,
  },
  {
    id: "document-write",
    title: "document.write em runtime",
    languages: ["javascript", "typescript"],
    family: "security",
    hint: "Reescreve o documento e é vetor clássico de XSS quando recebe dado dinâmico.",
    keywords: ["document.write", "document-write"],
    regexFeasible: true,
  },

  // --- Python -------------------------------------------------------------
  {
    id: "mutable-default-argument",
    title: "Argumento default mutável",
    languages: ["python"],
    family: "smell",
    hint: "def f(x=[]) / ={} avalia o default uma única vez — o estado vaza entre chamadas.",
    keywords: ["mutable-default", "default mutavel"],
    regexFeasible: true,
  },
  {
    id: "bare-except",
    title: "except sem tipo (bare except)",
    languages: ["python"],
    family: "smell",
    hint: "`except:` captura até KeyboardInterrupt/SystemExit e mascara falhas reais.",
    keywords: ["bare-except", "except generico"],
    regexFeasible: true,
  },
  {
    id: "assert-in-production",
    title: "assert como validação de produção",
    languages: ["python"],
    family: "security",
    hint: "asserts somem com `python -O`; usados para autorização ou validação viram bypass silencioso.",
    keywords: ["assert"],
    regexFeasible: true,
  },
  {
    id: "type-equality-comparison",
    title: "Comparação de tipo com type(x) ==",
    languages: ["python"],
    family: "smell",
    hint: "Ignora herança; isinstance() é a forma correta.",
    keywords: ["type-comparison", "isinstance"],
    regexFeasible: true,
  },
  {
    id: "global-statement",
    title: "Uso de `global` para estado mutável",
    languages: ["python"],
    family: "smell",
    hint: "Estado global mutável cria acoplamento invisível e quebra sob concorrência.",
    keywords: ["global-statement", "estado global"],
    regexFeasible: true,
  },

  // --- Java ---------------------------------------------------------------
  {
    id: "catch-throwable",
    title: "catch (Throwable) ou catch (Exception) genérico",
    languages: ["java"],
    family: "smell",
    hint: "Captura Error/OutOfMemory junto e impede o tratamento específico.",
    keywords: ["catch-throwable", "catch generico"],
    regexFeasible: true,
  },
  {
    id: "string-concat-in-loop",
    title: "Concatenação de String em laço",
    languages: ["java", "csharp", "vbnet"],
    family: "smell",
    hint: "s += ... dentro de for/while é O(n²) em memória; StringBuilder resolve.",
    keywords: ["string-concat", "stringbuilder", "concatenacao"],
    regexFeasible: true,
  },
  {
    id: "printstacktrace",
    title: "printStackTrace() no lugar de log",
    languages: ["java"],
    family: "smell",
    hint: "Escreve em stderr fora do pipeline de observabilidade — o erro se perde.",
    keywords: ["printstacktrace", "stack trace"],
    regexFeasible: true,
  },
  {
    id: "equals-without-hashcode",
    title: "equals() sem hashCode()",
    languages: ["java", "csharp"],
    family: "smell",
    hint: "Quebra o contrato de HashMap/HashSet — precisa ver a classe inteira, não uma linha.",
    keywords: ["hashcode", "equals"],
    regexFeasible: false,
  },
  {
    id: "resource-not-closed",
    title: "Recurso aberto sem try-with-resources/using",
    languages: ["java", "csharp", "vbnet"],
    family: "smell",
    hint: "Stream/Connection/Reader instanciado fora de try-with-resources (Java) ou using (.NET) vaza handle.",
    keywords: ["resource", "try-with-resources", "using", "not-closed"],
    regexFeasible: true,
  },
  {
    id: "system-exit-in-library",
    title: "System.exit() fora de main",
    languages: ["java"],
    family: "smell",
    hint: "Derruba a JVM inteira a partir de código de biblioteca.",
    keywords: ["system.exit", "system-exit"],
    regexFeasible: true,
  },
  {
    id: "thread-sleep-busy-wait",
    title: "Thread.sleep como sincronização",
    languages: ["java", "csharp", "vbnet"],
    family: "smell",
    hint: "sleep para 'esperar' outra thread é corrida disfarçada; use primitivas de sincronização.",
    keywords: ["thread.sleep", "sleep"],
    regexFeasible: true,
  },

  // --- Go -----------------------------------------------------------------
  {
    id: "ignored-error-return",
    title: "Erro descartado com _",
    languages: ["go"],
    family: "smell",
    hint: "`_ = f()` ou `x, _ := f()` joga fora o error idiomático do Go e esconde falha.",
    keywords: ["ignored-error", "erro descartado", "blank identifier"],
    regexFeasible: true,
  },
  {
    id: "defer-in-loop",
    title: "defer dentro de laço",
    languages: ["go"],
    family: "smell",
    hint: "defer só roda no fim da função — acumula recursos abertos a cada iteração.",
    keywords: ["defer"],
    regexFeasible: true,
  },
  {
    id: "panic-in-library",
    title: "panic() em código de biblioteca",
    languages: ["go"],
    family: "smell",
    hint: "panic derruba o processo; código reutilizável deve devolver error.",
    keywords: ["panic"],
    regexFeasible: true,
  },
  {
    id: "context-background-in-handler",
    title: "context.Background() em caminho de request",
    languages: ["go"],
    family: "smell",
    hint: "Descarta cancelamento e deadline do request — a goroutine continua após o cliente desistir.",
    keywords: ["context.background", "context"],
    regexFeasible: true,
  },
  {
    id: "http-no-timeout",
    title: "http.Client sem Timeout",
    languages: ["go"],
    family: "security",
    hint: "Cliente HTTP default não tem timeout — um peer lento trava a goroutine indefinidamente.",
    keywords: ["timeout", "http.client"],
    regexFeasible: true,
  },

  // --- C# / VB.NET --------------------------------------------------------
  {
    id: "async-void",
    title: "async void fora de event handler",
    languages: ["csharp"],
    family: "smell",
    hint: "Exceções em async void não são capturáveis e derrubam o processo.",
    keywords: ["async void", "async-void"],
    regexFeasible: true,
  },
  {
    id: "blocking-on-async",
    title: "Bloqueio em código assíncrono (.Result / .Wait())",
    languages: ["csharp", "vbnet"],
    family: "smell",
    hint: "Task.Result e .Wait() causam deadlock em contexto de sincronização e consomem thread do pool.",
    keywords: [".result", ".wait()", "deadlock"],
    regexFeasible: true,
  },
  {
    id: "catch-general-exception-dotnet",
    title: "catch (Exception) genérico em .NET",
    languages: ["csharp", "vbnet"],
    family: "smell",
    hint: "Captura tudo, inclusive falhas de infraestrutura que deveriam propagar.",
    keywords: ["catch (exception", "catch generico"],
    regexFeasible: true,
  },

  // --- SQL (T-SQL / DB2) --------------------------------------------------
  {
    id: "select-star",
    title: "SELECT * em código de aplicação",
    languages: ["tsql", "db2sql"],
    family: "smell",
    hint: "Traz colunas desnecessárias e quebra silenciosamente quando o schema muda.",
    keywords: ["select *", "select star"],
    regexFeasible: true,
  },
  {
    id: "dml-without-where",
    title: "UPDATE/DELETE sem WHERE",
    languages: ["tsql", "db2sql"],
    family: "security",
    hint: "Afeta a tabela inteira — incidente de dados clássico e irreversível sem backup.",
    keywords: ["without where", "sem where", "update", "delete"],
    regexFeasible: true,
  },
  {
    id: "nolock-hint",
    title: "Hint WITH (NOLOCK)",
    languages: ["tsql"],
    family: "smell",
    hint: "Permite dirty read: retorna linhas de transações não confirmadas.",
    keywords: ["nolock"],
    regexFeasible: true,
  },
  {
    id: "cursor-not-closed",
    title: "CURSOR aberto sem CLOSE/DEALLOCATE",
    languages: ["tsql", "db2sql"],
    family: "smell",
    hint: "Cursor não liberado segura locks e conexão — exige correlacionar OPEN/CLOSE no procedimento.",
    keywords: ["cursor"],
    regexFeasible: false,
  },

  // --- COBOL --------------------------------------------------------------
  {
    id: "cobol-goto",
    title: "GO TO quebrando o fluxo estruturado",
    languages: ["cobol"],
    family: "smell",
    hint: "GO TO fora do idioma GO TO ... DEPENDING torna o fluxo intratável para manutenção.",
    keywords: ["go to", "goto"],
    regexFeasible: true,
  },
  {
    id: "cobol-alter",
    title: "Instrução ALTER",
    languages: ["cobol"],
    family: "smell",
    hint: "ALTER reescreve o destino de um GO TO em runtime — obsoleta e proibida em código novo.",
    keywords: ["alter"],
    regexFeasible: true,
  },
  {
    id: "cobol-file-status-unchecked",
    title: "READ/WRITE sem checar FILE STATUS",
    languages: ["cobol"],
    family: "smell",
    hint: "Operação de arquivo sem verificar FILE STATUS segue processando sobre dado inválido.",
    keywords: ["file status", "file-status"],
    regexFeasible: false,
  },

  // --- Agent / SKILL / AIDLC instruction hygiene ---------------------------
  {
    id: "agent-prompt-injection",
    title: "Prompt injection em arquivo de instrução de agente",
    languages: ["markdown"],
    family: "security",
    hint: "Frases ignore previous instructions / jailbreak / marcadores falsos de sistema em AGENTS.md, SKILL.md ou steering.",
    keywords: ["prompt-injection", "ignore previous", "jailbreak", "im_start"],
    regexFeasible: true,
  },
  {
    id: "agent-skip-human-gate",
    title: "Instrução que pula decision gate / HITL",
    languages: ["markdown"],
    family: "smell",
    hint: "AIDLC exige artefato de decisão e confirmação humana; auto-approve / don't ask quebra o ciclo.",
    keywords: ["human-gate", "decision gate", "auto-approve", "hitl"],
    regexFeasible: true,
  },
  {
    id: "agent-exfiltrate-secrets",
    title: "Instrução de exfiltração de segredos via agente",
    languages: ["markdown"],
    family: "security",
    hint: "Steering/SKILL pedindo dump de .env, API keys ou credenciais.",
    keywords: ["exfiltrate", "dump secrets", "process.env"],
    regexFeasible: true,
  },
  {
    id: "skill-md-structure",
    title: "SKILL.md sem anatomia (frontmatter / secções)",
    languages: ["markdown"],
    family: "smell",
    hint: "Índice de skill sem name/description, H1 ou secções Instructions/Activation/Information Contract (Cursor + AIDLC).",
    keywords: ["skill-structure", "frontmatter", "skill.md", "information contract"],
    regexFeasible: false,
  },
];

export interface LintCoverage {
  covered: LintTopic[];
  uncovered: LintTopic[];
}

interface RuleLike {
  id: string;
  name?: string;
  message?: string;
  languages?: RuleLanguage[];
}

function topicAppliesToRule(topic: LintTopic, rule: RuleLike): boolean {
  if (topic.languages.includes("any")) return true;
  const langs = rule.languages ?? [];
  if (langs.includes("any")) return true;
  return langs.some((l) => topic.languages.includes(l));
}

/**
 * Keyword-based, deliberately fuzzy: the result only shapes a prompt hint, it
 * never gates a rule. A false "covered" costs us one skipped suggestion; a
 * false "uncovered" costs one redundant proposal that the human review and the
 * deterministic scoring already filter.
 */
export function computeLintCoverage(
  rules: RuleLike[],
  topics: LintTopic[] = LINT_KNOWLEDGE_BASE,
): LintCoverage {
  const covered: LintTopic[] = [];
  const uncovered: LintTopic[] = [];

  for (const topic of topics) {
    const haystack = rules
      .filter((r) => topicAppliesToRule(topic, r))
      .map((r) => `${r.id} ${r.name ?? ""} ${r.message ?? ""}`.toLowerCase())
      .join(" | ");
    const hit = topic.keywords.some((k) => haystack.includes(k.toLowerCase()));
    (hit ? covered : uncovered).push(topic);
  }

  return { covered, uncovered };
}

/** Stable day index — same day always yields the same window. */
export function lintGapWindowSeed(isoDay: string): number {
  const t = Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.floor(t / 86_400_000);
}

/**
 * Formats the regex-feasible gaps for the new-rule proposal prompt.
 *
 * Topics flagged regexFeasible=false are dropped: newRulesFlow can only emit
 * L0 patterns, so asking for them would only produce unusable drafts.
 *
 * The window ROTATES per day. The batch proposes at most a handful of rules
 * per run, so a fixed head-of-list window would permanently starve whatever
 * sits at the tail — which is exactly where our thinnest coverage lives
 * (Go, C#/VB.NET, SQL, COBOL). Rotation is seeded by the day, so a run stays
 * reproducible while every gap eventually gets its turn.
 */
export function formatLintGapDigest(
  coverage: LintCoverage,
  maxItems = 18,
  seed = 0,
): string {
  const feasible = coverage.uncovered.filter((t) => t.regexFeasible);
  if (feasible.length === 0) {
    return "Lacunas de lint/clean-code: nenhuma pendente no catálogo atual.";
  }

  const size = Math.min(maxItems, feasible.length);
  const pages = Math.ceil(feasible.length / size);
  const start = ((seed % pages) + pages) % pages * size;
  const window: LintTopic[] = [];
  for (let i = 0; i < size; i++) {
    const topic = feasible[(start + i) % feasible.length];
    if (topic) window.push(topic);
  }

  const lines = window.map(
    (t) => `- [${t.family}] ${t.id} (${t.languages.join(",")}): ${t.title} — ${t.hint}`,
  );
  const omitted = feasible.length - window.length;
  const tail = omitted > 0 ? `\n(+${omitted} outras lacunas fora da janela de hoje)` : "";

  return `Lacunas de lint/clean-code ainda NÃO cobertas pelo catálogo ativo (priorize estas):\n${lines.join("\n")}${tail}`;
}
