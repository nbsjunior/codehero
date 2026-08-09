#!/usr/bin/env node
/**
 * Importa CWE e OWASP da metadata oficial do SonarSource para o catálogo.
 *
 * O fetch original extraía CWE da DESCRIÇÃO HTML, mas a API pública retorna
 * descrição vazia — então `cwe: []` em todas as 2.668 regras. A fonte
 * confiável é o repo do analisador de CADA linguagem, cruzado pelo número da
 * regra (S2076 existe em várias linguagens com o mesmo CWE):
 *
 *   sonar-java    …/rules/java/S2245.json
 *   sonar-dotnet  analyzers/rspec/cs/S2076.json
 *   sonar-python  …/l10n/py/rules/python/S5332.json
 *     → securityStandards.CWE: [326, 330, ...]
 *     → securityStandards["OWASP Top 10 2021"]: ["A2"]
 *
 * Uso: node scripts/import-sonar-cwe.mjs
 *   grava CWE/OWASP em sonarWayRules.json (só onde forem não-vazios) e roda
 *   build-sonar-live.mjs para regenerar o live.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGO = join(RAIZ, "packages", "contracts", "src", "data", "sonarWayRules.json");

const FONTES = [
  // Ordem importa: a primeira que tiver CWE para um sqKey vence (Java é a mais completa).
  join(RAIZ, ".tmp", "sonar-java", "sonar-java-plugin", "src", "main", "resources", "org", "sonar", "l10n", "java", "rules", "java"),
  join(RAIZ, ".tmp", "sonar-dotnet", "analyzers", "rspec", "cs"),
  join(RAIZ, ".tmp", "sonar-dotnet", "analyzers", "rspec", "vbnet"),
  join(RAIZ, ".tmp", "sonar-python", "python-checks", "src", "main", "resources", "org", "sonar", "l10n", "py", "rules", "python"),
];

// sqKey (S2245) → { cwe, owasp } — mescla entre fontes sem sobrescrever o que já tem.
const meta = new Map();
for (const dir of FONTES) {
  let lidos = 0;
  try {
    for (const arq of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      let j;
      try {
        j = JSON.parse(readFileSync(join(dir, arq), "utf8"));
      } catch {
        continue;
      }
      const key = j.sqKey ?? arq.replace(/\.json$/, "");
      if (!/^S\d+$/.test(key)) continue;
      const ss = j.securityStandards ?? {};
      const cwe = (ss.CWE ?? []).map((n) => `CWE-${n}`);
      const owasp = ss["OWASP Top 10 2021"] ?? ss.OWASP ?? [];
      if (!cwe.length && !owasp.length) continue;
      const prev = meta.get(key) ?? { cwe: [], owasp: [] };
      meta.set(key, {
        cwe: prev.cwe.length ? prev.cwe : cwe,
        owasp: prev.owasp.length ? prev.owasp : owasp,
      });
      lidos++;
    }
  } catch {
    // fonte ausente — segue para a próxima
  }
  if (lidos) console.log(`  ${dir.split(/[\\/]/).slice(-1)[0]}: ${lidos} regras com CWE/OWASP`);
}
console.log(`metadata total: ${meta.size} sqKeys com CWE/OWASP`);

const catalogo = JSON.parse(readFileSync(CATALOGO, "utf8"));
let tocadas = 0, comCwe = 0;
for (const r of catalogo) {
  const m = /:(S\d+)$/.exec(r.sonarKey ?? "") ?? /-(S\d+)$/.exec(r.id ?? "");
  if (!m) continue;
  const md = meta.get(m[1]);
  if (!md) continue;
  if (md.cwe.length && (r.cwe ?? []).length === 0) {
    r.cwe = md.cwe;
    comCwe++;
  }
  if (md.owasp.length && (r.owasp ?? []).length === 0) {
    r.owasp = md.owasp.map((o) => (o.startsWith("A") ? `${o}:2021` : o));
  }
  tocadas++;
}

writeFileSync(CATALOGO, JSON.stringify(catalogo, null, 2));
console.log(`regras tocadas: ${tocadas} | ganharam CWE: ${comCwe}`);
console.log("rode: node scripts/build-sonar-live.mjs  para regenerar o live.");
