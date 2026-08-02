import type { HeroRule } from "./rules.ts";
import raw from "./data/sonarWayRules.json" with { type: "json" };

/**
 * Full Sonar way (live + stubs). Node/catalog entry only — do not import from the
 * main `@codehero/contracts` barrel (keeps CF cold start and Next.js client lean).
 */
export function getSonarWayRules(): HeroRule[] {
  return raw as HeroRule[];
}

export const SONAR_WAY_RULES: HeroRule[] = raw as HeroRule[];
