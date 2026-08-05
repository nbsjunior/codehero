import * as t from "@babel/types";
import type { File, Node, Statement } from "@babel/types";
import type { HeroRule, TaintSinkKind } from "@codehero/contracts";
import { buildCfg } from "./cfg.ts";
import { runForwardWorklist, type Lattice } from "./dataflow.ts";
import { locOf, snippetAt } from "./parse.ts";
import { getTraverse } from "./traverse.ts";
import type { EngineFinding } from "./types.ts";

/** Taint fact: variable → provenance path (lattice join = union). */
export type TaintFact = Map<string, string[]>;

type PathLike = {
  node: unknown;
};

const traverse = getTraverse() as (ast: File, visitors: Record<string, (path: PathLike) => void>) => void;

const SOURCE_PATTERNS: Record<string, RegExp[]> = {
  "http.param": [/^req\.(query|params|param)$/i, /^request\.(query|params)$/i, /^ctx\.(query|params)$/i],
  "http.body": [/^req\.body$/i, /^request\.body$/i],
  "http.header": [/^req\.headers$/i, /^request\.headers$/i],
  "process.argv": [/^process\.argv$/i],
  "process.env": [/^process\.env$/i],
  "filesystem.read": [/^fs\.readFile(Sync)?$/i, /^readFile(Sync)?$/i],
  "user.input": [/^prompt$/i, /^window\.prompt$/i, /^location\.(hash|search|href)$/i],
};

const SINK_PATTERNS: Record<string, RegExp[]> = {
  eval: [/^eval$/i],
  function_ctor: [/^Function$/i],
  "sql.execute": [/^(query|execute|executemany|raw|run)$/i, /\.query$/i, /\.execute$/i, /\.raw$/i],
  "html.innerHTML": [/\.innerHTML$/i, /\.outerHTML$/i],
  "html.documentWrite": [/^document\.(write|writeln)$/i],
  child_process: [/^(exec|execSync|spawn|spawnSync|execFile)$/i, /^child_process\./i],
  "network.request": [/^fetch$/i, /^axios(\.|$)/i, /^http\.request$/i, /^got$/i],
  "fs.path": [
    /^(readFile|readFileSync|writeFile|writeFileSync|unlink|unlinkSync|createReadStream|createWriteStream)$/i,
    /^fs\./i,
    /^path\.join$/i,
  ],
  "http.redirect": [/\.redirect$/i, /^res\.redirect$/i, /^response\.redirect$/i],
  "object.merge": [/^Object\.assign$/i, /^_\.merge$/i, /^lodash\.merge$/i],
  "log.write": [
    /^console\.(log|info|debug|error|warn)$/i,
    /^logger\.(log|info|debug|error|warn)$/i,
    /\.log$/i,
  ],
};

function memberPath(node: Node): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node) && !node.computed) {
    const obj = memberPath(node.object);
    const prop = t.isIdentifier(node.property) ? node.property.name : null;
    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(name));
}

function sourceKindFor(name: string, wanted: string[]): string | null {
  for (const kind of wanted) {
    const pats = SOURCE_PATTERNS[kind];
    if (pats && matchesAny(name, pats)) return kind;
  }
  if (wanted.includes("http.param") && /\.(query|params)\./i.test(name)) return "http.param";
  if (wanted.includes("http.body") && /\.body\./i.test(name)) return "http.body";
  return null;
}

function sinkKindFor(name: string, wanted: string[]): TaintSinkKind | null {
  for (const kind of wanted) {
    const pats = SINK_PATTERNS[kind];
    if (pats && matchesAny(name, pats)) return kind as TaintSinkKind;
  }
  return null;
}

function cloneFact(f: TaintFact): TaintFact {
  return new Map(f);
}

function joinFact(a: TaintFact, b: TaintFact): TaintFact {
  if (a.size === 0) return cloneFact(b);
  if (b.size === 0) return cloneFact(a);
  const out = cloneFact(a);
  for (const [k, path] of b) {
    const prev = out.get(k);
    if (!prev) out.set(k, [...path]);
    else out.set(k, [...prev, ...path.filter((p) => !prev.includes(p))]);
  }
  return out;
}

