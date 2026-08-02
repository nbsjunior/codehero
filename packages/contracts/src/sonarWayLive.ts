import type { HeroRule } from "./rules.ts";
import liveRaw from "./data/sonarWayLiveRules.json" with { type: "json" };

/** Sonar way rules that participate in scanning (non-stub). Safe for browser + CF boot. */
export const SONAR_WAY_LIVE_RULES: HeroRule[] = liveRaw as HeroRule[];
