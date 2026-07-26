import type { File, Node } from "@babel/types";
import type { HeroRule } from "@codehero/contracts";
import { locOf, snippetAt } from "./parse.ts";
import { getTraverse } from "./traverse.ts";
import type { EngineFinding } from "./types.ts";

const traverse = getTraverse();

function calleeName(node: Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = calleeName(node.object as Node);
    const prop =
      node.property.type === "Identifier"
        ? node.property.name
        : node.property.type === "StringLiteral"
          ? node.property.value
          : null;
    if (obj && prop) return `${obj}.${prop}`;
    return prop;
  }
  return null;
}

function isLiteralish(node: Node | null | undefined): boolean {
  if (!node) return true;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
      return true;
    case "TemplateLiteral":
      return node.expressions.length === 0;
    case "UnaryExpression":
      return isLiteralish(node.argument);
    default:
      return false;
  }
}

export function runAstRules(ast: File, file: string, source: string, rules: HeroRule[]): EngineFinding[] {
  const findings: EngineFinding[] = [];
  const astRules = rules.filter((r) => r.ast);
  if (astRules.length === 0) return findings;

  traverse(ast, {
    CallExpression(path) {
      const node = path.node as import("@babel/types").CallExpression;
      const name = calleeName(node.callee);
      if (!name) return;
      for (const rule of astRules) {
        const spec = rule.ast!;
        if (spec.kind !== "call") continue;
        if (!spec.callees.some((c) => name === c || name.endsWith(`.${c}`))) continue;
        const arg0 = node.arguments[0] as Node | undefined;
        if (spec.requiresNonLiteralArg && arg0 && !isLiteralish(arg0)) {
          const loc = locOf(node);
          findings.push({ ruleId: rule.id, file, ...loc, snippet: snippetAt(source, loc.startLine), engine: "ast" });
        } else if (!spec.requiresNonLiteralArg) {
          const loc = locOf(node);
          findings.push({ ruleId: rule.id, file, ...loc, snippet: snippetAt(source, loc.startLine), engine: "ast" });
        }
      }
    },
    NewExpression(path) {
      const node = path.node as import("@babel/types").NewExpression;
      if (node.callee.type !== "Identifier" || node.callee.name !== "Function") return;
      for (const rule of astRules) {
        const spec = rule.ast!;
        if (spec.kind !== "call" || !spec.callees.includes("Function")) continue;
        const last = node.arguments[node.arguments.length - 1] as Node | undefined;
        if (spec.requiresNonLiteralArg && last && !isLiteralish(last)) {
          const loc = locOf(node);
          findings.push({ ruleId: rule.id, file, ...loc, snippet: snippetAt(source, loc.startLine), engine: "ast" });
        }
      }
    },
  });

  return findings;
}
