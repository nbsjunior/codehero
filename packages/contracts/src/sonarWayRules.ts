import type { HeroRule } from "./rules.ts";
import raw from "./data/sonarWayRules.json" with { type: "json" };

/** Full Sonar way import (live L0 ports + catalog stubs). */
export const SONAR_WAY_RULES: HeroRule[] = raw as HeroRule[];

/** Sonar way rules that participate in scanning (non-stub). */
export const SONAR_WAY_LIVE_RULES: HeroRule[] = SONAR_WAY_RULES.filter(
  (r) => r.implementation !== "stub",
);
