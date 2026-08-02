#!/usr/bin/env node
/**
 * Fetch Sonar way active rules for CodeHero-covered languages from
 * next.sonarqube.com (public SonarQube) and write snapshots under
 * scripts/data/sonar-way/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "data", "sonar-way");
const BASE = "https://next.sonarqube.com/sonarqube/api";

/** Sonar language keys we care about (+ plsql as closest public stand-in for DB2). */
const WANT = [
  { key: "js", hero: ["javascript"] },
  { key: "ts", hero: ["typescript"] },
  { key: "py", hero: ["python"] },
  { key: "java", hero: ["java"] },
  { key: "cs", hero: ["csharp"] },
  { key: "cobol", hero: ["cobol"] },
  { key: "tsql", hero: ["tsql"] },
  { key: "plsql", hero: ["db2sql"], note: "No public DB2 Sonar way; plsql used as SQL dialect proxy" },
];

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function fetchAllRules(qprofile) {
  const pageSize = 500;
  let page = 1;
  const rules = [];
  for (;;) {
    const url = new URL(`${BASE}/rules/search`);
    url.searchParams.set("activation", "true");
    url.searchParams.set("qprofile", qprofile);
    url.searchParams.set("ps", String(pageSize));
    url.searchParams.set("p", String(page));
    url.searchParams.set(
      "f",
      "repo,name,severity,lang,htmlDesc,mdDesc,tags,sysTags,descriptionSections",
    );
    const data = await getJson(url.toString());
    rules.push(...(data.rules ?? []));
    const total = data.total ?? rules.length;
    if (rules.length >= total || !(data.rules?.length)) break;
    page += 1;
    if (page > 40) break;
  }
  return rules;
}

function extractCwes(...texts) {
  const out = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).matchAll(/\bCWE-?(\d{1,4})\b/gi)) {
      out.add(`CWE-${Number(m[1])}`);
    }
  }
  return [...out];
}

function slimRule(rule) {
  const desc = [
    rule.htmlDesc,
    rule.mdDesc,
    ...(rule.descriptionSections ?? []).map((s) => s.content),
  ]
    .filter(Boolean)
    .join("\n");
  const cwe = extractCwes(desc, rule.name, ...(rule.sysTags ?? []), ...(rule.tags ?? []));
  return {
    key: rule.key,
    name: rule.name,
    lang: rule.lang,
    severity: rule.severity,
    type: rule.type,
    tags: [...new Set([...(rule.sysTags ?? []), ...(rule.tags ?? [])])],
    cwe,
    owasp: [],
    htmlDesc: desc.slice(0, 500),
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const profiles = await getJson(`${BASE}/qualityprofiles/search`);
  const sonarWay = (profiles.profiles ?? []).filter((p) => p.name === "Sonar way");
  const byLang = Object.fromEntries(sonarWay.map((p) => [p.language, p]));

  const index = {
    fetchedAt: new Date().toISOString(),
    source: BASE,
    languages: {},
  };

  for (const want of WANT) {
    const profile = byLang[want.key];
    if (!profile) {
      index.languages[want.key] = {
        available: false,
        hero: want.hero,
        note: want.note ?? "Sonar way profile not found on public instance",
        ruleCount: 0,
      };
      console.log(`skip ${want.key}: no Sonar way profile`);
      continue;
    }
    console.log(`fetch ${want.key} (${profile.key})…`);
    const raw = await fetchAllRules(profile.key);
    const rules = raw.map(slimRule);
    const file = `${want.key}.json`;
    await writeFile(
      join(OUT, file),
      JSON.stringify(
        {
          fetchedAt: index.fetchedAt,
          language: want.key,
          heroLanguages: want.hero,
          note: want.note ?? null,
          profileKey: profile.key,
          profileName: profile.name,
          activeRuleCount: profile.activeRuleCount,
          rules,
        },
        null,
        2,
      ),
    );
    index.languages[want.key] = {
      available: true,
      hero: want.hero,
      note: want.note ?? null,
      profileKey: profile.key,
      ruleCount: rules.length,
      file,
    };
    console.log(`  → ${rules.length} rules`);
  }

  await writeFile(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  console.log(`Wrote ${OUT}/index.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
