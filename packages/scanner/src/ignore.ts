import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Project-level scan exclusions (.codeheroignore).
//
// A SAST tool without exclusions is unusable on a real repo: deliberately
// vulnerable fixtures, vendored code and build artifacts would permanently
// red the quality gate. Syntax is a gitignore-style subset — no dependency,
// matching the rest of the scanner.
// ---------------------------------------------------------------------------

export const IGNORE_FILE = ".codeheroignore";

/** Reads .codeheroignore from the given root. Missing file → no patterns. */
export function loadIgnoreFile(root: string): string[] {
  try {
    return parseIgnore(readFileSync(join(root, IGNORE_FILE), "utf8"));
  } catch {
    return [];
  }
}

export function parseIgnore(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * gitignore-style subset:
 *   `dir/`            → the directory and everything under it
 *   `*.min.js`        → basename glob at any depth
 *   `a/b/c.ts`        → path anchored at the scan root
 *   `**` / `**​/`      → spans path segments
 */
function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  if (p.endsWith("/")) p = p.slice(0, -1);

  let body = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else {
        body += "[^/]*";
      }
    } else if (c === "?") {
      body += "[^/]";
    } else if (c && "\\^$.|+()[]{}".includes(c)) {
      body += `\\${c}`;
    } else {
      body += c;
    }
  }

  // A pattern without a slash matches at any depth (gitignore semantics).
  const prefix = anchored || p.includes("/") ? "^" : "^(?:.*/)?";
  // Trailing `(?:/.*)?` makes a directory pattern cover its whole subtree.
  return new RegExp(`${prefix}${body}(?:/.*)?$`);
}

export type IgnoreMatcher = (relPath: string) => boolean;

export function makeIgnoreMatcher(patterns: string[]): IgnoreMatcher {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(patternToRegex);
  return (relPath: string) => {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    return regexes.some((re) => re.test(normalized));
  };
}
