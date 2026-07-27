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
import type { Finding } from "./engine.ts";

export function buildSarif(findings: Finding[]): SarifLog {
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
      },
    ],
  };
}
