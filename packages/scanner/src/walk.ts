import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { languageForFile } from "./engine.ts";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

const MAX_FILE_BYTES = 1_000_000; // skip very large/generated files

/** Recursively collect analyzable source files under the given paths. */
export function collectFiles(roots: string[]): string[] {
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  return files;
}

function walk(path: string, out: string[]): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (IGNORED_DIRS.has(entry)) continue;
      walk(join(path, entry), out);
    }
  } else if (st.isFile()) {
    if (st.size > MAX_FILE_BYTES) return;
    if (languageForFile(path)) out.push(path);
  }
}
