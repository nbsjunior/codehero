/**
 * Node/catalog surface: full Sonar way + SARIF normalize.
 * Import as `@codehero/contracts/catalog` from Functions / scanner ingest paths.
 * Never pull this into Next.js client components.
 */
export { getSonarWayRules, SONAR_WAY_RULES } from "./sonarWayFull.ts";
export {
  resolveCatalogRuleId,
  lookupCatalogRule,
  normalizeSarifResultsToCatalog,
} from "./sonarCatalog.ts";

import { CORE_RULES, STRUCTURAL_HERO_RULES, type HeroRule } from "./rules.ts";
import { getSonarWayRules } from "./sonarWayFull.ts";

let _full: HeroRule[] | null = null;

export function getFullCatalogRules(): HeroRule[] {
  if (!_full) _full = [...CORE_RULES, ...STRUCTURAL_HERO_RULES, ...getSonarWayRules()];
  return _full;
}
