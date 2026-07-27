import { RULES_BY_ID } from "./rules.ts";
import { SDD_TEMPLATES } from "./sdd.ts";
import type { Severity, IssueType } from "./severity.ts";

/** Ficha do apontamento — risco, motivo e como corrigir (todos os canais). */
export interface FindingFicha {
  ruleId: string;
  ruleName: string;
  severity: string;
  issueType: string;
  /** Resumo do risco (severidade + tipo + CWE/OWASP). */
  risk: string;
  /** Por que o scanner apontou (mensagem da regra). */
  reason: string;
  /** Orientação prática de correção. */
  howToFix: string;
  strategy: string;
  constraints: string[];
  referenceExample?: { before: string; after: string };
  cwe: string[];
  owasp: string[];
  effortMin?: number;
  file?: string;
  line?: number;
  snippet?: string;
}

export interface FindingFichaInput {
  ruleId: string;
  message?: string;
  severity?: string;
  issueType?: string;
  sddTemplateId?: string | null;
  cwe?: string[];
  owasp?: string[];
  remediationEffortMin?: number;
  ruleName?: string;
  file?: string;
  line?: number;
  snippet?: string;
}

const ISSUE_TYPE_LABEL: Record<string, string> = {
  VULNERABILITY: "Vulnerabilidade",
  BUG: "Bug",
  CODE_SMELL: "Code smell",
  SECURITY_HOTSPOT: "Hotspot de segurança",
};

const DEFAULT_CONSTRAINTS = [
  "Preservar comportamento observável.",
  "Manter estilo do arquivo.",
];

/** Monta a ficha a partir da regra canônica + template SDD (ou campos já persistidos). */
export function buildFindingFicha(input: FindingFichaInput): FindingFicha {
  const rule = RULES_BY_ID[input.ruleId];
  const templateId = input.sddTemplateId ?? rule?.sddTemplateId ?? "";
  const template = templateId ? SDD_TEMPLATES[templateId] : undefined;

  const severity = (input.severity ?? rule?.severity ?? "MAJOR") as Severity | string;
  const issueType = (input.issueType ?? rule?.type ?? "CODE_SMELL") as IssueType | string;
  const cwe = input.cwe?.length ? input.cwe : (rule?.cwe ?? []);
  const owasp = input.owasp?.length ? input.owasp : (rule?.owasp ?? []);
  const reason = (input.message ?? rule?.message ?? "Violação de regra detectada.").trim();
  const howToFix =
    template?.guidance ??
    "Corrija a violação preservando o comportamento observável e o estilo do arquivo.";
  const effortMin = input.remediationEffortMin ?? rule?.remediationEffortMin;

  return {
    ruleId: input.ruleId,
    ruleName: input.ruleName ?? rule?.name ?? input.ruleId,
    severity,
    issueType,
    risk: formatRisk({ severity, issueType, cwe, owasp, effortMin }),
    reason,
    howToFix,
    strategy: template?.strategy ?? "manual_fix",
    constraints: template?.constraints?.length ? template.constraints : DEFAULT_CONSTRAINTS,
    referenceExample: template?.referenceExample,
    cwe,
    owasp,
    effortMin,
    file: input.file,
    line: input.line,
    snippet: input.snippet,
  };
}

export function formatRisk(opts: {
  severity: string;
  issueType: string;
  cwe?: string[];
  owasp?: string[];
  effortMin?: number;
}): string {
  const typeLabel = ISSUE_TYPE_LABEL[opts.issueType] ?? opts.issueType;
  const parts = [`${opts.severity} · ${typeLabel}`];
  if (opts.cwe?.length) parts.push(opts.cwe.join(", "));
  if (opts.owasp?.length) parts.push(opts.owasp[0]!);
  if (opts.effortMin != null) parts.push(`~${opts.effortMin} min`);
  return parts.join(" · ");
}

/** Texto longo para SARIF `help` / GitHub Code Scanning. */
export function formatFindingFichaHelp(ficha: FindingFicha): string {
  const lines = [
    `## Risco`,
    ficha.risk,
    ``,
    `## Motivo do apontamento`,
    ficha.reason,
    ``,
    `## Como corrigir`,
    ficha.howToFix,
  ];
  if (ficha.referenceExample) {
    lines.push(``, `### Exemplo`, `Antes:`, ficha.referenceExample.before, ``, `Depois:`, ficha.referenceExample.after);
  }
  if (ficha.constraints.length) {
    lines.push(``, `### Restrições`, ...ficha.constraints.map((c) => `- ${c}`));
  }
  return lines.join("\n");
}

/** Markdown para o painel da IDE / portal. */
export function formatFindingFichaMarkdown(ficha: FindingFicha): string {
  const loc =
    ficha.file != null && ficha.line != null ? `\`${ficha.file}:${ficha.line}\`` : undefined;
  const lines = [
    `# Ficha do apontamento`,
    ``,
    `**${ficha.ruleName}** (\`${ficha.ruleId}\`)`,
    loc ? `Local: ${loc}` : "",
    ``,
    `## Risco`,
    ficha.risk,
    ``,
    `## Motivo`,
    ficha.reason,
    ficha.snippet ? `\n\`\`\`\n${ficha.snippet}\n\`\`\`` : "",
    ``,
    `## Como corrigir`,
    ficha.howToFix,
  ].filter((l) => l !== "");

  if (ficha.referenceExample) {
    lines.push(``, `### Antes`, "```", ficha.referenceExample.before, "```");
    lines.push(``, `### Depois`, "```", ficha.referenceExample.after, "```");
  }
  if (ficha.constraints.length) {
    lines.push(``, `### Restrições`);
    for (const c of ficha.constraints) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}
