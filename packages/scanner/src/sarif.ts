import {
  TOOL_NAME,
  TOOL_VERSION,
  HERO_FINGERPRINT_ALGO,
  severityToSarifLevel,
  type SarifLog,
  type SarifReportingDescriptor,
  type SarifResult,
} from "@codehero/contracts";
import type { Finding } from "./engine.ts";

export function buildSarif(findings: Finding[]): SarifLog {
  const seenRules = new Map<string, SarifReportingDescriptor>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    if (!seenRules.has(f.rule.id)) {
      seenRules.set(f.rule.id, {
        id: f.rule.id,
        name: f.rule.name,
        shortDescription: { text: f.rule.message },
        defaultConfiguration: { level: severityToSarifLevel(f.rule.severity) },
        properties: {
          cwe: f.rule.cwe,
          owasp: f.rule.owasp,
          tags: [f.rule.type, ...f.rule.cwe],
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
            informationUri: "https://codehero.dev",
            rules: [...seenRules.values()],
          },
        },
        results,
      },
    ],
  };
}
