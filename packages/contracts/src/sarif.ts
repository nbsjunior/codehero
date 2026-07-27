// Minimal SARIF 2.1.0 typings plus CodeHero's `properties` extensions.
// Only the subset the platform actually reads/writes is modelled.

export interface SarifLog {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json";
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri?: string;
      rules: SarifReportingDescriptor[];
    };
  };
  results: SarifResult[];
}

export interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  help?: { text: string; markdown?: string };
  defaultConfiguration?: { level: SarifLevel };
  properties?: {
    cwe?: string[];
    owasp?: string[];
    "security-severity"?: string;
    tags?: string[];
    risk?: string;
    howToFix?: string;
    strategy?: string;
  };
}

export type SarifLevel = "error" | "warning" | "note" | "none";

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  /** CodeHero extensions consumed by ingestion + SDD + ficha. */
  properties?: {
    severity?: string;
    issueType?: string;
    remediationEffortMin?: number;
    sddTemplateId?: string;
    snippet?: string;
    risk?: string;
    reason?: string;
    howToFix?: string;
    strategy?: string;
    constraints?: string[];
  };
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: {
      startLine: number;
      startColumn?: number;
      endLine?: number;
      endColumn?: number;
      snippet?: { text: string };
    };
  };
  logicalLocations?: Array<{ fullyQualifiedName: string; kind: string }>;
}
