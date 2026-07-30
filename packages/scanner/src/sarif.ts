import {
  TOOL_NAME,
  TOOL_VERSION,
  HERO_FINGERPRINT_ALGO,
  severityToSarifLevel,
  buildFindingFicha,
  formatFindingFichaHelp,
  type SarifLog,
  type SarifReportingDescriptor,
  type SarifResult,
} from "@codehero/contracts";
import type { CoverageReport } from "@codehero/contracts";
import type { Finding } from "./engine.ts";

/** Resumo estrutural que o scanner produz com --metrics (ver metrics.ts). */
export interface StructuralForSarif {
  totals: {
    functions: number;
    avgCyclomatic: number;
    avgCognitive: number;
    maxCyclomatic: number;
    maxNesting: number;
    commentDensity: number;
  };
  files: Array<{
    file: string;
    cyclomatic: number;
    cognitive: number;
    maxNesting: number;
    functions: Array<{ startLine: number; cyclomatic: number; cognitive: number; lines: number }>;
  }>;
  duplication: {
    percent: number;
    duplicatedLines: number;
    totalLines: number;
    groups: Array<{
      lines: number;
      blocks: Array<{ file: string; startLine: number; endLine: number }>;
    }>;
  };
}

/** Achado vindo de outra ferramenta, já normalizado (ver importSarif.ts). */
export interface ImportedForSarif {
  ruleId: string;
  tool: string;
  originalRuleId: string;
  severity: string;
  message: string;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
  fingerprint: string;
  cwe: string[];
  isDependency: boolean;
  helpUri?: string;
}

