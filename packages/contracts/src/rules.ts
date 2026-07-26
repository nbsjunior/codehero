import type { Severity, IssueType } from "./severity.ts";

// ---------------------------------------------------------------------------
// Hero-IR — the declarative rule format. For the MVP the scanner ships a
// lightweight "pattern" matcher (regex over logical source lines) instead of a
// full AST/taint engine. The shape below is forward-compatible: the `ast` and
// `taint` fields are reserved for the Rust/tree-sitter engine (V1+) and are
// ignored by the current TypeScript engine.
// ---------------------------------------------------------------------------

export type RuleLanguage = "python" | "javascript" | "typescript" | "java" | "go" | "any";

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
  /** MVP matcher: a JS regex source applied per line. */
  pattern: {
    regex: string;
    flags?: string;
    /** Optional secondary regex that, if it also matches the line, suppresses
     *  the finding (cheap sanitizer / false-positive guard). */
    unless?: string;
  };
}

// The canonical starter rule set. In production this bundle is generated and
// validated offline by hero-ruleforge; here it is hand-authored to bootstrap.
export const RULES: HeroRule[] = [
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
    pattern: {
      regex: "(?i)(api[_-]?key|secret|passwd|password|token|aws_secret_access_key)\\s*[:=]\\s*['\"][A-Za-z0-9_\\-/+]{12,}['\"]",
      unless: "(?i)(process\\.env|os\\.environ|getenv|import\\.meta\\.env|example|placeholder|xxxx|<.*>)",
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
    pattern: {
      regex: "(?i)(execute|executemany|query|raw)\\s*\\(\\s*[`'\"].*(select|insert|update|delete|drop).*[`'\"]\\s*(\\+|%|\\$\\{|\\.format|f['\"])",
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
    pattern: {
      regex: "(?i)(md5|sha1)\\s*\\(|hashlib\\.(md5|sha1)|createHash\\(\\s*['\"](md5|sha1)['\"]",
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
    pattern: {
      regex: "(?<![.\\w])(eval|exec)\\s*\\(",
      unless: "(?i)(#\\s*nosec|eslint-disable|safe-eval)",
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
    pattern: {
      regex: "(?<![.\\w])(console\\.log|console\\.debug|debugger|print)\\s*\\(",
      unless: "(?i)(logger|logging|structlog|//\\s*allow-print)",
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
    pattern: {
      regex: "(?i)(//|#|/\\*)\\s*(todo|fixme|hack|xxx)\\b",
    },
  },
];

export const RULES_BY_ID: Record<string, HeroRule> = Object.fromEntries(
  RULES.map((r) => [r.id, r]),
);
