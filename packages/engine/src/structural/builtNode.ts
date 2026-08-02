/**
 * Constructible SyntaxNode for legacy parsers (COBOL / T-SQL) that do not
 * ship in tree-sitter-wasms. Same surface the structural engine already uses.
 */
export interface Pos {
  row: number;
  column: number;
}

export class BuiltNode {
  type: string;
  text: string;
  startPosition: Pos;
  endPosition: Pos;
  parent: BuiltNode | null = null;
  private children: BuiltNode[] = [];
  private fields = new Map<string, BuiltNode>();
  private errored = false;

  constructor(type: string, text: string, start: Pos, end: Pos) {
    this.type = type;
    this.text = text;
    this.startPosition = start;
    this.endPosition = end;
  }

  get childCount(): number {
    return this.children.length;
  }

  get namedChildCount(): number {
    return this.children.filter((c) => !c.type.startsWith("_")).length;
  }

  child(i: number): BuiltNode | null {
    return this.children[i] ?? null;
  }

  namedChild(i: number): BuiltNode | null {
    let n = 0;
    for (const c of this.children) {
      if (c.type.startsWith("_")) continue;
      if (n === i) return c;
      n++;
    }
    return null;
  }

  childForFieldName(field: string): BuiltNode | null {
    return this.fields.get(field) ?? null;
  }

  hasError(): boolean {
    return this.errored;
  }

  markError(): void {
    this.errored = true;
  }

  add(child: BuiltNode, field?: string): void {
    child.parent = this;
    this.children.push(child);
    if (field) this.fields.set(field, child);
  }
}

export function posAt(lines: string[], index: number): Pos {
  // index = 0-based line index in source lines array
  return { row: index, column: 0 };
}

export function endPos(lines: string[], index: number): Pos {
  const line = lines[index] ?? "";
  return { row: index, column: Math.max(0, line.length) };
}
