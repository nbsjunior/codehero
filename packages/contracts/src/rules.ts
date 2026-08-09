import type { Severity, IssueType } from "./severity.ts";
import type { SecurityCategory, TaintSinkKind, TaintSourceKind } from "./engineKinds.ts";
import type { PatternScope } from "./lexicalMask.ts";
import { SONAR_WAY_LIVE_RULES } from "./sonarWayLive.ts";
import { QUANTUM_SAFE_RULES } from "./quantumSafe.ts";
import { COBOL_CORE_RULES } from "./cobolRules.ts";
import { STRUCTURAL_RULES } from "./structuralCatalog.ts";

// ---------------------------------------------------------------------------
// Hero-IR — declarative rule format.
// L0 `pattern` (regex), L1 `ast` (structural), L2 `taint` (source→sink).
// All layers share the same rule id / SDD / metrics surface.
// ---------------------------------------------------------------------------

export type RuleLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "java"
  | "go"
  | "csharp"
  | "vbnet"
  | "cobol"
  | "tsql"
  | "db2sql"
  | "any";

export interface AstRuleSpec {
  kind: "call";
  callees: string[];
  /** When true, only flag if the first/last argument is not a compile-time literal. */
  requiresNonLiteralArg?: boolean;
}

export interface TaintRuleSpec {
  sources: TaintSourceKind[];
  sinks: TaintSinkKind[];
  sanitizers?: string[];
}

export interface HeroRule {
  id: string;
  name: string;
  languages: RuleLanguage[];
  severity: Severity;
  type: IssueType;
  /** Effort in minutes to remediate one occurrence — feeds SQALE debt. */
  remediationEffortMin: number;
  cwe: string[];
  owasp: string[];
  message: string;
  /** Links to an SDD remediation template (see sdd.ts). */
  sddTemplateId: string;
  /** GitHub-style detection category (AI detections taxonomy). */
  category?: SecurityCategory;
  /** L0 matcher: JS regex source applied per line. */
  pattern: {
    regex: string;
    flags?: string;
    unless?: string;
    /**
     * Onde a regra pode casar. Padrão `code`: comentário e conteúdo de string
     * ficam invisíveis.
     *
     * Medido no repo antes disto existir: de 542 apontamentos, 304 caíam
     * dentro de literal de string e 49 dentro de comentário — 65% do total,
     * incluindo regras disparando no comentário que as descreve.
     *
     * `comments` e `strings` são para as regras que dependem justamente do
     * contexto que as outras precisam ignorar (rastrear TODO, achar segredo
     * embutido). Sem esses dois modos a máscara mataria as regras certas.
     */
    scope?: PatternScope;
  };
  /** L1: structural AST check (JS/TS deep engine). */
  ast?: AstRuleSpec;
  /** L2: source→sink taint (JS/TS deep engine). */
  taint?: TaintRuleSpec;
  /** Original SonarQube rule key when imported from Sonar way. */
  sonarKey?: string;
  /**
   * How this rule is executed:
   * - core: hand-authored CodeHero L0 rule
   * - sonar-port: L0 port synthesized from Sonar way metadata
   * - structural: tree-sitter / AST structural matcher (HERO-ST-*)
   * - stub: catalog-only (no live detection; pattern never matches)
   */
  implementation?: "core" | "sonar-port" | "structural" | "stub";
}

