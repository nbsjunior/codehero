/**
 * Restores apps/functions/package.json after Firebase deploy packaging.
 */
import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "apps", "functions", "package.json");
const bakPath = join(root, "apps", "functions", "package.json.workspace");

if (existsSync(bakPath)) {
  const bak = readFileSync(bakPath, "utf8");
  // write via rename for atomicity on local FS
  const tmp = pkgPath + ".tmp";
  const { writeFileSync } = await import("node:fs");
  writeFileSync(tmp, bak);
  renameSync(tmp, pkgPath);
  unlinkSync(bakPath);
  console.log("restored apps/functions/package.json");
} else {
  console.log("no package.json.workspace — skip restore");
}
