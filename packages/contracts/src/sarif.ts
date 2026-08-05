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
    referenceExample?: { before: string; after: string };
    cwe?: string[];
    /** Procedência: "imported" = achado de outra ferramenta, não do CodeHero. */
    source?: "imported";
    tool?: string;
    originalRuleId?: string;
    /** Vulnerabilidade de dependência (SCA), não de código autoral. */
    isDependency?: boolean;
    /** Motor nativo: L0 pattern, Babel AST/taint, ou tree-sitter structural. */
    engine?: "pattern" | "ast" | "taint" | "structural" | "cpg";
    /** Score do ranqueador FP (0–1): alto = mais assertivo / provável TP. */
    assertiveness?: number;
    fpLikelihood?: number;
    rankerModel?: string;
    /** Path de taint (CodeQL/nativo) — comprimento alimenta fp-ranker. */
    taintPath?: string[];
    taintPathLength?: number;
    /** Triagem offline (Foundation-Sec / heuristic). */
    triageScore?: number;
    likelyTruePositive?: boolean;
    triageReason?: string;
    triageMode?: string;
    /** Aprendizado local: fora do Quality Gate, ainda visível. */
    gateSuppressed?: boolean;
    gateSuppressReason?: string;
    ruleRepoFpRate?: number;
    ruleRepoFeedbackN?: number;
    /** code-embed (não supervisionado): família AST + outlier. */
    clusterId?: string;
    clusterIndex?: number;
    familySize?: number;
    outlierScore?: number;
    functionName?: string;
    embedModel?: string;
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