// The canonical starter rule set. In production this bundle is generated and
// validated offline by hero-ruleforge; here it is hand-authored to bootstrap.
/** Hand-authored CodeHero core rules (always live in the scanner). */
const _CORE_BASE: HeroRule[] = (
  [
  {
    id: "HERO-SEC-0798-hardcoded-secret",
    name: "HardcodedSecret",
    languages: ["any"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 15,
    cwe: ["CWE-798"],
    owasp: ["A07:2021-Identification and Authentication Failures"],
    message: "Credencial ou chave de API hardcoded no código-fonte.",
    sddTemplateId: "sdd.secret.externalize",
    category: "sensitive-data-exposure",
    // Pattern promovido por hero-ruleforge (busca evolutiva determinística,
    // seed=42) em 2026-07-26: F1 0.50 -> 1.00 no corpus golden, sem regressões.
    // Mutações aplicadas: widen-unless-fixture-words, widen-charclass-specials.
    // Ver packages/ruleforge/corpus/golden.json (casos secret-02, secret-05).
    pattern: {
      scope: "any",
      regex: "(?i)(api[_-]?key|secret|passwd|password|token|aws_secret_access_key)\\s*[:=]\\s*['\"][A-Za-z0-9_\\-/+!@#$%^&*]{12,}['\"]",
      unless: "(?i)(process\\.env|os\\.environ|getenv|import\\.meta\\.env|example|placeholder|xxxx|<.*>)|(dummy|sample|fake|mock)",
    },
  },
  {
    id: "HERO-SEC-0089-sql-injection",
    name: "SqlInjection",
    languages: ["python", "javascript", "typescript"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-89"],
    owasp: ["A03:2021-Injection"],
    message: "Query SQL construída por concatenação de string (risco de SQL Injection).",
    sddTemplateId: "sdd.sqli.parametrize",
    category: "string-injection",
    // Pattern cobre concatenação clássica e template literals JS (`...${...}`).
    // Fluxos cross-statement são cobertos pelo engine L2 (taint) em JS/TS.
    pattern: {
      scope: "any",
      regex:
        "(?i)(execute|executemany|query|raw)\\s*\\(\\s*(`[^`]*\\$\\{|f['\"].*(select|insert|update|delete|drop).*\\{|['\"].*(select|insert|update|delete|drop).*['\"]\\s*(\\+|%|\\.format))",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "process.argv"],
      sinks: ["sql.execute"],
      sanitizers: ["escape", "mysql.escape"],
    },
  },
  {
    id: "HERO-SEC-0327-weak-hash",
    name: "WeakHashing",
    languages: ["python", "javascript", "typescript", "java"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 10,
    cwe: ["CWE-327", "CWE-328"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message: "Uso de algoritmo de hash fraco (MD5/SHA1) para dados sensíveis.",
    sddTemplateId: "sdd.crypto.upgrade-hash",
    category: "weak-crypto",
    // Pattern promovido por hero-ruleforge (busca evolutiva determinística,
    // seed=42) em 2026-07-26: F1 0.67 -> 1.00 no corpus golden, sem regressões.
    // Mutação aplicada: add-hashlib-new-alt. Ver corpus caso hash-02.
    pattern: {
      scope: "any",
      regex: "(?i)(md5|sha1)\\s*\\(|hashlib\\.(md5|sha1)|createHash\\(\\s*['\"](md5|sha1)['\"]|hashlib\\.new\\(\\s*['\"](md5|sha1)['\"]",
    },
    ast: {
      kind: "call",
      callees: ["createHash", "md5", "sha1", "hashlib.md5", "hashlib.sha1"],
      requiresNonLiteralArg: false,
    },
  },
  {
    id: "HERO-SEC-0095-code-injection-eval",
    name: "DangerousEval",
    languages: ["python", "javascript", "typescript"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-95"],
    owasp: ["A03:2021-Injection"],
    message: "Uso de eval()/exec() com entrada potencialmente controlada (code injection).",
    sddTemplateId: "sdd.eval.remove",
    category: "string-injection",
    pattern: {
      regex: "(?<![.\\w])(eval|exec)\\s*\\(",
      unless: "(?i)(#\\s*nosec|eslint-disable|safe-eval)",
    },
    ast: {
      kind: "call",
      callees: ["eval", "Function"],
      requiresNonLiteralArg: true,
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input", "process.argv"],
      sinks: ["eval", "function_ctor"],
    },
  },
  {
    id: "HERO-SEC-0079-xss-sink",
    name: "DomXssSink",
    languages: ["javascript", "typescript"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-79"],
    owasp: ["A03:2021-Injection"],
    message: "Dados controlados pelo usuário fluem para sink DOM XSS (innerHTML/document.write).",
    sddTemplateId: "sdd.xss.sanitize",
    category: "string-injection",
    pattern: {
      regex: "(?i)\\.innerHTML\\s*=",
      unless: "(?i)(DOMPurify|sanitize|textContent)",
    },
    taint: {
      sources: ["http.param", "http.body", "user.input"],
      sinks: ["html.innerHTML", "html.documentWrite"],
      sanitizers: ["DOMPurify.sanitize", "sanitize"],
    },
  },
  {
    id: "HERO-SEC-0078-os-command",
    name: "OsCommandInjection",
    languages: ["javascript", "typescript"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-78"],
    owasp: ["A03:2021-Injection"],
    message: "Entrada de usuário alcança child_process (command injection).",
    sddTemplateId: "sdd.cmd.avoid-shell",
    category: "string-injection",
    // O padrão anterior — `(exec|execSync|spawn)\s*\(` — casava com qualquer
    // `exec(`, confundindo RegExp.prototype.exec (`re.exec(line)`) com
    // child_process.exec e disparando até dentro de comentários. Medido no
    // avaliador determinístico: precision 0.545 -> 1.000, recall 1.000
    // mantido (casos os-01..os-12 em corpus/golden.json).
    // A forma de método só conta quando o receptor nomeia child_process;
    // a chamada nua continua contando.
    //
    // SEGUNDA AUDITORIA: a versão acima ainda acusava `spawnSync("where",
    // [bin])` — 35 vezes no próprio repositório, e era a regra BLOCKER mais
    // frequente do catálogo. A distinção é técnica e não estava sendo feita:
    // `exec`/`execSync` executam via SHELL, então importam quando o comando é
    // MONTADO; `spawn`/`execFile` não usam shell e só são perigosos com
    // `shell: true` explícito.
    pattern: {
      // `any` porque a interpolação que caracteriza o comando montado vive
      // DENTRO da string — com o escopo `code` a máscara a apaga antes da
      // regex ver, e a regra perdia 3 dos 4 casos de corpus.
      scope: "any",
      // Três formas, nesta ordem:
      //   1. `exec`/`execSync` cujo 1º argumento NÃO é literal de aspas — o
      //      shell executa o que estiver na variável;
      //   2. `exec`/`execSync` com literal CONCATENADO;
      //   3. família `spawn`/`execFile` com `shell: true` explícito.
      // O lookbehind `(?<![.\w])` na forma nua é o que impede `re.exec(line)`
      // de virar command injection — foi um falso positivo real, corrigido e
      // travado nos casos os-08..os-11 do corpus.
      // SEM `(?i)`: JavaScript é case-sensitive e estas funções são sempre
      // camelCase. Com o flag, `EXEC(@sql)` — texto de T-SQL dentro de uma
      // string do próprio catálogo — virava command injection. Detector de
      // identificador em linguagem case-sensitive não pode ignorar caixa.
      regex:
        "(?:(?:child_process|childProcess|cp)\\s*\\.\\s*(?:execSync|exec)|(?<![.\\w])(?:execSync|exec))\\s*\\(\\s*(?!['\"])" +
        "|(?:(?:child_process|childProcess|cp)\\s*\\.\\s*)?(?<![.\\w])(?:execSync|exec)\\s*\\([^)]*['\"]\\s*\\+" +
        "|(?<![.\\w])(?:spawnSync|spawn|execFile|execFileSync|execSync|exec)\\s*\\([^)]*shell\\s*:\\s*true",
      unless: "(?i)(shell\\s*:\\s*false)|^\\s*(//|\\*|#)",
    },
    taint: {
      sources: ["http.param", "http.body", "process.argv"],
      sinks: ["child_process"],
    },
  },
  {
    id: "HERO-SEC-0918-ssrf",
    name: "ServerSideRequestForgery",
    languages: ["javascript", "typescript"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-918"],
    owasp: ["A10:2021-Server-Side Request Forgery"],
    message: "URL controlada pelo usuário em fetch/HTTP request (SSRF).",
    sddTemplateId: "sdd.ssrf.allowlist",
    category: "ssrf",
    pattern: {
      scope: "any",
      regex: "(?:fetch|axios\\.get|axios\\.post|http\\.get|https\\.get|request)\\s*\\(\\s*[`'\"]?[^`'\"]*\\$\\{",
      // SCREAMING_CASE é constante de módulo por convenção universal em JS —
      // não é valor vindo do usuário. Sem esta exclusão a regra acusa todo
      // `fetch(`${API_BASE}/x`)`: foram 5 falsos positivos e zero verdadeiros
      // no próprio repositório, numa regra CRITICAL.
      unless: "\\$\\{\\s*[A-Z_][A-Z0-9_]*\\s*\\}",
    },
    taint: {
      sources: ["http.param", "http.body"],
      sinks: ["network.request"],
    },
  },
  {
    id: "HERO-SEC-0022-path-traversal",
    name: "PathTraversal",
    languages: ["javascript", "typescript"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-22"],
    owasp: ["A01:2021-Broken Access Control"],
    message: "Caminho de arquivo derivado de input do usuário (path traversal).",
    sddTemplateId: "sdd.path.normalize-allowlist",
    category: "broken-access-control",
    pattern: {
      regex: "(?:readFileSync|writeFileSync|readFile|writeFile|createReadStream|createWriteStream|path\\.join|path\\.resolve|fs\\.(?:readFileSync|writeFileSync|readFile|writeFile|createReadStream|createWriteStream))\\s*\\([^)]*(?:req\\.|query\\.|params\\.|body\\.|argv|userInput|\\buserId\\b|\\binput\\b)",
    },
    // O pattern exige fonte de input (req, argv, etc.) — sem isso nao ha
    // path traversal. O taint (L2) cobre o fluxo indireto.
    taint: {
      sources: ["http.param", "http.body", "process.argv"],
      sinks: ["fs.path"],
      sanitizers: ["path.normalize", "basename"],
    },
  },
  {
    id: "HERO-SEC-0601-open-redirect",
    name: "OpenRedirect",
    languages: ["javascript", "typescript"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 15,
    cwe: ["CWE-601"],
    owasp: ["A01:2021-Broken Access Control"],
    message: "Redirect com URL controlada pelo usuário (open redirect).",
    sddTemplateId: "sdd.redirect.allowlist",
    category: "broken-access-control",
    pattern: {
      scope: "any",
      regex: "(?:\\.redirect|window\\.location|location\\.href|location\\.assign|location\\.replace)\\s*[\\(=]\\s*[`'\"]?[^\\)`'\"]*\\$\\{",
    },
    taint: {
      sources: ["http.param", "http.body"],
      sinks: ["http.redirect"],
    },
  },
  {
    id: "HERO-SEC-1321-prototype-pollution",
    name: "PrototypePollutionMerge",
    languages: ["javascript", "typescript"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-1321"],
    owasp: ["A08:2021-Software and Data Integrity Failures"],
    message: "Merge/assign de objeto controlado pelo usuário (risco de prototype pollution).",
    sddTemplateId: "sdd.merge.safe-assign",
    category: "data-integrity",
    pattern: {
      regex: "(?i)(Object\\.assign|_\\.merge|_\\.extend|_\\.defaultsDeep|merge|extend)\\s*\\([^,]+,\\s*(req\\.(body|query|params)|JSON\\.parse|user|input|data|body)",
    },
    taint: {
      sources: ["http.param", "http.body"],
      sinks: ["object.merge"],
    },
  },
  {
    id: "HERO-SEC-0330-insecure-random",
    name: "InsecureRandomForSecrets",
    languages: ["javascript", "typescript"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 10,
    cwe: ["CWE-330"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message: "Math.random() usado em contexto de token/secret/password (CSPRNG necessário).",
    sddTemplateId: "sdd.crypto.secure-random",
    category: "weak-crypto",
    pattern: {
      regex: "(?i)(token|secret|password|api[_-]?key|nonce|session|salt|iv|key).{0,60}(Math\\.random|crypto\\.pseudoRandomBytes)",
    },
    // Presence Fase 3: L0 contextual + AST call (reduz FP de Math.random em jogos/UI).
    ast: {
      kind: "call",
      callees: ["Math.random"],
      requiresNonLiteralArg: false,
    },
  },
  {
    id: "HERO-SEC-0295-tls-verify-disabled",
    name: "TlsVerificationDisabled",
    languages: ["javascript", "typescript"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 5,
    cwe: ["CWE-295"],
    owasp: ["A07:2021-Identification and Authentication Failures"],
    message: "Verificação TLS desabilitada (NODE_TLS_REJECT_UNAUTHORIZED=0).",
    sddTemplateId: "sdd.tls.enable-verify",
    category: "authentication-failures",
    pattern: {
      scope: "any",
      regex: "(?i)NODE_TLS_REJECT_UNAUTHORIZED\\s*=\\s*['\"]?0['\"]?",
    },
  },
  {
    id: "HERO-SEC-0532-secret-in-log",
    name: "SecretInLog",
    languages: ["javascript", "typescript"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 10,
    cwe: ["CWE-532"],
    owasp: ["A09:2021-Security Logging and Monitoring Failures"],
    message: "Possível segredo/token/password escrito em log.",
    sddTemplateId: "sdd.log.redact-secrets",
    category: "sensitive-data-exposure",
    pattern: {
      regex: "(?i)console\\.(log|info|debug|error|warn)\\s*\\([^)]*(password|secret|token|api[_-]?key|authorization)",
    },
    taint: {
      sources: ["http.param", "http.body", "process.env"],
      sinks: ["log.write"],
      sanitizers: ["redact", "mask"],
    },
  },
  {
    id: "HERO-SEC-0506-pipe-to-shell",
    name: "CurlPipeToShell",
    languages: ["javascript", "typescript", "any"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-506"],
    owasp: ["A08:2021-Software and Data Integrity Failures"],
    message: "Download piped to shell (supply-chain / remote code execution risk).",
    sddTemplateId: "sdd.supply.verify-checksum",
    category: "supply-chain",
    pattern: {
      scope: "any",
      regex: "(?i)(curl|wget).{0,80}\\|\\s*(ba)?sh",
      // A regra roda em `scope: any` (o corpus golden prova que mascarar a
      // quebra), então ela enxerga texto de interface. No próprio repositório
      // ela casou o PLACEHOLDER de um formulário — a frase de exemplo
      // "Sem curl | bash em scripts de setup". Prosa não é comando.
      unless: "(?i)placeholder|aria-|title=|Ex\\.:|exemplo|<p>|<li>|description",
    },
  },
  {
    id: "HERO-SMELL-0489-debug-statement",
    name: "DebugStatement",
    languages: ["python", "javascript", "typescript"],
    severity: "MINOR",
    type: "CODE_SMELL",
    remediationEffortMin: 2,
    cwe: ["CWE-489"],
    owasp: [],
    message: "Statement de debug (console.log / print / debugger) deixado no código.",
    sddTemplateId: "sdd.smell.remove-debug",
    category: "security-misconfiguration",
    pattern: {
      regex: "(?<![.\\w])(console\\.log|console\\.debug|debugger|print)\\s*\\(",
      unless: "(?i)(logger|logging|structlog|//\\s*allow-print)",
    },
    ast: {
      kind: "call",
      callees: ["console.log", "console.debug", "print"],
      requiresNonLiteralArg: false,
    },
  },
  {
    id: "HERO-SMELL-0546-todo-marker",
    name: "TodoMarker",
    languages: ["any"],
    severity: "INFO",
    type: "CODE_SMELL",
    remediationEffortMin: 5,
    cwe: [],
    owasp: [],
    message: "Marcador TODO/FIXME/HACK indica trabalho pendente ou débito técnico.",
    sddTemplateId: "sdd.smell.resolve-todo",
    category: "code-smell",
    pattern: {
      scope: "comments",
      regex: "(?i)(//|#|/\\*)\\s*(todo|fixme|hack|xxx)\\b",
    },
  },

  // --- Enterprise/legacy languages (SQL Server, DB2, C#, VB.Net, COBOL) ----
  // These require dedicated patterns rather than reusing the generic rules
  // above: T-SQL dynamic SQL, ADO.NET query building, and COBOL's assignment
  // syntax (MOVE ... TO, no `=`) are structurally different from the
  // Python/JS-shaped rules earlier in this catalog.

  {
    id: "HERO-SEC-0089-dynamic-sql-tsql",
    name: "DynamicSqlInjectionTSql",
    languages: ["tsql", "db2sql"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-89"],
    owasp: ["A03:2021-Injection"],
    message: "SQL dinâmico montado por concatenação de string (SET @sql = ... + ... ou EXEC('...' + ...)) em procedure T-SQL/DB2.",
    sddTemplateId: "sdd.sqli.parametrize",
    category: "string-injection",
    // Nota: o matcher MVP é por linha e não correlaciona `SET @sql = ...`
    // com um `EXEC(@sql)` em linha separada — o padrão mira a linha onde a
    // concatenação de fato ocorre. sp_executesql com parâmetros tipados
    // (forma segura) não contém "+" após a string, então não dispara.
    pattern: {
      scope: "any",
      regex: "(?i)(set\\s+@\\w+\\s*=|exec(ute)?\\s*\\(|sp_executesql)\\s*n?['\"].*(select|insert|update|delete).*['\"].*(\\+|concat|\\|\\|)",
    },
  },
  {
    id: "HERO-SEC-0089-adonet-sqli",
    name: "AdoNetSqlInjection",
    languages: ["csharp", "vbnet"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-89"],
    owasp: ["A03:2021-Injection"],
    message: "SqlCommand/OleDbCommand construído por concatenação ou interpolação de string (risco de SQL Injection).",
    sddTemplateId: "sdd.sqli.parametrize",
    category: "string-injection",
    pattern: {
      scope: "any",
      regex: "(?i)new\\s+(SqlCommand|OleDbCommand|OdbcCommand)\\s*\\(\\s*(\\$?['\"].*(select|insert|update|delete).*['\"]\\s*\\+|\\$['\"])",
    },
  },

  // --- Cobertura ampliada: Java (JDBC), C#/VB.Net, SQL Server ---------------
  // Regras COBOL: ver cobolRules.ts (pacote IBM ZCodeScan / RAA / L0).

  {
    id: "HERO-SEC-0089-jdbc-sqli",
    name: "JdbcSqlInjection",
    languages: ["java"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-89"],
    owasp: ["A03:2021-Injection"],
    message: "Statement JDBC construído por concatenação de string (risco de SQL Injection). Use PreparedStatement.",
    sddTemplateId: "sdd.sqli.parametrize",
    category: "string-injection",
    pattern: {
      scope: "any",
      regex: "(?i)\\.(executeQuery|executeUpdate|execute)\\s*\\(\\s*\"[^\"]*(select|insert|update|delete)[^\"]*\"\\s*\\+",
    },
    // L2: padrão dominante do OWASP Benchmark — query numa variável, sink depois.
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input", "process.argv", "filesystem.read"],
      sinks: ["sql.execute"],
      sanitizers: ["parseInt", "parseLong", "parseDouble", "escape", "encodeForSQL", "setString", "setInt"],
    },
  },
  {
    id: "HERO-SEC-0078-cmd-injection-java",
    name: "JavaCommandInjection",
    languages: ["java"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-78"],
    owasp: ["A03:2021-Injection"],
    message: "Comando de SO construído com entrada do usuário (command injection).",
    sddTemplateId: "sdd.cmd.avoid-shell",
    category: "string-injection",
    pattern: {
      scope: "any",
      regex: "(?i)(Runtime\\.getRuntime\\(\\)\\.exec|new\\s+ProcessBuilder)\\s*\\([^)]*\\+",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input", "process.argv"],
      sinks: ["child_process"],
      sanitizers: ["parseInt", "parseLong", "escape", "quote"],
    },
  },
  {
    id: "HERO-SEC-0022-path-traversal-java",
    name: "JavaPathTraversal",
    languages: ["java"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-22"],
    owasp: ["A01:2021-Broken Access Control"],
    message: "Caminho de arquivo construído com entrada do usuário (path traversal).",
    sddTemplateId: "sdd.path.normalize",
    category: "string-injection",
    pattern: {
      scope: "any",
      regex: "(?i)(new\\s+(File|FileInputStream|FileOutputStream)|Paths\\.get|Files\\.(read|write))\\s*\\([^)]*\\+",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input", "process.argv"],
      sinks: ["fs.path"],
      sanitizers: ["normalize", "getCanonicalPath", "toRealPath", "parseInt"],
    },
  },
  {
    id: "HERO-SEC-0079-xss-java",
    name: "JavaXss",
    languages: ["java"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 15,
    cwe: ["CWE-79"],
    owasp: ["A03:2021-Injection"],
    message: "Saída HTML construída com entrada do usuário sem escape (XSS refletido).",
    sddTemplateId: "sdd.xss.escape",
    category: "string-injection",
    pattern: {
      scope: "any",
      regex: "(?i)(getWriter\\(\\)\\.(print|println|write)|out\\.(print|println|write))\\s*\\([^)]*\\+",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input"],
      sinks: ["html.innerHTML"],
      sanitizers: ["escapeHtml", "encodeForHTML", "htmlEscape", "StringEscapeUtils"],
    },
  },
  {
    id: "HERO-SEC-0327-weak-hash-java",
    name: "JavaWeakHash",
    languages: ["java"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 10,
    cwe: ["CWE-327", "CWE-328"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message: "MessageDigest com algoritmo fraco (MD5/SHA1). Use SHA-256 ou superior.",
    sddTemplateId: "sdd.crypto.upgrade-hash",
    category: "weak-crypto",
    pattern: {
      scope: "any",
      regex: "(?i)MessageDigest\\.getInstance\\s*\\(\\s*\"(md5|sha-?1)\"",
    },
  },
  {
    id: "HERO-SEC-0614-insecure-cookie-java",
    name: "JavaInsecureCookie",
    languages: ["java"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 10,
    cwe: ["CWE-614"],
    owasp: ["A05:2021-Security Misconfiguration"],
    message: "Cookie criado sem setSecure(true) — pode trafegar em HTTP claro.",
    sddTemplateId: "sdd.cookie.secure-flag",
    category: "security-misconfiguration",
    // Ausência: casa o `new Cookie(` quando NÃO há setSecure no mesmo bloco.
    // L0 por linha não vê o bloco; o taint não se aplica. Fica como hotspot.
    pattern: {
      scope: "any",
      regex: "(?i)(?:set)?Secure\\s*[(=]\\s*false|secure\\s*:\\s*false",
    },
  },
  {
    id: "HERO-SEC-0090-ldap-injection-java",
    name: "JavaLdapInjection",
    languages: ["java"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-90"],
    owasp: ["A03:2021-Injection"],
    message: "Filtro LDAP construído com entrada do usuário (LDAP injection).",
    sddTemplateId: "sdd.ldap.escape",
    category: "string-injection",
    pattern: {
      scope: "any",
      // Exige concatenação — `.search(base, filter, ...)` sozinho não é vuln.
      regex: "(?i)\\.search\\s*\\([^)]*\\+",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input"],
      sinks: ["ldap.search"],
      sanitizers: ["escapeLdap", "encodeForLDAP", "LdapEncoder"],
    },
  },
  {
    id: "HERO-SEC-0643-xpath-injection-java",
    name: "JavaXPathInjection",
    languages: ["java"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-643"],
    owasp: ["A03:2021-Injection"],
    message: "Expressão XPath construída com entrada do usuário (XPath injection).",
    sddTemplateId: "sdd.xpath.parametrize",
    category: "string-injection",
    pattern: {
      scope: "any",
      regex: "(?i)(xpath|XPath).*(evaluate|compile)\\s*\\([^)]*\\+",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input"],
      sinks: ["xpath.evaluate"],
      sanitizers: ["escape", "encodeForXPath"],
    },
  },
  {
    id: "HERO-SEC-0501-trust-boundary-java",
    name: "JavaTrustBoundary",
    languages: ["java"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-501"],
    owasp: ["A04:2021-Insecure Design"],
    message: "Dado não confiável armazenado na sessão (trust boundary violation).",
    sddTemplateId: "sdd.session.validate",
    category: "security-misconfiguration",
    pattern: {
      scope: "any",
      regex: "(?i)\\.setAttribute\\s*\\([^)]*(request\\.|param|getParameter)",
    },
    taint: {
      sources: ["http.param", "http.body", "http.header", "user.input"],
      sinks: ["session.setAttribute"],
      sanitizers: ["parseInt", "parseLong", "escape", "validate"],
    },
  },
  {
    id: "HERO-SEC-0078-cmd-injection-dotnet",
    name: "DotNetCommandInjection",
    languages: ["csharp", "vbnet"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-78"],
    owasp: ["A03:2021-Injection"],
    message: "Process.Start com argumentos construídos por concatenação (risco de command injection).",
    sddTemplateId: "sdd.cmd.avoid-shell",
    category: "string-injection",
    pattern: {
      regex: "(?i)Process\\.Start\\s*\\([^)]*\\+",
    },
  },
  {
    id: "HERO-SEC-0502-insecure-deserialization-dotnet",
    name: "DotNetInsecureDeserialization",
    languages: ["csharp", "vbnet"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-502"],
    owasp: ["A08:2021-Software and Data Integrity Failures"],
    message: "BinaryFormatter é inerentemente inseguro para desserializar dados não confiáveis (RCE conhecido).",
    sddTemplateId: "sdd.deserialize.avoid-unsafe",
    category: "data-integrity",
    // A instanciação em si já é o indicador de risco — a Microsoft marcou
    // BinaryFormatter como obsoleto/inseguro independentemente do uso.
    pattern: {
      regex: "(?i)new\\s+BinaryFormatter\\s*\\(\\s*\\)",
    },
  },
  {
    id: "HERO-SEC-0502-insecure-deserialization-java",
    name: "JavaInsecureDeserialization",
    languages: ["java"],
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-502"],
    owasp: ["A08:2021-Software and Data Integrity Failures"],
    message: "ObjectInputStream desserializando dados potencialmente não confiáveis (risco de RCE via gadget chain).",
    sddTemplateId: "sdd.deserialize.avoid-unsafe",
    category: "data-integrity",
    pattern: {
      regex: "(?i)new\\s+ObjectInputStream\\s*\\(",
    },
  },
  {
    id: "HERO-SEC-0611-xxe-java",
    name: "JavaXxe",
    languages: ["java"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-611"],
    owasp: ["A05:2021-Security Misconfiguration"],
    message: "Parser XML instanciado sem desabilitar entidades externas explicitamente (risco de XXE).",
    sddTemplateId: "sdd.xxe.disable-external-entities",
    category: "security-misconfiguration",
    // Matcher por linha não confirma ausência de setFeature/disallow-doctype
    // em linha separada — like outros scanners, trata a instanciação como
    // um hotspot que precisa de revisão, não uma prova definitiva de bug.
    pattern: {
      regex: "(?i)(DocumentBuilderFactory|SAXParserFactory|XMLInputFactory)\\.newInstance\\s*\\(\\s*\\)",
    },
  },
  {
    id: "HERO-SEC-0611-xxe-dotnet",
    name: "DotNetXxe",
    languages: ["csharp", "vbnet"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 20,
    cwe: ["CWE-611"],
    owasp: ["A05:2021-Security Misconfiguration"],
    message: "XmlDocument instanciado sem configurar XmlResolver = null (risco de XXE em .NET Framework legado).",
    sddTemplateId: "sdd.xxe.disable-external-entities",
    category: "security-misconfiguration",
    pattern: {
      regex: "(?i)new\\s+XmlDocument\\s*\\(\\s*\\)",
    },
  },
  {
    id: "HERO-SEC-0078-xp-cmdshell-tsql",
    name: "XpCmdShell",
    languages: ["tsql"],
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-78"],
    owasp: ["A03:2021-Injection"],
    message: "xp_cmdshell executa comandos do SO a partir do SQL Server — quase sempre indevido em código de aplicação.",
    sddTemplateId: "sdd.cmd.avoid-shell",
    category: "string-injection",
    pattern: {
      regex: "(?i)xp_cmdshell",
    },
  },
  {
    id: "HERO-SEC-0327-weak-hash-dotnet",
    name: "DotNetWeakHashing",
    languages: ["csharp", "vbnet"],
    severity: "MAJOR",
    type: "VULNERABILITY",
    remediationEffortMin: 10,
    cwe: ["CWE-327", "CWE-328"],
    owasp: ["A02:2021-Cryptographic Failures"],
    message: "Uso de algoritmo de hash fraco (MD5/SHA1) via API .NET para dados sensíveis.",
    sddTemplateId: "sdd.crypto.upgrade-hash",
    category: "weak-crypto",
    pattern: {
      regex: "(?i)(MD5|SHA1)\\.Create\\s*\\(\\s*\\)|new\\s+(MD5|SHA1)CryptoServiceProvider\\s*\\(",
    },
  },
  {
    id: "HERO-SMELL-debug-dotnet",
    name: "DotNetDebugStatement",
    languages: ["csharp", "vbnet"],
    severity: "MINOR",
    type: "CODE_SMELL",
    remediationEffortMin: 2,
    cwe: [],
    owasp: [],
    message: "Statement de debug (Console.WriteLine / Debug.WriteLine) deixado no código.",
    sddTemplateId: "sdd.smell.remove-debug",
    category: "security-misconfiguration",
    pattern: {
      regex: "(?i)(Console\\.WriteLine|Debug\\.WriteLine|Debug\\.Print)\\s*\\(",
      unless: "(?i)(ILogger|Serilog|NLog|log4net|//\\s*allow-print)",
    },
  },
  {
    id: "HERO-SMELL-debug-java",
    name: "JavaDebugStatement",
    languages: ["java"],
    severity: "MINOR",
    type: "CODE_SMELL",
    remediationEffortMin: 2,
    cwe: [],
    owasp: [],
    message: "Statement de debug (System.out/System.err/printStackTrace) deixado no código.",
    sddTemplateId: "sdd.smell.remove-debug",
    category: "security-misconfiguration",
    pattern: {
      regex: "(?i)(System\\.(out|err)\\.print(ln)?|printStackTrace)\\s*\\(",
      unless: "(?i)(slf4j|logger|log4j|//\\s*allow-print)",
    },
  },
] as HeroRule[]
).map((r) => ({ ...r, implementation: "core" as const }));

/** Core hand-authored rules (JS/TS/Java/… + COBOL IBM-aligned pack). */
export const CORE_RULES: HeroRule[] = [..._CORE_BASE, ...COBOL_CORE_RULES];

/**
 * Tree-sitter structural rules as HeroRule rows (catalog / ficha / SARIF).
 * Not in L0 RULES — they run only under `--metrics` via the structural engine.
 */
export const STRUCTURAL_HERO_RULES: HeroRule[] = STRUCTURAL_RULES.map((r) => ({
  id: r.id,
  name: r.name,
  languages: ["javascript", "typescript", "python", "java", "go", "csharp", "cobol", "tsql"] as RuleLanguage[],
  severity: r.severity,
  type: r.type,
  remediationEffortMin: r.remediationEffortMin,
  cwe: r.cwe,
  owasp: r.owasp,
  message: r.message,
  sddTemplateId: r.sddTemplateId,
  category: r.category,
  // Never matches in L0; structural engine owns detection.
  pattern: { regex: "(?!)" },
  implementation: "structural" as const,
}));

/**
 * Live detection set: core + Sonar way L0 ports (stubs excluded — catalog only).
 * Used by scanner / getActiveRules matching. Structural rules are separate.
 */
export const RULES: HeroRule[] = [...CORE_RULES, ...QUANTUM_SAFE_RULES, ...SONAR_WAY_LIVE_RULES];

let _catalogRules: HeroRule[] | null = null;

/**
 * Browser-safe catalog: core + structural + Sonar L0 live (no stubs).
 * Full Sonar way (incl. stubs) → `@codehero/contracts/catalog` `getFullCatalogRules()`.
 */
export function getCatalogRules(): HeroRule[] {
  if (!_catalogRules) {
    _catalogRules = [...CORE_RULES, ...STRUCTURAL_HERO_RULES, ...SONAR_WAY_LIVE_RULES];
  }
  return _catalogRules;
}

/**
 * Sync catalog access (forces lazy load of full Sonar way JSON on first touch).
 * Prefer getCatalogRules() in new code.
 */
export const CATALOG_RULES: HeroRule[] = new Proxy([] as HeroRule[], {
  get(_target, prop, receiver) {
    const rules = getCatalogRules();
    const value = Reflect.get(rules, prop, receiver);
    return typeof value === "function" ? value.bind(rules) : value;
  },
  ownKeys() {
    return Reflect.ownKeys(getCatalogRules());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getCatalogRules(), prop);
  },
  has(_target, prop) {
    return Reflect.has(getCatalogRules(), prop);
  },
});

/** Live + core + structural lookup (stubs resolved via getCatalogRules). */
export const RULES_BY_ID: Record<string, HeroRule> = Object.fromEntries(
  [...RULES, ...STRUCTURAL_HERO_RULES].map((r) => [r.id, r]),
);

export function lookupRule(id: string): HeroRule | undefined {
  return RULES_BY_ID[id] ?? getCatalogRules().find((r) => r.id === id);
}

export { SONAR_WAY_LIVE_RULES };