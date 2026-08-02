import { BuiltNode, endPos, posAt } from "./builtNode.ts";

/**
 * Lightweight COBOL structural parser (PROCEDURE DIVISION focused).
 *
 * Not a full COBOL85 grammar — enough tree shape for metrics (paragraphs as
 * functions, IF/EVALUATE/PERFORM as decisions) and HERO-ST matching via
 * NodeKind unions. Fixed-form and free-form both accepted best-effort.
 */

const PARA =
  /^\s{0,7}([A-Z][A-Z0-9-]{0,29})\s*\.\s*(?:\*.*)?$/i;
const SECTION =
  /^\s{0,7}([A-Z][A-Z0-9-]{0,29})\s+SECTION\s*\.\s*(?:\*.*)?$/i;
const PROC_DIV = /PROCEDURE\s+DIVISION/i;
const COMMENT = /^\s{0,6}\*/;

function stripArea(line: string): string {
  // Fixed-form: cols 1–6 sequence, 7 indicator, 8+ code. Free-form: as-is.
  if (line.length >= 7 && /^[\d\s]{6}/.test(line.slice(0, 6))) {
    const ind = line[6];
    if (ind === "*" || ind === "/") return ""; // comment line
    return line.slice(7);
  }
  return line;
}

export function parseCobolSource(source: string): BuiltNode {
  const rawLines = source.split(/\r?\n/);
  const lines = rawLines.map(stripArea);
  const root = new BuiltNode("program", source, { row: 0, column: 0 }, endPos(lines, lines.length - 1));

  let procStart = lines.findIndex((l) => PROC_DIV.test(l));
  if (procStart < 0) {
    // No PROCEDURE DIVISION — still expose data division as empty program.
    root.markError();
    return root;
  }

  const procedure = new BuiltNode(
    "procedure_division",
    lines.slice(procStart).join("\n"),
    posAt(lines, procStart),
    endPos(lines, lines.length - 1),
  );
  root.add(procedure, "body");

  // Collect paragraph ranges: start line → exclusive end.
  type ParaRange = { name: string; start: number; end: number };
  const paras: ParaRange[] = [];
  for (let i = procStart + 1; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    if (!line || COMMENT.test(rawLines[i] ?? "") || line.trimStart().startsWith("*")) continue;
    const sec = line.match(SECTION);
    const para = line.match(PARA);
    const name = sec?.[1] ?? para?.[1];
    if (!name) continue;
    // Skip COBOL reserved that look like labels when alone.
    if (/^(END-IF|END-EVALUATE|END-PERFORM|END-EXEC|END-STRING|END-SEARCH|EXIT|STOP|GOBACK|CONTINUE)$/i.test(name)) {
      continue;
    }
    if (paras.length) paras[paras.length - 1]!.end = i;
    paras.push({ name: name.toUpperCase(), start: i, end: lines.length });
  }

  for (const p of paras) {
    const bodyLines = lines.slice(p.start, p.end);
    const text = bodyLines.join("\n");
    const paragraph = new BuiltNode("paragraph", text, posAt(lines, p.start), endPos(lines, p.end - 1));
    const id = new BuiltNode("identifier", p.name, posAt(lines, p.start), endPos(lines, p.start));
    paragraph.add(id, "name");
    const body = new BuiltNode(
      "block",
      bodyLines.slice(1).join("\n"),
      posAt(lines, Math.min(p.start + 1, p.end - 1)),
      endPos(lines, p.end - 1),
    );
    parseStatements(bodyLines.slice(1), p.start + 1, body);
    paragraph.add(body, "body");
    procedure.add(paragraph);
  }

  return root;
}

