import type { LockedParagraph, MutationSkill, ProgramModel } from "./types.ts";

/**
 * Mutation Skills catalog (paper §III-D).
 * Skills mutate the *harness* on both sides — never permanent business logic.
 */

export function catalogSkillsFor(locked: LockedParagraph, model: ProgramModel): MutationSkill[] {
  const skills: MutationSkill[] = [];
  const pins: Record<string, string | number | boolean> = {};
  for (const v of locked.gateVariables) {
    const key = model.harnessKeys.find((h) => h.name === v);
    if (!key) continue;
    // Prefer values that open error / non-happy paths.
    if (/CUSTOMER-ID/i.test(v)) pins[v] = 0;
    else if (/SECRET-GATE/i.test(v)) pins[v] = 9; // outside default witness domain
    else if (/SQLCODE/i.test(v)) pins[v] = 100;
    else if (/FILE-STATUS/i.test(v)) pins[v] = "23";
    else if (/CALL-RC/i.test(v)) pins[v] = 8;
    else if (/FLAG/i.test(v)) pins[v] = "Y";
    else pins[v] = key.domain[key.domain.length - 1]!;
  }

  // Vault-style locks: pin secret + flag even if analyzer missed the var name.
  if (/LOCKED|VAULT/i.test(locked.name)) {
    pins["WS-SECRET-GATE"] = 9;
    pins["WS-TEMP-FLAG"] = "Y";
  }

  skills.push({
    id: `dispatcher-arm:${locked.name}`,
    kind: "dispatcher-arm",
    description: `Pin stubs/inputs to reach locked paragraph ${locked.name}`,
    targetParagraph: locked.name,
    pins,
  });

  const entry = model.paragraphs[0] ?? "MAIN-PARA";
  skills.push({
    id: `call-injection:${locked.name}`,
    kind: "call-injection",
    description: `Inject direct PERFORM/CALL into ${locked.name} from ${entry}`,
    targetParagraph: locked.name,
    injectFrom: entry,
  });

  return skills;
}

/** Deterministic Authoring Layer fallback when catalog is empty (Teacher proposes). */
export function defaultAuthoring(locked: LockedParagraph, model: ProgramModel): MutationSkill | null {
  const fromCatalog = catalogSkillsFor(locked, model);
  return fromCatalog[0] ?? null;
}
