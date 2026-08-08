// Corrige bugs do catálogo sonarWayLiveRules.json
// Roda com: node scripts/fixSonarCatalog.mjs
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "packages/contracts/src/data/sonarWayLiveRules.json";
const live = JSON.parse(readFileSync(PATH, "utf8"));

let n = 0;
for (const r of live) {
  // 1) S1313 (IP hardcoded) em todas as linguagens: o literal IP mora em
  //    string ("192.168.1.1"); scope "code" apaga strings -> nunca casa.
  if (r.id.endsWith("-S1313")) {
    r.pattern.scope = "any";
    n++;
  }
  // 2) py-S2076 / py-S8701: regex de child_process (JS) marcada como python.
  if (r.id === "SONAR-py-S2076") {
    r.pattern.regex =
      "(?i)\\b(os\\.system|subprocess\\.(?:call|run|Popen|check_output))\\s*\\([^)]*(?:\\+|%\\s|\\.format\\(|f[\"'])";
    n++;
  }
  if (r.id === "SONAR-py-S8701") {
    r.pattern.regex = "(?i)\\bsubprocess\\.(?:call|run|Popen)\\s*\\([^)]*shell\\s*=\\s*True";
    n++;
  }
}

writeFileSync(PATH, JSON.stringify(live, null, 2));
console.log("regras corrigidas:", n);