function factsEqual(a: TaintFact, b: TaintFact): boolean {
  if (a.size !== b.size) return false;
  for (const [k, path] of a) {
    const other = b.get(k);
    if (!other || other.length !== path.length) return false;
  }
  return true;
}

const taintLattice: Lattice<TaintFact> = {
  bottom: () => new Map(),
  join: joinFact,
  equals: factsEqual,
};

function isSanitizerName(callName: string | null, sanitizers: Set<string>): boolean {
  if (!callName) return false;
  for (const s of sanitizers) {
    if (callName === s || callName.endsWith(`.${s}`)) return true;
  }
  return false;
}

function calleeName(node: t.CallExpression | t.NewExpression): string | null {
  return memberPath(node.callee) ?? (t.isIdentifier(node.callee) ? node.callee.name : null);
}

/**
 * Taint of an expression under `fact`.
 *
 * `sources` matters: without it only variables ALREADY in `fact` count, so a
 * source used inline — `db.query(req.query.id)` or `` `... ${req.query.id}` ``
 * — was invisible, and only the via-a-variable form was ever reported. Those
 * inline shapes are the common ones in real code.
 *
 * `sanitizers` clears taint at a wrapping call: `escape(req.query.id)` is
 * clean. Previously only the sink's own callee was checked for sanitization,
 * which was invisible while inline sources went undetected anyway.
 */
function exprTaint(
  node: Node | null | undefined,
  fact: TaintFact,
  sources: string[] = [],
  sanitizers: Set<string> = new Set(),
): string[] | null {
  if (!node) return null;
  if (t.isIdentifier(node)) {
    const known = fact.get(node.name);
    if (known) return known;
    const kind = sourceKindFor(node.name, sources);
    return kind ? [`source:${kind}`] : null;
  }
  if (t.isMemberExpression(node)) {
    const mp = memberPath(node);
    if (mp) {
      const parts = mp.split(".");
      for (let i = parts.length; i >= 1; i--) {
        const prefix = parts.slice(0, i).join(".");
        const p = fact.get(prefix);
        if (p) return [...p, mp];
      }
      // `req.query.id` is a source even though no prefix is bound in `fact`;
      // check the whole path and then each prefix (`req.query`).
      for (let i = parts.length; i >= 1; i--) {
        const prefix = parts.slice(0, i).join(".");
        const kind = sourceKindFor(prefix, sources);
        if (kind) return [`source:${kind}`, mp];
      }
    }
    return exprTaint(node.object, fact, sources, sanitizers) ?? exprTaint(node.property as Node, fact, sources, sanitizers);
  }
  if (t.isBinaryExpression(node) && node.operator === "+") {
    return exprTaint(node.left, fact, sources, sanitizers) ?? exprTaint(node.right, fact, sources, sanitizers);
  }
  if (t.isLogicalExpression(node)) {
    return exprTaint(node.left, fact, sources, sanitizers) ?? exprTaint(node.right, fact, sources, sanitizers);
  }
  if (t.isTemplateLiteral(node)) {
    for (const ex of node.expressions) {
      const p = exprTaint(ex, fact, sources, sanitizers);
      if (p) return p;
    }
    return null;
  }
  if (t.isCallExpression(node) || t.isNewExpression(node)) {
    if (isSanitizerName(calleeName(node), sanitizers)) return null;
    for (const a of node.arguments) {
      if (t.isSpreadElement(a) || t.isArgumentPlaceholder(a)) continue;
      const p = exprTaint(a, fact, sources, sanitizers);
      if (p) return p;
    }
    return null;
  }
  if (t.isAssignmentExpression(node)) return exprTaint(node.right, fact, sources, sanitizers);
  if (t.isConditionalExpression(node)) {
    return exprTaint(node.consequent, fact, sources, sanitizers) ?? exprTaint(node.alternate, fact, sources, sanitizers);
  }
  return null;
}

interface SinkHit {
  node: Node;
  sinkKind: TaintSinkKind;
  path: string[];
}

/**
 * CFG + worklist taint (monotone dataflow) for one statement list.
 * Join over-approximates across branches (may FP); does not drop known flows.
 */
