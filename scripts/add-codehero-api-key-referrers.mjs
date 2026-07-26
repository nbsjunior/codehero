/**
 * Ensures CodeHero Hosting domains are on the shared Firebase Browser API key
 * HTTP referrer allowlist (project apponti). Without this, Auth from
 * codehero.web.app fails with API_KEY_HTTP_REFERRER_BLOCKED.
 *
 * Usage (from repo root, gcloud authenticated on apponti):
 *   node scripts/add-codehero-api-key-referrers.mjs
 */
import { execSync } from "node:child_process";

const PROJECT = "apponti";
const KEY_NAME =
  "projects/529094225320/locations/global/keys/40ee4929-ae0d-44c1-ac66-c0d282b2e667";

const EXTRA = ["codehero.web.app/*", "codehero.firebaseapp.com/*", "localhost:3000/*", "localhost/*"];

const raw = execSync(
  `gcloud services api-keys describe ${KEY_NAME} --project=${PROJECT} --format=json`,
  { encoding: "utf8" },
);
const desc = JSON.parse(raw);
const restrictions = desc.restrictions ?? {};
const current = [...(restrictions.browserKeyRestrictions?.allowedReferrers ?? [])];
const missing = EXTRA.filter((d) => !current.includes(d));
if (missing.length === 0) {
  console.log("Already present:", EXTRA.join(", "));
  process.exit(0);
}

const refs = [...current, ...missing].join(",");
const apiTargets = (restrictions.apiTargets ?? [])
  .map((t) => t.service)
  .filter(Boolean)
  .map((s) => `--api-target=service=${s}`)
  .join(" ");

execSync(
  `gcloud services api-keys update ${KEY_NAME} --project=${PROJECT} --allowed-referrers="${refs}" ${apiTargets}`,
  { stdio: "inherit", shell: true },
);
console.log("Added referrers:", missing.join(", "));
