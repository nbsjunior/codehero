/**
 * Named scan profiles — one orchestration surface for CLI, GitHub Action, MCP, IDE.
 *
 * External engines are soft-fail adapters; profiles only declare intent.
 * Explicit `--with-*` / Action inputs always OR on top of the profile.
 */

export const SCAN_PROFILE_IDS = ["native", "presence", "java", "full"] as const;
export type ScanProfileId = (typeof SCAN_PROFILE_IDS)[number];

export interface ScanProfileEngines {
  metrics: boolean;
  semantic: boolean;
  joern: boolean;
  oxlint: boolean;
  eslint: boolean;
  semgrep: boolean;
  opengrep: boolean;
  pmd: boolean;
  spotbugs: boolean;
  sca: boolean;
  /** Gitleaks — secrets no working tree (soft-fail). */
  secrets: boolean;
}

export interface ScanProfile {
  id: ScanProfileId;
  /** Short label for UI / MCP. */
  label: string;
  /** One-line product copy. */
  summary: string;
  engines: ScanProfileEngines;
}

const OFF: ScanProfileEngines = {
  metrics: false,
  semantic: false,
  joern: false,
  oxlint: false,
  eslint: false,
  semgrep: false,
  opengrep: false,
  pmd: false,
  spotbugs: false,
  sca: false,
  secrets: false,
};

export const SCAN_PROFILES: Record<ScanProfileId, ScanProfile> = {
  native: {
    id: "native",
    label: "Nativo",
    summary: "Só o motor CodeHero (L0–L2). Rápido — default IDE / save.",
    engines: { ...OFF },
  },
  presence: {
    id: "presence",
    label: "Presença",
    summary: "Pack OSS: métricas + Oxlint + Opengrep + SCA (Trivy) + secrets (Gitleaks). Soft-fail.",
    engines: {
      ...OFF,
      metrics: true,
      oxlint: true,
      opengrep: true,
      sca: true,
      secrets: true,
    },
  },
  java: {
    id: "java",
    label: "Java",
    summary: "Nativo + métricas + PMD + SpotBugs (precisa --spotbugs-classes). Soft-fail.",
    engines: {
      ...OFF,
      metrics: true,
      pmd: true,
      spotbugs: true,
    },
  },
  full: {
    id: "full",
    label: "Completo",
    summary: "Todas as adapters Presence Pack (exceto Joern). Soft-fail por ferramenta.",
    engines: {
      metrics: true,
      semantic: false,
      joern: false,
      oxlint: true,
      eslint: true,
      semgrep: true,
      opengrep: true,
      pmd: true,
      spotbugs: true,
      sca: true,
      secrets: true,
    },
  },
};

export function isScanProfileId(value: string | null | undefined): value is ScanProfileId {
  return !!value && (SCAN_PROFILE_IDS as readonly string[]).includes(value);
}

export function resolveScanProfile(id: string | null | undefined): ScanProfile {
  if (isScanProfileId(id)) return SCAN_PROFILES[id];
  return SCAN_PROFILES.native;
}

/** Merge profile engines with explicit opt-ins (explicit always wins by OR). */
export function mergeScanEngines(
  profile: ScanProfileEngines,
  overrides: Partial<ScanProfileEngines>,
): ScanProfileEngines {
  return {
    metrics: overrides.metrics === true || profile.metrics,
    semantic: overrides.semantic === true || profile.semantic,
    joern: overrides.joern === true || profile.joern,
    oxlint: overrides.oxlint === true || profile.oxlint,
    eslint: overrides.eslint === true || profile.eslint,
    semgrep: overrides.semgrep === true || profile.semgrep,
    opengrep: overrides.opengrep === true || profile.opengrep,
    pmd: overrides.pmd === true || profile.pmd,
    spotbugs: overrides.spotbugs === true || profile.spotbugs,
    sca: overrides.sca === true || profile.sca,
    secrets: overrides.secrets === true || profile.secrets,
  };
}

/**
 * CLI argv fragment for a resolved engine set (no binary / path).
 * Callers append target, --sarif, auth, coverage, spotbugs-classes, etc.
 */
export function scanEnginesToCliArgs(engines: ScanProfileEngines): string[] {
  const args: string[] = [];
  if (engines.metrics) args.push("--metrics");
  if (engines.semantic) args.push("--semantic");
  if (engines.joern) args.push("--joern");
  if (engines.oxlint) args.push("--with-oxlint");
  if (engines.eslint) args.push("--with-eslint");
  if (engines.semgrep) args.push("--with-semgrep");
  if (engines.opengrep) args.push("--with-opengrep");
  if (engines.pmd) args.push("--with-pmd");
  if (engines.spotbugs) args.push("--with-spotbugs");
  if (engines.sca) args.push("--with-sca");
  if (engines.secrets) args.push("--with-secrets");
  return args;
}

/** Resolve profile id + overrides → CLI args (includes `--profile <id>` for logs). */
export function scanProfileToCliArgs(
  profileId: string | null | undefined,
  overrides?: Partial<ScanProfileEngines>,
): string[] {
  const profile = resolveScanProfile(profileId);
  const engines = mergeScanEngines(profile.engines, overrides ?? {});
  // Prefer expanding engines so older scanners without --profile still work
  // when MCP/IDE pass the resolved flags. Also pass --profile for newer CLIs.
  return ["--profile", profile.id, ...scanEnginesToCliArgs(engines)];
}