function parseStatements(bodyLines: string[], baseLine: number, parent: BuiltNode): void {
  let i = 0;
  while (i < bodyLines.length) {
    const abs = baseLine + i;
    const raw = bodyLines[i] ?? "";
    const line = raw.trim();
    if (!line || line.startsWith("*")) {
      i++;
      continue;
    }

    // EXEC SQL ... END-EXEC
    if (/^EXEC\s+SQL\b/i.test(line)) {
      let j = i;
      while (j < bodyLines.length && !/\bEND-EXEC\b/i.test(bodyLines[j] ?? "")) j++;
      const chunk = bodyLines.slice(i, j + 1).join("\n");
      const node = new BuiltNode("exec_sql_statement", chunk, posAt(bodyLines, i), endPos(bodyLines, Math.min(j, bodyLines.length - 1)));
      // Shift positions to absolute — BuiltNode rows are relative to bodyLines here;
      // fix by adding baseLine to start/end.
      node.startPosition = { row: abs, column: 0 };
      node.endPosition = { row: baseLine + Math.min(j, bodyLines.length - 1), column: (bodyLines[Math.min(j, bodyLines.length - 1)] ?? "").length };
      const sqlText = chunk.replace(/^EXEC\s+SQL/i, "").replace(/END-EXEC\.?/i, "").trim();
      const assembled = /('\s*\+|CONCAT|\|\|)/i.test(sqlText) || /:\s*[A-Z0-9-]+/i.test(sqlText);
      const arg = new BuiltNode(
        assembled ? "binary_expression" : "string_literal",
        sqlText.slice(0, 200),
        node.startPosition,
        node.endPosition,
      );
      if (assembled) {
        arg.add(new BuiltNode("string_literal", "SQL", node.startPosition, node.startPosition));
        arg.add(new BuiltNode("identifier", "HOST-VAR", node.startPosition, node.startPosition));
      }
      const callee = new BuiltNode("identifier", "EXEC-SQL", node.startPosition, node.startPosition);
      node.add(callee, "function");
      const args = new BuiltNode("argument_list", sqlText.slice(0, 200), node.startPosition, node.endPosition);
      args.add(arg);
      node.add(args, "arguments");
      parent.add(node);
      i = j + 1;
      continue;
    }

    // IF ... END-IF (or NEXT SENTENCE / period-terminated classic IF)
    if (/^IF\b/i.test(line)) {
      let j = i;
      let depth = 0;
      for (; j < bodyLines.length; j++) {
        const t = (bodyLines[j] ?? "").trim();
        if (/^IF\b/i.test(t)) depth++;
        if (/\bEND-IF\b/i.test(t)) {
          depth--;
          if (depth <= 0) break;
        }
        // Classic IF with NEXT SENTENCE / single statement ending in period — stop at next paragraph-like.
        if (j > i && depth === 1 && /\bNEXT\s+SENTENCE\b/i.test(t)) {
          break;
        }
      }
      if (j >= bodyLines.length) j = bodyLines.length - 1;
      const chunk = bodyLines.slice(i, j + 1).join("\n");
      const node = new BuiltNode("if_statement", chunk, { row: abs, column: 0 }, { row: baseLine + j, column: (bodyLines[j] ?? "").length });
      const inner = new BuiltNode("block", bodyLines.slice(i + 1, j).join("\n"), { row: abs + 1, column: 0 }, { row: baseLine + j, column: 0 });
      parseStatements(bodyLines.slice(i + 1, j), baseLine + i + 1, inner);
      node.add(inner, "body");
      parent.add(node);
      i = j + 1;
      continue;
    }

    // EVALUATE ... END-EVALUATE
    if (/^EVALUATE\b/i.test(line)) {
      let j = i;
      let depth = 0;
      for (; j < bodyLines.length; j++) {
        const t = (bodyLines[j] ?? "").trim();
        if (/^EVALUATE\b/i.test(t)) depth++;
        if (/\bEND-EVALUATE\b/i.test(t)) {
          depth--;
          if (depth <= 0) break;
        }
      }
      if (j >= bodyLines.length) j = bodyLines.length - 1;
      const chunk = bodyLines.slice(i, j + 1).join("\n");
      const node = new BuiltNode("evaluate_statement", chunk, { row: abs, column: 0 }, { row: baseLine + j, column: (bodyLines[j] ?? "").length });
      // WHEN clauses as case-like decisions
      for (let k = i; k <= j; k++) {
        if (/^\s*WHEN\b/i.test(bodyLines[k] ?? "")) {
          node.add(
            new BuiltNode("when_clause", (bodyLines[k] ?? "").trim(), { row: baseLine + k, column: 0 }, { row: baseLine + k, column: (bodyLines[k] ?? "").length }),
          );
        }
      }
      parent.add(node);
      i = j + 1;
      continue;
    }

    // PERFORM ... [UNTIL|VARYING|TIMES] ... [END-PERFORM]
    if (/^PERFORM\b/i.test(line)) {
      const isLoop = /\b(UNTIL|VARYING|TIMES)\b/i.test(line);
      let j = i;
      if (/\bEND-PERFORM\b/i.test(line)) {
        // single line
      } else if (isLoop) {
        let depth = 0;
        for (; j < bodyLines.length; j++) {
          const t = (bodyLines[j] ?? "").trim();
          if (/^PERFORM\b/i.test(t) && /\b(UNTIL|VARYING|TIMES)\b/i.test(t)) depth++;
          if (/\bEND-PERFORM\b/i.test(t)) {
            depth--;
            if (depth <= 0) break;
          }
        }
        if (j >= bodyLines.length) j = i;
      }
      const chunk = bodyLines.slice(i, j + 1).join("\n");
      const type = isLoop ? "perform_until_statement" : "perform_statement";
      const node = new BuiltNode(type, chunk, { row: abs, column: 0 }, { row: baseLine + j, column: (bodyLines[j] ?? "").length });
      const target = line.replace(/^PERFORM\b/i, "").replace(/\b(THRU|THROUGH|UNTIL|VARYING|TIMES)\b.*/i, "").trim().split(/\s+/)[0];
      if (target) {
        const callee = new BuiltNode("identifier", target.replace(/\.$/, ""), node.startPosition, node.startPosition);
        node.add(callee, "function");
      }
      if (isLoop && j > i) {
        const inner = new BuiltNode("block", bodyLines.slice(i + 1, j).join("\n"), { row: abs + 1, column: 0 }, { row: baseLine + j, column: 0 });
        parseStatements(bodyLines.slice(i + 1, j), baseLine + i + 1, inner);
        node.add(inner, "body");
      }
      parent.add(node);
      i = j + 1;
      continue;
    }

    // GO TO
    if (/^GO\s+TO\b/i.test(line) || /^GOTO\b/i.test(line)) {
      const node = new BuiltNode("goto_statement", line, { row: abs, column: 0 }, { row: abs, column: raw.length });
      parent.add(node);
      i++;
      continue;
    }

    // CALL literal or identifier
    if (/^CALL\b/i.test(line)) {
      const node = new BuiltNode("call_statement", line, { row: abs, column: 0 }, { row: abs, column: raw.length });
      const m = line.match(/^CALL\s+('.+?'|".+?"|[A-Z0-9-]+)/i);
      const target = m?.[1] ?? "UNKNOWN";
      const isLit = /^['"]/.test(target);
      const callee = new BuiltNode(
        isLit ? "string_literal" : "identifier",
        target.replace(/^['"]|['"]$/g, ""),
        node.startPosition,
        node.startPosition,
      );
      node.add(callee, "function");
      // Dynamic CALL (identifier) — expose as non-literal argument for HERO-ST
      if (!isLit) {
        const args = new BuiltNode("argument_list", target, node.startPosition, node.endPosition);
        args.add(new BuiltNode("identifier", target, node.startPosition, node.startPosition));
        node.add(args, "arguments");
      }
      parent.add(node);
      i++;
      continue;
    }

    // Generic statement leaf
    parent.add(new BuiltNode("statement", line, { row: abs, column: 0 }, { row: abs, column: raw.length }));
    i++;
  }
}
