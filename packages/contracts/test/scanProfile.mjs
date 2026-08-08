import assert from "node:assert/strict";
import {
  SCAN_PROFILES,
  isScanProfileId,
  mergeScanEngines,
  resolveScanProfile,
  scanEnginesToCliArgs,
  scanProfileToCliArgs,
} from "../dist/scanProfile.js";

assert.equal(isScanProfileId("presence"), true);
assert.equal(isScanProfileId("nope"), false);
assert.equal(resolveScanProfile("bogus").id, "native");
assert.equal(SCAN_PROFILES.presence.engines.oxlint, true);
assert.equal(SCAN_PROFILES.presence.engines.semgrep, false);

const merged = mergeScanEngines(SCAN_PROFILES.native.engines, { oxlint: true, metrics: true });
assert.deepEqual(scanEnginesToCliArgs(merged).sort(), ["--metrics", "--with-oxlint"].sort());

const args = scanProfileToCliArgs("java", { oxlint: true });
assert.ok(args.includes("--profile"));
assert.ok(args.includes("java"));
assert.ok(args.includes("--with-pmd"));
assert.ok(args.includes("--with-spotbugs"));
assert.ok(args.includes("--with-oxlint"));
assert.ok(args.includes("--metrics"));

console.log("scanProfile.mjs ok");