export function buildSarif(
  findings: Finding[],
  coverage?: CoverageReport | null,
  linesOfCode?: number,
  structural?: StructuralForSarif | null,
  imported?: ImportedForSarif[],
): SarifLog {
  const seenRules = new Map<string, SarifReportingDescriptor>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    const ficha = buildFindingFicha({
      ruleId: f.rule.id,
      ruleName: f.rule.name,
      message: f.rule.message,
      severity: f.rule.severity,
      issueType: f.rule.type,
      sddTemplateId: f.rule.sddTemplateId,
      cwe: f.rule.cwe,
      owasp: f.rule.owasp,
      remediationEffortMin: f.rule.remediationEffortMin,
      file: f.file,
      line: f.startLine,
      snippet: f.snippet,
    });

    if (!seenRules.has(f.rule.id)) {
      const helpText = formatFindingFichaHelp(ficha);
      seenRules.set(f.rule.id, {
        id: f.rule.id,
        name: f.rule.name,
        shortDescription: { text: f.rule.message },
        fullDescription: { text: ficha.reason },
        help: { text: helpText, markdown: helpText },
        defaultConfiguration: { level: severityToSarifLevel(f.rule.severity) },
        properties: {
          cwe: f.rule.cwe,
          owasp: f.rule.owasp,
          tags: [f.rule.type, ...f.rule.cwe],
          risk: ficha.risk,
          howToFix: ficha.howToFix,
          strategy: ficha.strategy,
        },
      });
    }

    results.push({
      ruleId: f.rule.id,
      level: severityToSarifLevel(f.rule.severity),
      message: { text: f.rule.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file.replace(/\\/g, "/") },
            region: {
              startLine: f.startLine,
              startColumn: f.startColumn,
              endLine: f.startLine,
              endColumn: f.endColumn,
              snippet: { text: f.snippet },
            },
          },
        },
      ],
      partialFingerprints: { [HERO_FINGERPRINT_ALGO]: f.fingerprint },
      properties: {
        severity: f.rule.severity,
        issueType: f.rule.type,
        remediationEffortMin: f.rule.remediationEffortMin,
        sddTemplateId: f.rule.sddTemplateId,
        snippet: f.snippet,
        risk: ficha.risk,
        reason: ficha.reason,
        howToFix: ficha.howToFix,
        strategy: ficha.strategy,
        constraints: ficha.constraints,
        referenceExample: ficha.referenceExample,
        cwe: ficha.cwe,
      },
    });
  }

  // Achados de terceiros entram no MESMO run, mas com procedência explícita:
  // `properties.source` diz de quem é a afirmação e `properties.tool` qual
  // ferramenta afirmou. Sem isso o relatório atribuiria ao CodeHero um achado
  // que não é dele — o mesmo erro que as regras mal mapeadas do Sonar way.
  for (const im of imported ?? []) {
    if (!seenRules.has(im.ruleId)) {
      seenRules.set(im.ruleId, {
        id: im.ruleId,
        name: im.originalRuleId,
        shortDescription: { text: `[${im.tool}] ${im.message}`.slice(0, 300) },
        ...(im.helpUri ? { help: { text: im.helpUri } } : {}),
        properties: {
          ...(im.cwe.length ? { cwe: im.cwe } : {}),
          tags: ["imported", im.tool, ...(im.isDependency ? ["dependency"] : [])],
        },
      });
    }
    results.push({
      ruleId: im.ruleId,
      level: severityToSarifLevel(im.severity as Finding["rule"]["severity"]),
      message: { text: im.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: im.file },
            region: {
              startLine: im.startLine,
              startColumn: im.startColumn,
              endLine: im.startLine,
              endColumn: im.endColumn,
              ...(im.snippet ? { snippet: { text: im.snippet } } : {}),
            },
          },
        },
      ],
      partialFingerprints: { [HERO_FINGERPRINT_ALGO]: im.fingerprint },
      properties: {
        severity: im.severity,
        // Dependência vulnerável não é dívida de código escrito aqui: entra
        // como VULNERABILITY, nunca como CODE_SMELL, para não inflar o débito.
        issueType: "VULNERABILITY",
        source: "imported",
        tool: im.tool,
        originalRuleId: im.originalRuleId,
        isDependency: im.isDependency,
        ...(im.cwe.length ? { cwe: im.cwe } : {}),
        ...(im.snippet ? { snippet: im.snippet } : {}),
      },
    });
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: TOOL_VERSION,
            informationUri: "https://codehero.web.app",
            rules: [...seenRules.values()],
          },
        },
        results,
        // Métricas de projeto (LOC / cobertura) viajam em `properties` do run —
        // o SARIF não tem lugar canônico. Plugin e ingest leem daqui.
        ...(coverage || typeof linesOfCode === "number" || structural
          ? {
              properties: {
                ...(typeof linesOfCode === "number" ? { linesOfCode } : {}),
                ...(structural
                  ? {
                      duplication: {
                        percent: structural.duplication.percent,
                        duplicatedLines: structural.duplication.duplicatedLines,
                        totalLines: structural.duplication.totalLines,
                        // Só os 50 maiores: um repo com muita duplicação
                        // geraria um SARIF de dezenas de MB sem ganho prático.
                        groups: structural.duplication.groups.slice(0, 50),
                      },
                      complexity: {
                        ...structural.totals,
                        // Só os arquivos que de fato têm função — arquivo de
                        // constantes não precisa ocupar espaço no relatório.
                        files: structural.files
                          .filter((f) => f.functions.length > 0)
                          .map((f) => ({
                            file: f.file,
                            cyclomatic: f.cyclomatic,
                            cognitive: f.cognitive,
                            maxNesting: f.maxNesting,
                            functions: f.functions,
                          })),
                      },
                    }
                  : {}),
                ...(coverage
                  ? {
                      coverage: {
                        format: coverage.format,
                        lines: coverage.lines,
                        ...(coverage.branches ? { branches: coverage.branches } : {}),
                        files: coverage.files.map((f) => ({
                          path: f.path,
                          lines: f.lines,
                          uncoveredLines: f.uncoveredLines,
                          coveredLines: f.coveredLines,
                        })),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
    ],
  };
}
