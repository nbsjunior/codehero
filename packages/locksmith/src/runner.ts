import type { BehavioralFingerprint, MutationSkill, ProgramModel, Witness } from "./types.ts";

export interface RunnerOptions {
  /** Active mutations applied to this side (must match peer for parity). */
  mutations?: MutationSkill[];
  /** Side label for stub log provenance. */
  side: "cobol" | "java";
}

/**
 * Lightweight mock runner for COBOL CFG — stand-in for paper's instrumented
 * GnuCOBOL mock. Executes paragraph graph under witness input/stub state.
 *
 * Java side uses the same CFG by default (MirrorTarget) unless a custom runner
 * is supplied — real migrations plug in an external Java harness command later.
 */
export function runMock(
  model: ProgramModel,
  witness: Witness,
  opts: RunnerOptions,
): BehavioralFingerprint {
  const mutations = opts.mutations ?? [];
  const state: Record<string, string | number | boolean> = {
    ...Object.fromEntries(model.harnessKeys.filter((k) => k.kind === "input").map((k) => [k.name, k.domain[0]!])),
    ...witness.inputState,
  };
  const stubs: Record<string, string | number | boolean> = {
    ...Object.fromEntries(model.harnessKeys.filter((k) => k.kind === "stub").map((k) => [k.name, k.domain[0]!])),
    ...witness.stubState,
  };

  // Apply dispatcher-arm pins (parity-preserving when both sides get same pins).
  for (const m of mutations) {
    if (m.kind === "dispatcher-arm" && m.pins) {
      for (const [k, v] of Object.entries(m.pins)) {
        if (model.harnessKeys.some((h) => h.name === k && h.kind === "stub")) stubs[k] = v;
        else state[k] = v;
      }
    }
  }

  const paragraphsHit: string[] = [];
  const stubLog: string[] = [];
  const branchesHit: string[] = [];
  const hitParas = new Set<string>();
  const adj = new Map<string, ProgramModel["transitions"]>();
  for (const t of model.transitions) {
    const list = adj.get(t.from) ?? [];
    list.push(t);
    adj.set(t.from, list);
  }

  const entry = model.paragraphs[0] ?? "MAIN";
  const inject = mutations.find((m) => m.kind === "call-injection");
  const queue: string[] = inject?.injectFrom && inject.targetParagraph
    ? [inject.injectFrom, inject.targetParagraph]
    : [entry];

  // Force direct entry for call-injection target.
  if (inject?.targetParagraph) {
    queue.push(inject.targetParagraph);
  }

  let steps = 0;
  const visitedEdge = new Set<string>();

  while (queue.length && steps < 64) {
    steps++;
    const para = queue.shift()!;
    if (!model.paragraphs.includes(para) && !para.startsWith("CALL:")) continue;
    if (para.startsWith("CALL:")) {
      stubLog.push(`${opts.side}:CALL:${para.slice(5)}:rc=${stubs["CALL-RC"] ?? 0}`);
      continue;
    }
    if (!hitParas.has(para)) {
      hitParas.add(para);
      paragraphsHit.push(para);
    }

    // Branch probes: evaluate IFs using witness-controlled vars.
    const probes = model.branchProbes.filter((b) => b.startsWith(`${para}:`));
    for (let i = 0; i < probes.length; i += 2) {
      const t = probes[i];
      const f = probes[i + 1];
      const takeTrue = evaluateBranch(para, i / 2, state, stubs);
      if (takeTrue && t) branchesHit.push(t);
      else if (f) branchesHit.push(f);
    }

    // External ops when entering LOOKUP / ERROR style paragraphs.
    if (/LOOKUP|SQL|DB/i.test(para)) {
      stubLog.push(`${opts.side}:SQLCODE=${stubs["SQLCODE"] ?? 0}`);
    }
    if (/ERROR|FILE/i.test(para)) {
      stubLog.push(`${opts.side}:FILE-STATUS=${stubs["FILE-STATUS"] ?? "00"}`);
    }
    if (/CALL|PROG/i.test(para)) {
      stubLog.push(`${opts.side}:CALL-RC=${stubs["CALL-RC"] ?? 0}`);
    }

    const edges = adj.get(para) ?? [];
    for (const e of edges) {
      const key = `${e.from}->${e.to}:${e.kind}`;
      if (visitedEdge.has(key)) continue;
      // Gate GOTO ERROR on customer-id zero (matches sample.cbl intent).
      if (e.kind === "goto" && /ERROR/i.test(e.to)) {
        const cid = Number(state["WS-CUSTOMER-ID"] ?? 0);
        if (cid !== 0) continue;
      }
      if (e.kind === "goto" && /DONE|MAIN/i.test(e.to)) {
        const cid = Number(state["WS-CUSTOMER-ID"] ?? 0);
        if (cid === 0) continue;
      }
      // RARE-PATH only when flag Y
      if (e.kind === "perform" && /RARE-PATH/i.test(e.to)) {
        if (String(state["WS-TEMP-FLAG"] ?? "N") !== "Y") continue;
      }
      // LOCKED-VAULT only when secret gate == 9 (not in default witness domain)
      if ((e.kind === "perform" || e.kind === "fallthrough") && /LOCKED|VAULT/i.test(e.to)) {
        if (Number(state["WS-SECRET-GATE"] ?? 0) !== 9) continue;
      }
      // SQL failure may skip remaining performs
      if (e.kind === "perform" && Number(stubs["SQLCODE"] ?? 0) === -911 && /LOOKUP/i.test(e.to)) {
        continue;
      }
      visitedEdge.add(key);
      queue.push(e.to);
    }

    // Fall into ERROR via dispatcher-arm when pinned.
    for (const m of mutations) {
      if (m.kind === "dispatcher-arm" && m.targetParagraph === para) {
        // already in target
      } else if (m.kind === "dispatcher-arm" && !hitParas.has(m.targetParagraph)) {
        const pinOk = m.pins
          ? Object.entries(m.pins).every(([k, v]) => (state[k] ?? stubs[k]) === v)
          : true;
        if (pinOk && para === entry) {
          queue.push(m.targetParagraph);
        }
      }
    }
  }

  // Terminal observables
  const terminalState: Record<string, string | number | boolean> = {
    "WS-CUSTOMER-ID": state["WS-CUSTOMER-ID"] ?? 0,
    "WS-TEMP-FLAG": state["WS-TEMP-FLAG"] ?? " ",
    SQLCODE: stubs["SQLCODE"] ?? 0,
    "FILE-STATUS": stubs["FILE-STATUS"] ?? "00",
    "CALL-RC": stubs["CALL-RC"] ?? 0,
    lastParagraph: paragraphsHit[paragraphsHit.length - 1] ?? "",
  };

  // Java mirror adds a stable prefix difference only if side diverges — keep identical for parity.
  return {
    paragraphsHit: [...paragraphsHit].sort(),
    stubLog: normalizeStubLog(stubLog, opts.side),
    terminalState,
    branchesHit: [...new Set(branchesHit)].sort(),
  };
}