function analyzeRegion(
  stmts: Statement[],
  initial: TaintFact,
  allSources: string[],
  allSinks: string[],
  sanitizers: Set<string>,
): { fact: TaintFact; sinks: SinkHit[] } {
  const sinks: SinkHit[] = [];
  const cfg = buildCfg(stmts);
  if (cfg.length === 0) return { fact: initial, sinks };

  const isSanitized = (callName: string | null): boolean => isSanitizerName(callName, sanitizers);

  const transfer = (fact: TaintFact, node: Node): TaintFact => {
    const next = cloneFact(fact);

    if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (!t.isIdentifier(d.id) || !d.init) continue;
        const mp = memberPath(d.init);
        if (mp) {
          const kind = sourceKindFor(mp, allSources);
          if (kind) {
            next.set(d.id.name, [`source:${kind}`]);
            continue;
          }
        }
        const path = exprTaint(d.init, next, allSources, sanitizers);
        if (path) next.set(d.id.name, path);
        else next.delete(d.id.name);
      }
      return next;
    }

    if (t.isExpressionStatement(node)) return transfer(next, node.expression);

    if (t.isAssignmentExpression(node)) {
      if (t.isIdentifier(node.left)) {
        const mp = memberPath(node.right);
        if (mp) {
          const kind = sourceKindFor(mp, allSources);
          if (kind) {
            next.set(node.left.name, [`source:${kind}`]);
            return next;
          }
        }
        const path = exprTaint(node.right, next, allSources, sanitizers);
        if (path) next.set(node.left.name, path);
        else next.delete(node.left.name);
      }
      if (t.isMemberExpression(node.left)) {
        const leftPath = memberPath(node.left);
        if (leftPath) {
          const sink = sinkKindFor(leftPath, allSinks);
          if (sink) {
            const path = exprTaint(node.right, next, allSources, sanitizers);
            if (path) sinks.push({ node, sinkKind: sink, path: [...path, `sink:${sink}`] });
          }
        }
      }
      return next;
    }

    if (t.isCallExpression(node)) {
      const name = memberPath(node.callee) ?? (t.isIdentifier(node.callee) ? node.callee.name : null);
      if (name && !isSanitized(name)) {
        const sink = sinkKindFor(name, allSinks);
        if (sink) {
          const args =
            sink === "sql.execute" ||
            sink === "network.request" ||
            sink === "http.redirect" ||
            sink === "fs.path"
              ? node.arguments.slice(0, 1)
              : sink === "object.merge"
                ? node.arguments.slice(1)
                : node.arguments;
          for (const arg of args) {
            if (t.isSpreadElement(arg) || t.isArgumentPlaceholder(arg)) continue;
            const path = exprTaint(arg, next, allSources, sanitizers);
            if (path) sinks.push({ node, sinkKind: sink, path: [...path, `sink:${sink}`] });
          }
        }
      }
      return next;
    }

    if (t.isNewExpression(node)) {
      if (t.isIdentifier(node.callee) && node.callee.name === "Function" && allSinks.includes("function_ctor")) {
        const last = node.arguments[node.arguments.length - 1];
        if (last && !t.isSpreadElement(last)) {
          const path = exprTaint(last as Node, next, allSources, sanitizers);
          if (path) sinks.push({ node, sinkKind: "function_ctor", path: [...path, "sink:function_ctor"] });
        }
      }
    }
    return next;
  };

  const { outFact } = runForwardWorklist(cfg, taintLattice, (fact, node) => transfer(fact, node), initial);
  let merged = cloneFact(initial);
  for (const f of outFact) merged = joinFact(merged, f);
  return { fact: merged, sinks };
}

/**
 * L2: monotone CFG dataflow (intra) + same-file inter-procedural param seeding.
 */
