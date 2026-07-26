import type { HeroRule } from "@codehero/contracts";
import type { Mutation } from "./types.ts";

/**
 * Serialisable mutation proposal (what an LLM / Genkit flow may emit).
 * Converted to a live `Mutation` via `mutationFromSpec` before entering the
 * deterministic evolutionary search — the LLM never writes `apply()` itself.
 */
export type MutationKind =
  | "append_regex_alt"
  | "replace_in_regex"
  | "set_unless"
  | "append_unless_alt";

export interface MutationSpec {
  id: string;
  description: string;
  kind: MutationKind;
  /**
   * - append_regex_alt / append_unless_alt: fragment OR-appended
   * - replace_in_regex: `from=>to` (first `=>` splits)
   * - set_unless: full `unless` regex source
   */
  value: string;
}

export function mutationFromSpec(spec: MutationSpec): Mutation {
  return {
    id: spec.id,
    description: spec.description,
    apply: (pattern) => applySpec(pattern, spec),
  };
}

function applySpec(pattern: HeroRule["pattern"], spec: MutationSpec): HeroRule["pattern"] {
  switch (spec.kind) {
    case "append_regex_alt":
      return { ...pattern, regex: pattern.regex ? `${pattern.regex}|${spec.value}` : spec.value };
    case "replace_in_regex": {
      const sep = spec.value.indexOf("=>");
      if (sep < 0) return pattern;
      const from = spec.value.slice(0, sep);
      const to = spec.value.slice(sep + 2);
      return { ...pattern, regex: pattern.regex.replace(from, to) };
    }
    case "set_unless":
      return { ...pattern, unless: spec.value };
    case "append_unless_alt":
      return {
        ...pattern,
        unless: pattern.unless ? `${pattern.unless}|${spec.value}` : spec.value,
      };
    default: {
      const _exhaustive: never = spec.kind;
      return _exhaustive;
    }
  }
}

/** Returns false if applying the spec yields an uncompilable regex. */
export function isSafeMutationSpec(spec: MutationSpec, base: HeroRule["pattern"]): boolean {
  try {
    if (!spec.id?.trim() || !spec.value?.trim()) return false;
    const next = applySpec(base, spec);
    new RegExp(next.regex, next.flags ?? "i");
    if (next.unless) new RegExp(next.unless, next.flags ?? "i");
    return true;
  } catch {
    return false;
  }
}
