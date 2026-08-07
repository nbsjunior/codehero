import { readdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { languageForFile } from "./engine.ts";
import type { IgnoreMatcher } from "./ignore.ts";
import { mapPool } from "./pool.ts";

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
  // Firebase CLI deploy cache: holds a full copy of the built hosting bundle,
  // so scanning it re-reports every finding against minified vendor chunks.
  ".firebase",
  ".turbo",
  ".cache",
]);

const MAX_FILE_BYTES = 1_000_000; // skip very large/generated files
const WALK_CONCURRENCY = Math.max(1, Number(process.env.CODEHERO_WALK_CONCURRENCY ?? 16) || 16);

/** Recursively collect analyzable source files under the given paths (sync). */
export function collectFiles(roots: string[], ignore?: IgnoreMatcher): string[] {
  const files: string[] = [];
  const cwd = process.cwd();
  for (const root of roots) walkSync(root, files, cwd, ignore);
  return files;
}

/** Async walk with bounded concurrency — preferred for large trees. */
export async function collectFilesAsync(roots: string[], ignore?: IgnoreMatcher): Promise<string[]> {
  const cwd = process.cwd();
  const out: string[] = [];
  await mapPool(roots, Math.min(WALK_CONCURRENCY, Math.max(1, roots.length)), async (root) => {
    await walkAsync(root, out, cwd, ignore);
  });
  return out;
}

function walkSync(path: string, out: string[], cwd: string, ignore?: IgnoreMatcher): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }

  if (ignore) {
    const rel = relative(cwd, path) || path;
    if (ignore(rel)) return;
  }

  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (IGNORED_DIRS.has(entry)) continue;
      walkSync(join(path, entry), out, cwd, ignore);
    }
  } else if (st.isFile()) {
    if (st.size > MAX_FILE_BYTES) return;
    if (languageForFile(path)) out.push(path);
  }
}

async function walkAsync(path: string, out: string[], cwd: string, ignore?: IgnoreMatcher): Promise<void> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return;
  }

  if (ignore) {
    const rel = relative(cwd, path) || path;
    if (ignore(rel)) return;
  }

  if (st.isDirectory()) {
    let entries: string[];
    try {
      entries = await readdir(path);
    } catch {
      return;
    }
    const children = entries.filter((e) => !IGNORED_DIRS.has(e)).map((e) => join(path, e));
    await mapPool(children, WALK_CONCURRENCY, async (child) => {
      await walkAsync(child, out, cwd, ignore);
    });
  } else if (st.isFile()) {
    if (st.size > MAX_FILE_BYTES) return;
    if (languageForFile(path)) out.push(path);
  }
}
