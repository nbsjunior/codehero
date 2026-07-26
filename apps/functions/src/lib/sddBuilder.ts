import { SDD_TEMPLATES, RULES_BY_ID, type SddSpec, type Severity } from "@codehero/contracts";

export interface IssueData {
  ruleId: string;
  severity: Severity;
  issueType: string;
  message?: string;
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
  sddTemplateId?: string | null;
  surroundingCode?: string;
  imports?: string[];
}

function intentFor(issueType: string): SddSpec["intent"] {
  if (issueType === "VULNERABILITY" || issueType === "SECURITY_HOTSPOT") return "REMEDIATE_VULNERABILITY";
  if (issueType === "BUG") return "REMEDIATE_BUG";
  return "REDUCE_DEBT";
}

function languageFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".java": "java",
    ".go": "go",
  };
  return map[ext] ?? "unknown";
}

/** Assemble a verifiable SDD Spec from a stored issue. Pure — no I/O. */
export function buildSpecFromIssue(issue: IssueData, fingerprint: string): SddSpec {
  const rule = RULES_BY_ID[issue.ruleId];
  const template = SDD_TEMPLATES[issue.sddTemplateId ?? ""] ?? undefined;
  const specId = `sdd-${fingerprint.slice(0, 8)}-${Date.now().toString(36)}`;

  return {
    sddVersion: "1.0",
    specId,
    generatedAt: new Date().toISOString(),
    intent: intentFor(issue.issueType),
    issue: {
      ruleId: issue.ruleId,
      cwe: rule?.cwe ?? [],
      severity: issue.severity,
      title: rule?.name ?? issue.ruleId,
      fingerprint,
    },
    location: {
      file: issue.file,
      range: { startLine: issue.line || 1, startColumn: issue.column || undefined },
    },
    context: {
      language: languageFromPath(issue.file),
      targetSnippet: issue.snippet ?? "",
      surroundingCode: issue.surroundingCode ?? issue.snippet ?? "",
      imports: issue.imports ?? [],
    },
    remediation: {
      strategy: template?.strategy ?? "manual_fix",
      templateId: template?.id ?? "sdd.generic",
      guidance: template?.guidance ?? issue.message ?? "Corrija a violação preservando o comportamento.",
      referenceExample: template?.referenceExample,
      constraints: template?.constraints ?? ["Preservar comportamento observável.", "Manter estilo do arquivo."],
    },
    acceptanceCriteria: [
      { id: "AC1", type: "RULE_RESOLVED", assert: `hero-scanner não reporta ${issue.ruleId} no range após o patch` },
      { id: "AC2", type: "NO_NEW_ISSUES", assert: "nenhuma nova issue BLOCKER/CRITICAL introduzida" },
      { id: "AC3", type: "TESTS_PASS", assert: "a suíte de testes existente permanece verde" },
    ],
    outputContract: { format: "unified_diff", scope: "single_file", maxHunks: 3 },
  };
}