function evaluateBranch(
  para: string,
  ifIndex: number,
  state: Record<string, string | number | boolean>,
  stubs: Record<string, string | number | boolean>,
): boolean {
  // Heuristic gates matching common COBOL migration samples.
  if (/MAIN|ERROR/i.test(para) && ifIndex === 0) {
    return Number(state["WS-CUSTOMER-ID"] ?? 0) === 0;
  }
  if (/MAIN/i.test(para) && ifIndex === 1) {
    return Number(state["WS-CUSTOMER-ID"] ?? 0) === 0;
  }
  if (/LOOKUP/i.test(para)) {
    return Number(stubs["SQLCODE"] ?? 0) === 0;
  }
  if (/RARE-PATH/i.test(para)) {
    return Number(state["WS-SECRET-GATE"] ?? 0) === 9;
  }
  if (/MAIN/i.test(para) && ifIndex === 1) {
    return String(state["WS-TEMP-FLAG"] ?? "N") === "Y";
  }
  return (String(state["WS-TEMP-FLAG"] ?? "N") === "Y") !== (ifIndex % 2 === 1);
}

/** Strip side prefix so cobol/java logs compare on content. */
function normalizeStubLog(log: string[], side: string): string[] {
  return log.map((line) => line.replace(new RegExp(`^${side}:`), ""));
}

/** Pluggable target runner — default mirrors COBOL mock (parity baseline). */
export type TargetRunner = (
  model: ProgramModel,
  witness: Witness,
  mutations: MutationSkill[],
) => BehavioralFingerprint;

export const mirrorJavaRunner: TargetRunner = (model, witness, mutations) =>
  runMock(model, witness, { side: "java", mutations });

export const cobolRunner: TargetRunner = (model, witness, mutations) =>
  runMock(model, witness, { side: "cobol", mutations });
