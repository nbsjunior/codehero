import babelTraverse from "@babel/traverse";
import type { File } from "@babel/types";

type VisitorMap = Record<string, (path: { node: unknown; scope?: unknown; traverse?: (v: VisitorMap) => void }) => void>;

/** Resolve CJS/ESM default interop for @babel/traverse across Node loaders. */
export function getTraverse(): (ast: File, visitors: VisitorMap) => void {
  let cur: unknown = babelTraverse;
  for (let i = 0; i < 4; i++) {
    if (typeof cur === "function") return cur as (ast: File, visitors: VisitorMap) => void;
    if (cur && typeof cur === "object" && "default" in cur) {
      cur = (cur as { default: unknown }).default;
      continue;
    }
    break;
  }
  throw new Error("@babel/traverse export is not callable in this runtime");
}
