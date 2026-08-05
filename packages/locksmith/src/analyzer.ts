import { readFileSync } from "node:fs";
import { parseCobolSource } from "@codehero/engine";
import type { HarnessKey, LockedParagraph, ProgramModel } from "./types.ts";

interface TreeNode {
  type: string;
  text: string;
  childCount: number;
  child(i: number): TreeNode | null;
  childForFieldName(f: string): { text: string } | null;
}

function walkTree(node: TreeNode, visit: (n: TreeNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) walkTree(c, visit);
  }
}

const PERFORM_RE = /\bPERFORM\s+([A-Z][A-Z0-9-]*)(?:\s+THRU\s+([A-Z][A-Z0-9-]*))?/gi;
const GOTO_RE = /\bGO\s+TO\s+([A-Z][A-Z0-9-]*)/gi;
const CALL_RE = /\bCALL\s+([A-Z0-9'"-]+)/gi;
const IF_RE = /\bIF\b/gi;

/** Default harness knobs for batch COBOL (paper-style stubs). */
export const DEFAULT_HARNESS_KEYS: HarnessKey[] = [
  { name: "WS-CUSTOMER-ID", domain: [0, 1, 42, 999999], kind: "input" },
  { name: "WS-TEMP-FLAG", domain: ["Y", "N", " "], kind: "input" },
  /** Intentionally sparse domain — value 9 omitted so LOCKED-VAULT needs mutation. */
  { name: "WS-SECRET-GATE", domain: [0, 1], kind: "input" },
  { name: "SQLCODE", domain: [0, 100, -803, -911], kind: "stub" },
  { name: "FILE-STATUS", domain: ["00", "10", "23", "35"], kind: "stub" },
  { name: "CALL-RC", domain: [0, 1, 8], kind: "stub" },
];

/**
 * Static COBOL analyzer — paragraphs, PERFORM/GO TO CFG, IF branch probes.
 * Maps to paper §III-B (Locked Paragraph Analyzer inputs).
 */
export function analyzeCobolFile(sourcePath: string, harnessKeys = DEFAULT_HARNESS_KEYS): ProgramModel {
  const source = readFileSync(sourcePath, "utf8");
  return analyzeCobolSource(source, sourcePath, harnessKeys);
}

export function analyzeCobolSource(
  source: string,
  sourcePath = "<memory>",
  harnessKeys = DEFAULT_HARNESS_KEYS,
): ProgramModel {
  const root = parseCobolSource(source);
  const paragraphs: string[] = [];
  const bodies = new Map<string, string>();
  const transitions: ProgramModel["transitions"] = [];
  const branchProbes: string[] = [];

  walkTree(root, (node) => {
    if (node.type !== "paragraph") return;
    const name = node.childForFieldName("name")?.text?.toUpperCase() ?? "";
    if (!name) return;
    paragraphs.push(name);
    const body = node.childForFieldName("body")?.text ?? node.text;
    bodies.set(name, body);
  });

  for (let i = 0; i < paragraphs.length; i++) {
    const from = paragraphs[i]!;
    const body = bodies.get(from) ?? "";
    let performHit = false;
    for (const m of body.matchAll(PERFORM_RE)) {
      const to = m[1]!.toUpperCase();
      const thru = m[2]?.toUpperCase();
      transitions.push({ from, to, kind: "perform" });
      performHit = true;
      if (thru && thru !== to) {
        transitions.push({ from, to: thru, kind: "perform" });
      }
    }
    for (const m of body.matchAll(GOTO_RE)) {
      transitions.push({ from, to: m[1]!.toUpperCase(), kind: "goto" });
      performHit = true;
    }
    for (const m of body.matchAll(CALL_RE)) {
      transitions.push({ from, to: `CALL:${m[1]!.replace(/['"]/g, "").toUpperCase()}`, kind: "exit" });
    }
    // Fall-through to next paragraph when no explicit transfer dominates (best-effort).
    if (!performHit && !/\b(STOP\s+RUN|GOBACK|EXIT\s+PROGRAM)\b/i.test(body) && i + 1 < paragraphs.length) {
      transitions.push({ from, to: paragraphs[i + 1]!, kind: "fallthrough" });
    }
    let ifIdx = 0;
    for (const _ of body.matchAll(IF_RE)) {
      ifIdx++;
      branchProbes.push(`${from}:IF${ifIdx}:T`);
      branchProbes.push(`${from}:IF${ifIdx}:F`);
    }
  }

  return {
    sourcePath,
    paragraphs,
    transitions,
    branchProbes,
    harnessKeys,
  };
}

/** Paragraphs with uncovered branch probes after a coverage set. */
export function findLockedParagraphs(
  model: ProgramModel,
  coveredBranches: Set<string>,
  coveredParagraphs: Set<string>,
  ranking: "greedy" | "bang-feasibility" = "greedy",
): LockedParagraph[] {
  const byPara = new Map<string, string[]>();
  for (const b of model.branchProbes) {
    const para = b.split(":")[0]!;
    const list = byPara.get(para) ?? [];
    list.push(b);
    byPara.set(para, list);
  }

  const locked: LockedParagraph[] = [];
  for (const [name, probes] of byPara) {
    const uncovered = probes.filter((p) => !coveredBranches.has(p));
    if (uncovered.length === 0) continue;
    // Locked if paragraph never entered OR has residual branch space.
    const neverEntered = !coveredParagraphs.has(name);
    if (!neverEntered && uncovered.length === 0) continue;
    const gateVariables = guessGateVars(model, name);
    const bang = uncovered.length;
    const feasibility = gateVariables.length > 0 ? 1 : 0.4;
    const score = ranking === "bang-feasibility" ? bang * feasibility : bang + (neverEntered ? 2 : 0);
    locked.push({
      name,
      uncoveredBranches: uncovered,
      gateVariables,
      score,
      attempted: false,
      opened: false,
    });
  }

  // Also surface paragraphs never hit that have no IF probes (dead CALL targets etc.).
  for (const name of model.paragraphs) {
    if (coveredParagraphs.has(name) || byPara.has(name)) continue;
    locked.push({
      name,
      uncoveredBranches: [],
      gateVariables: guessGateVars(model, name),
      score: ranking === "bang-feasibility" ? 1.5 : 3,
      attempted: false,
      opened: false,
    });
  }

  locked.sort((a, b) => b.score - a.score);
  return locked;
}

function guessGateVars(model: ProgramModel, paragraph: string): string[] {
  const keys = model.harnessKeys.map((k) => k.name.toUpperCase());
  // Prefer input/stub keys that appear in the paragraph name heuristics + common COBOL vars.
  const hits = keys.filter(
    (k) =>
      k.includes("CUSTOMER") ||
      k.includes("FLAG") ||
      k.includes("SECRET") ||
      k.includes("GATE") ||
      k.includes("SQL") ||
      k.includes("STATUS") ||
      k.includes("CALL") ||
      paragraph.includes("ERROR") ||
      paragraph.includes("LOOKUP") ||
      paragraph.includes("RARE") ||
      paragraph.includes("LOCKED") ||
      paragraph.includes("VAULT"),
  );
  return hits.length ? hits : keys.slice(0, 2);
}