export function runTaintRules(ast: File, file: string, source: string, rules: HeroRule[]): EngineFinding[] {
  const findings: EngineFinding[] = [];
  const taintRules = rules.filter((r) => r.taint);
  if (taintRules.length === 0) return findings;

  const allSources = [...new Set(taintRules.flatMap((r) => r.taint!.sources))];
  const allSinks = [...new Set(taintRules.flatMap((r) => r.taint!.sinks))];
  const sanitizers = new Set(taintRules.flatMap((r) => r.taint!.sanitizers ?? []));

  const functions: { name: string | null; params: string[]; body: Statement[] }[] = [];
  const programBody: Statement[] = [];

  traverse(ast, {
    Program(path) {
      for (const stmt of (path.node as t.Program).body) {
        if (t.isFunctionDeclaration(stmt) && stmt.id) {
          functions.push({
            name: stmt.id.name,
            params: stmt.params.filter(t.isIdentifier).map((p) => p.name),
            body: t.isBlockStatement(stmt.body) ? stmt.body.body : [],
          });
        } else {
          programBody.push(stmt);
        }
      }
    },
  });

  traverse(ast, {
    VariableDeclarator(path) {
      const node = path.node as t.VariableDeclarator;
      if (!t.isIdentifier(node.id) || !node.init) return;
      if (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init)) {
        const body = t.isBlockStatement(node.init.body)
          ? node.init.body.body
          : t.isExpression(node.init.body)
            ? [t.expressionStatement(node.init.body)]
            : [];
        functions.push({
          name: node.id.name,
          params: node.init.params.filter(t.isIdentifier).map((p) => p.name),
          body,
        });
      }
    },
  });

  const report = (hit: SinkHit) => {
    for (const rule of taintRules) {
      if (!rule.taint!.sinks.includes(hit.sinkKind)) continue;
      const loc = locOf(hit.node);
      findings.push({
        ruleId: rule.id,
        file,
        ...loc,
        snippet: snippetAt(source, loc.startLine),
        engine: "taint",
        taintPath: hit.path,
      });
    }
  };

  const moduleResult = analyzeRegion(programBody, new Map(), allSources, allSinks, sanitizers);
  for (const s of moduleResult.sinks) report(s);

  const seededParams = new Map<string, TaintFact>();
  const globalFact = moduleResult.fact;

  const byName = new Map(functions.filter((f) => f.name).map((f) => [f.name as string, f]));

  /**
   * Seeds callee parameters from every call site in `stmts`, using `fact` as
   * the taint state of the calling region. Returns true if any seed GREW —
   * only ever adding keys, which is what makes the fixpoint below terminate.
   */
  const propagateCalls = (stmts: Statement[], fact: TaintFact): boolean => {
    let grew = false;
    for (const stmt of stmts) {
      t.traverseFast(stmt, (node) => {
        if (!t.isCallExpression(node)) return;
        const name =
          memberPath(node.callee) ?? (t.isIdentifier(node.callee) ? node.callee.name : null);
        if (!name) return;
        const target = byName.get(name);
        if (!target) return;

        const seed = seededParams.get(name) ?? new Map<string, string[]>();
        node.arguments.forEach((arg, i) => {
          if (t.isSpreadElement(arg) || t.isArgumentPlaceholder(arg)) return;
          const param = target.params[i];
          if (!param || seed.has(param)) return;
          const argPath = exprTaint(arg as Node, fact, allSources, sanitizers);
          if (!argPath) return;
          seed.set(param, [...argPath, `arg→${param}`]);
          grew = true;
        });
        if (seed.size > 0) seededParams.set(name, seed);
      });
    }
    return grew;
  };

  // Fixpoint over the call graph. A single pass only ever finds 1-hop flows:
  // taint that reaches f's parameter has to be re-propagated before g, called
  // from inside f, can be seeded. Iterating until no seed grows converges on
  // chains of any depth, independent of declaration order.
  //
  // Termination: propagateCalls only ADDS parameter keys, and the parameter
  // set is finite, so the seeds form a monotone increasing chain. MAX_ROUNDS
  // is belt-and-braces against a pathological graph, not the actual bound.
  const MAX_ROUNDS = 12;
  propagateCalls(programBody, globalFact);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let grew = false;
    for (const fn of functions) {
      const seed = (fn.name && seededParams.get(fn.name)) || new Map<string, string[]>();
      const { fact } = analyzeRegion(fn.body, seed, allSources, allSinks, sanitizers);
      if (propagateCalls(fn.body, fact)) grew = true;
    }
    if (!grew) break;
  }

  // Only now collect sinks: reporting during the rounds above would emit
  // findings from seeds that were still incomplete.
  for (const fn of functions) {
    const seed = (fn.name && seededParams.get(fn.name)) || new Map();
    const { sinks } = analyzeRegion(fn.body, seed, allSources, allSinks, sanitizers);
    for (const s of sinks) report(s);
  }

  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.ruleId}:${f.startLine}:${f.startColumn}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
