import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HeroRule } from "./rules.ts";
import liveRaw from "./data/sonarWayLiveRules.json" with { type: "json" };

/** Sonar way rules that participate in scanning (non-stub). Eager — kept small. */
export const SONAR_WAY_LIVE_RULES: HeroRule[] = liveRaw as HeroRule[];

let _all: HeroRule[] | null = null;

/**
 * Full Sonar way import (live L0 ports + catalog stubs).
 * Loaded on demand so Cloud Functions cold start does not parse ~1MB JSON.
 */
export function getSonarWayRules(): HeroRule[] {
  if (_all) return _all;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "data", "sonarWayRules.json");
  _all = JSON.parse(readFileSync(path, "utf8")) as HeroRule[];
  return _all;
}

/** @deprecated Prefer getSonarWayRules() — sync alias that forces lazy load. */
export const SONAR_WAY_RULES: HeroRule[] = new Proxy([] as HeroRule[], {
  get(_target, prop, receiver) {
    const rules = getSonarWayRules();
    const value = Reflect.get(rules, prop, receiver);
    return typeof value === "function" ? value.bind(rules) : value;
  },
  ownKeys() {
    return Reflect.ownKeys(getSonarWayRules());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getSonarWayRules(), prop);
  },
  has(_target, prop) {
    return Reflect.has(getSonarWayRules(), prop);
  },
});
