import type { BehavioralFingerprint, ParityAxisResult, ParityResult } from "./types.ts";

function setEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function deepEq(
  a: Record<string, string | number | boolean>,
  b: Record<string, string | number | boolean>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Parity Gate — deterministic oracle (paper §III-F).
 * PASS iff paragraphs_hit ∧ stub_log ∧ terminal_state all match.
 */
export function parityGate(cobol: BehavioralFingerprint, java: BehavioralFingerprint): ParityResult {
  const axes: ParityAxisResult[] = [
    {
      axis: "paragraphs_hit",
      ok: setEq(cobol.paragraphsHit, java.paragraphsHit),
      detail: !setEq(cobol.paragraphsHit, java.paragraphsHit)
        ? `cobol=[${cobol.paragraphsHit.join(",")}] java=[${java.paragraphsHit.join(",")}]`
        : undefined,
    },
    {
      axis: "stub_log",
      ok: JSON.stringify(cobol.stubLog) === JSON.stringify(java.stubLog),
      detail:
        JSON.stringify(cobol.stubLog) !== JSON.stringify(java.stubLog)
          ? `cobol=${JSON.stringify(cobol.stubLog)} java=${JSON.stringify(java.stubLog)}`
          : undefined,
    },
    {
      axis: "terminal_state",
      ok: deepEq(cobol.terminalState, java.terminalState),
      detail: !deepEq(cobol.terminalState, java.terminalState)
        ? `cobol=${JSON.stringify(cobol.terminalState)} java=${JSON.stringify(java.terminalState)}`
        : undefined,
    },
  ];
  return { ok: axes.every((a) => a.ok), axes };
}
