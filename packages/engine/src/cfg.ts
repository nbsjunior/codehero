import type { Node, Statement, BlockStatement, IfStatement, WhileStatement, ForStatement, DoWhileStatement } from "@babel/types";
import * as t from "@babel/types";

/** Basic block in a control-flow graph (CFG). */
export interface CfgBlock {
  id: number;
  /** Statements / expressions executed in this block (order preserved). */
  nodes: Node[];
  /** Successor block ids. */
  succ: number[];
}

/**
 * Build a CFG for a statement list (function body or program body).
 * Models branches (`if`) and loops (`while`/`for`/`do-while`) with back-edges.
 * Complexity target: O(N) blocks for typical structured code.
 */
export function buildCfg(stmts: Statement[]): CfgBlock[] {
  const blocks: CfgBlock[] = [];
  const alloc = (nodes: Node[] = []): CfgBlock => {
    const b: CfgBlock = { id: blocks.length, nodes, succ: [] };
    blocks.push(b);
    return b;
  };

  function link(from: CfgBlock, to: CfgBlock): void {
    if (!from.succ.includes(to.id)) from.succ.push(to.id);
  }

  /** Returns the entry block and the set of exit blocks that fall through. */
  function buildSeq(list: Statement[], entry: CfgBlock): CfgBlock[] {
    let current = entry;
    let exits: CfgBlock[] = [current];

    for (const stmt of list) {
      // Start a fresh block if previous closed (branches/loops).
      if (exits.length !== 1 || exits[0] !== current || current.nodes.length > 0) {
        if (exits.length === 0) {
          // Unreachable code after return/throw — still allocate for completeness.
          current = alloc();
          exits = [current];
        } else if (exits.length === 1 && exits[0]!.nodes.length === 0 && exits[0] === current) {
          // reuse empty current
        } else {
          const next = alloc();
          for (const e of exits) link(e, next);
          current = next;
          exits = [current];
        }
      }

      if (t.isIfStatement(stmt)) {
        exits = buildIf(stmt, current);
        current = exits[0] ?? alloc();
        continue;
      }
      if (t.isWhileStatement(stmt) || t.isForStatement(stmt) || t.isDoWhileStatement(stmt)) {
        exits = buildLoop(stmt, current);
        current = exits[0] ?? alloc();
        continue;
      }
      if (t.isBlockStatement(stmt)) {
        exits = buildSeq(stmt.body, current);
        current = exits.length === 1 ? exits[0]! : current;
        continue;
      }

      current.nodes.push(stmt);
      if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt) || t.isBreakStatement(stmt) || t.isContinueStatement(stmt)) {
        exits = []; // no fall-through
      } else {
        exits = [current];
      }
    }
    return exits;
  }

  function buildIf(stmt: IfStatement, prelude: CfgBlock): CfgBlock[] {
    prelude.nodes.push(stmt.test);
    const thenEntry = alloc();
    link(prelude, thenEntry);
    const thenExits = t.isBlockStatement(stmt.consequent)
      ? buildSeq(stmt.consequent.body, thenEntry)
      : buildSeq([stmt.consequent], thenEntry);

    let elseExits: CfgBlock[];
    if (stmt.alternate) {
      const elseEntry = alloc();
      link(prelude, elseEntry);
      elseExits = t.isBlockStatement(stmt.alternate)
        ? buildSeq(stmt.alternate.body, elseEntry)
        : buildSeq([stmt.alternate], elseEntry);
    } else {
      elseExits = [prelude]; // fall-through when test is false
    }

    const join = alloc();
    for (const e of [...thenExits, ...elseExits]) link(e, join);
    return [join];
  }

  function buildLoop(
    stmt: WhileStatement | ForStatement | DoWhileStatement,
    prelude: CfgBlock,
  ): CfgBlock[] {
    const header = alloc();
    link(prelude, header);
    if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
      header.nodes.push(stmt.test);
    } else if (stmt.test) {
      header.nodes.push(stmt.test);
    }

    const bodyEntry = alloc();
    link(header, bodyEntry);
    const body = t.isBlockStatement(stmt.body) ? stmt.body.body : [stmt.body];
    const bodyExits = buildSeq(body, bodyEntry);
    for (const e of bodyExits) link(e, header); // back-edge

    const after = alloc();
    link(header, after); // exit when test fails
    return [after];
  }

  const entry = alloc();
  buildSeq(stmts, entry);
  // Drop empty unreachable tails with no preds except entry keep
  return blocks;
}

/** Extract top-level statement list from a Program/Block. */
export function statementsOf(node: BlockStatement | { body: Statement[] }): Statement[] {
  return node.body;
}
