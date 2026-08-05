/**
 * Optional Authoring Layer hook — Genkit/Teacher proposes Mutation Skills.
 * Student still applies skills and only Parity Gate judges (paper Teacher≠Oracle).
 */
import type { LockedParagraph, MutationSkill, ProgramModel } from "./types.ts";
import { catalogSkillsFor } from "./skills.ts";

export type AuthoringPropose = (
  locked: LockedParagraph,
  model: ProgramModel,
  attempt: number,
) => MutationSkill | null;

/** Prefer catalog; on retry try alternate skill kind. */
export function proposeFromCatalog(
  locked: LockedParagraph,
  model: ProgramModel,
  attempt = 0,
): MutationSkill | null {
  const skills = catalogSkillsFor(locked, model);
  return skills[attempt] ?? skills[0] ?? null;
}
