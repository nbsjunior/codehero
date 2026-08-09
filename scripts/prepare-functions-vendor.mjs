/**
 * Vendors workspace packages into apps/functions so Cloud Build can
 * `npm install` without hitting the public registry for @codehero/*.
 * Rewrites package.json deps to file:./vendor/... (restored in postdeploy).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const functionsDir = join(root, "apps", "functions");
const vendorDir = join(functionsDir, "vendor");
const pkgPath = join(functionsDir, "package.json");
const bakPath = join(functionsDir, "package.json.workspace");

function copyPkg(name) {
  const src = join(root, "packages", name);
  const dest = join(vendorDir, name);
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, "package.json"), join(dest, "package.json"));
  cpSync(join(src, "dist"), join(dest, "dist"), { recursive: true });
  const corpus = join(src, "corpus");
  if (existsSync(corpus)) cpSync(corpus, join(dest, "corpus"), { recursive: true });
  return dest;
}

rmSync(vendorDir, { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });

copyPkg("contracts");
copyPkg("engine");
copyPkg("ruleforge");
copyPkg("fp-ranker");

const ruleforgePkgPath = join(vendorDir, "ruleforge", "package.json");
const ruleforgePkg = JSON.parse(readFileSync(ruleforgePkgPath, "utf8"));
if (ruleforgePkg.dependencies?.["@codehero/contracts"]) {
  ruleforgePkg.dependencies["@codehero/contracts"] = "file:../contracts";
}
if (ruleforgePkg.dependencies?.["@codehero/engine"]) {
  ruleforgePkg.dependencies["@codehero/engine"] = "file:../engine";
}
writeFileSync(ruleforgePkgPath, JSON.stringify(ruleforgePkg, null, 2) + "\n");

const enginePkgPath = join(vendorDir, "engine", "package.json");
const enginePkg = JSON.parse(readFileSync(enginePkgPath, "utf8"));
if (enginePkg.dependencies?.["@codehero/contracts"]) {
  enginePkg.dependencies["@codehero/contracts"] = "file:../contracts";
  writeFileSync(enginePkgPath, JSON.stringify(enginePkg, null, 2) + "\n");
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!existsSync(bakPath)) {
  writeFileSync(bakPath, JSON.stringify(pkg, null, 2) + "\n");
}
pkg.dependencies = {
  ...pkg.dependencies,
  "@codehero/contracts": "file:./vendor/contracts",
  "@codehero/engine": "file:./vendor/engine",
  "@codehero/ruleforge": "file:./vendor/ruleforge",
  "@codehero/fp-ranker": "file:./vendor/fp-ranker",
};
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log("prepared apps/functions/vendor (contracts + engine + ruleforge + fp-ranker)");
