import { BuiltNode, endPos } from "./builtNode.ts";

/**
 * Lightweight T-SQL structural parser.
 *
 * Enough to treat CREATE PROCEDURE as a function, IF/WHILE/TRY as control
 * flow, and EXEC(@sql) / sp_executesql as calls for HERO-ST + metrics.
 */

const CREATE_PROC =
  /^\s*CREATE\s+(?:OR\s+ALTER\s+)?(?:PROC|PROCEDURE)\s+([#\w.[\]]+)/i;
const CREATE_FN =
  /^\s*CREATE\s+(?:OR\s+ALTER\s+)?FUNCTION\s+([#\w.[\]]+)/i;

export function parseTsqlSource(source: string): BuiltNode {
  const lines = source.split(/\r?\n/);
  const root = new BuiltNode("program", source, { row: 0, column: 0 }, endPos(lines, lines.length - 1));

  // Split on GO batch separator
  const batches: Array<{ start: number; end: number }> = [];
  let batchStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*GO\s*$/i.test(lines[i] ?? "")) {
      if (i > batchStart) batches.push({ start: batchStart, end: i });
      batchStart = i + 1;
    }
  }
  if (batchStart < lines.length) batches.push({ start: batchStart, end: lines.length });
  if (batches.length === 0) batches.push({ start: 0, end: lines.length });

  for (const b of batches) {
    const chunk = lines.slice(b.start, b.end);
    parseBatch(chunk, b.start, root);
  }

  return root;
}

function parseBatch(lines: string[], base: number, root: BuiltNode): void {
  const text = lines.join("\n");
  const head = lines.find((l) => CREATE_PROC.test(l) || CREATE_FN.test(l)) ?? "";
  const proc = head.match(CREATE_PROC);
  const fn = head.match(CREATE_FN);
  const name = (proc?.[1] ?? fn?.[1] ?? "batch").replace(/[\[\]]/g, "");

  const containerType = proc || fn ? "procedure_definition" : "batch";
  const container = new BuiltNode(containerType, text, { row: base, column: 0 }, { row: base + lines.length - 1, column: (lines[lines.length - 1] ?? "").length });
  container.add(new BuiltNode("identifier", name, { row: base, column: 0 }, { row: base, column: name.length }), "name");

  const body = new BuiltNode("block", text, container.startPosition, container.endPosition);
  parseBlock(lines, base, body);
  container.add(body, "body");
  root.add(container);
}

function parseBlock(lines: string[], base: number, parent: BuiltNode): void {
  let i = 0;
  while (i < lines.length) {
    const abs = base + i;
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (!line || line.startsWith("--") || line.startsWith("/*")) {
      i++;
      continue;
    }

    // BEGIN TRY ... END TRY / BEGIN CATCH ... END CATCH
    if (/^BEGIN\s+TRY\b/i.test(line)) {
      const { end, node } = takeBlock(lines, i, base, /^BEGIN\s+TRY\b/i, /^END\s+TRY\b/i, "try_statement");
      parent.add(node);
      i = end + 1;
      continue;
    }
    if (/^BEGIN\s+CATCH\b/i.test(line)) {
      const { end, node } = takeBlock(lines, i, base, /^BEGIN\s+CATCH\b/i, /^END\s+CATCH\b/i, "catch_clause");
      parent.add(node);
      i = end + 1;
      continue;
    }

    // WHILE
    if (/^WHILE\b/i.test(line)) {
      const { end, node } = takeControl(lines, i, base, "while_statement");
      parent.add(node);
      i = end + 1;
      continue;
    }

    // IF
    if (/^IF\b/i.test(line)) {
      const { end, node } = takeControl(lines, i, base, "if_statement");
      parent.add(node);
      i = end + 1;
      continue;
    }

    // EXEC / EXECUTE
    if (/^EXEC(?:UTE)?\b/i.test(line)) {
      const node = new BuiltNode("call_statement", line, { row: abs, column: 0 }, { row: abs, column: raw.length });
      // EXEC(@sql) or EXEC(@var)
      const dyn = line.match(/^EXEC(?:UTE)?\s*\(\s*(.+?)\s*\)/i);
      const sp = line.match(/^EXEC(?:UTE)?\s+(sp_executesql)\b/i);
      const named = line.match(/^EXEC(?:UTE)?\s+([#\w.[\]]+)/i);
      if (dyn) {
        const inner = dyn[1]!.trim();
        const isLit = /^N?'/.test(inner) || /^N?"/.test(inner);
        const callee = new BuiltNode("identifier", "EXEC", node.startPosition, node.startPosition);
        node.add(callee, "function");
        const args = new BuiltNode("argument_list", inner, node.startPosition, node.endPosition);
        args.add(
          new BuiltNode(isLit ? "string_literal" : "identifier", inner.replace(/^N?['"]|['"]$/g, ""), node.startPosition, node.endPosition),
        );
        // Assembled dynamic SQL often built earlier — mark non-literal EXEC(@x) as assembled proxy
        if (!isLit) {
          const bin = new BuiltNode("binary_expression", inner, node.startPosition, node.endPosition);
          bin.add(new BuiltNode("string_literal", "SQL", node.startPosition, node.startPosition));
          bin.add(new BuiltNode("identifier", inner, node.startPosition, node.startPosition));
          args.add(bin); // last arg for assembled check via index any
        }
        node.add(args, "arguments");
      } else if (sp) {
        const callee = new BuiltNode("identifier", "sp_executesql", node.startPosition, node.startPosition);
        node.add(callee, "function");
        const args = new BuiltNode("argument_list", line, node.startPosition, node.endPosition);
        // First arg after sp_executesql
        const first = line.match(/sp_executesql\s+(N?'(?:''|[^'])*'|N?"(?:[^"])*"|@\w+)/i);
        if (first) {
          const a = first[1]!;
          const isLit = /^N?'/.test(a) || /^N?"/.test(a);
          args.add(new BuiltNode(isLit ? "string_literal" : "identifier", a, node.startPosition, node.endPosition));
        }
        node.add(args, "arguments");
      } else if (named) {
        const callee = new BuiltNode("identifier", named[1]!.replace(/[\[\]]/g, ""), node.startPosition, node.startPosition);
        node.add(callee, "function");
      }
      parent.add(node);
      i++;
      continue;
    }

    // SET @sql = '...' + @x  → expose binary for assembled detection nearby
    if (/^SET\s+@\w+\s*=/i.test(line) && (/'\s*\+|\+\s*'/.test(line) || /\|\|/.test(line))) {
      const node = new BuiltNode("assignment", line, { row: abs, column: 0 }, { row: abs, column: raw.length });
      const bin = new BuiltNode("binary_expression", line, node.startPosition, node.endPosition);
      bin.add(new BuiltNode("string_literal", "SQL", node.startPosition, node.startPosition));
      bin.add(new BuiltNode("identifier", "@var", node.startPosition, node.startPosition));
      node.add(bin);
      parent.add(node);
      i++;
      continue;
    }

    parent.add(new BuiltNode("statement", line, { row: abs, column: 0 }, { row: abs, column: raw.length }));
    i++;
  }
}

function takeBlock(
  lines: string[],
  start: number,
  base: number,
  open: RegExp,
  close: RegExp,
  type: string,
): { end: number; node: BuiltNode } {
  let depth = 0;
  let end = start;
  for (let j = start; j < lines.length; j++) {
    const t = (lines[j] ?? "").trim();
    if (open.test(t)) depth++;
    if (close.test(t)) {
      depth--;
      if (depth <= 0) {
        end = j;
        break;
      }
    }
    end = j;
  }
  const chunk = lines.slice(start, end + 1).join("\n");
  const node = new BuiltNode(type, chunk, { row: base + start, column: 0 }, { row: base + end, column: (lines[end] ?? "").length });
  const inner = new BuiltNode("block", lines.slice(start + 1, end).join("\n"), { row: base + start + 1, column: 0 }, { row: base + end, column: 0 });
  parseBlock(lines.slice(start + 1, end), base + start + 1, inner);
  node.add(inner, "body");
  return { end, node };
}

function takeControl(lines: string[], start: number, base: number, type: string): { end: number; node: BuiltNode } {
  // IF / WHILE followed by BEGIN...END or single statement
  let end = start;
  const next = (lines[start + 1] ?? "").trim();
  if (/^BEGIN\b/i.test(next)) {
    let depth = 0;
    for (let j = start + 1; j < lines.length; j++) {
      const t = (lines[j] ?? "").trim();
      if (/^BEGIN\b/i.test(t)) depth++;
      if (/^END\b/i.test(t)) {
        depth--;
        if (depth <= 0) {
          end = j;
          break;
        }
      }
      end = j;
    }
  } else {
    end = Math.min(start + 1, lines.length - 1);
  }
  const chunk = lines.slice(start, end + 1).join("\n");
  const node = new BuiltNode(type, chunk, { row: base + start, column: 0 }, { row: base + end, column: (lines[end] ?? "").length });
  if (end > start) {
    const inner = new BuiltNode("block", lines.slice(start + 1, end + 1).join("\n"), { row: base + start + 1, column: 0 }, { row: base + end, column: 0 });
    parseBlock(lines.slice(start + 1, end + 1), base + start + 1, inner);
    node.add(inner, "body");
  }
  return { end, node };
}
