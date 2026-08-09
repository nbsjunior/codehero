#!/usr/bin/env node
/**
 * Compare CodeHero RULES (+ golden corpus) vs Sonar way snapshots.
 *
 * Usage: node scripts/compare-sonar-way.mjs
 * Requires: scripts/data/sonar-way/*.json (from fetch-sonar-way.mjs)
 *           @codehero/contracts built (RULES export)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "scripts", "data", "sonar-way");
const OUT = join(ROOT, "reports");

/** Extra synonyms keyed by CWE number or topic slug — boosts semantic match when Sonar omits CWE ids. */
const TOPIC_SYNONYMS = {
  798: ["hard-coded", "hardcoded", "credential", "secret", "password", "api key", "api-key"],
  89: ["sql injection", "sqli", "sql-injection", "dynamic sql", "executeQuery", "prepared statement"],
  327: ["weak hash", "md5", "sha1", "sha-1", "broken cryptography", "weak cryptographic"],
  95: ["eval", "code injection", "dynamic code", "Function("],
  79: ["xss", "cross-site scripting", "innerHTML", "dangerouslySetInnerHTML"],
  78: ["os command", "command injection", "shell injection", "child_process", "Process.Start", "Runtime.exec", "xp_cmdshell"],
  918: ["ssrf", "server-side request forgery"],
  22: ["path traversal", "directory traversal", "zip slip", "../"],
  601: ["open redirect", "unvalidated redirect"],
  1321: ["prototype pollution", "__proto__", "prototype"],
  330: ["insecure random", "math.random", "predictable", "weak random"],
  295: ["tls", "certificate", "ssl verification", "rejectUnauthorized", "insecure trust"],
  532: ["log injection", "sensitive data in log", "clear-text logging", "credentials in log"],
  506: ["pipe to shell", "curl | sh", "curl|bash", "wget | sh"],
  502: ["insecure deserialization", "untrusted deserialization", "ObjectInputStream", "BinaryFormatter", "pickle"],
  611: ["xxe", "xml external entity", "external entity"],
  489: ["debug", "console.log", "System.out", "Debug.Write", "print statement"],
  546: ["todo", "fixme", "hack comment"],
};

const STOP = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "not", "be", "is", "are",
  "should", "must", "with", "from", "this", "that", "when", "using", "use", "code", "rule",
]);

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#./_-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function normalizeCwe(list) {
  const out = new Set();
  for (const raw of list ?? []) {
    const m = String(raw).match(/(\d{1,4})/);
    if (m) out.add(Number(m[1]));
  }
  return [...out];
}

function heroBagBag(rule) {
  const cwes = normalizeCwe(rule.cwe);
  const bag = new Set([
    ...tokenize(rule.id),
    ...tokenize(rule.name),
    ...tokenize(rule.message),
    ...tokenize(rule.category),
    ...tokenize((rule.owasp ?? []).join(" ")),
  ]);
  for (const n of cwes) {
    bag.add(`cwe-${n}`);
    bag.add(String(n));
    for (const s of TOPIC_SYNONYMS[n] ?? []) {
      for (const t of tokenize(s)) bag.add(t);
      bag.add(s.toLowerCase());
    }
  }
  // id slug tokens after HERO-SEC-####-
  const slug = String(rule.id).replace(/^HERO-(SEC|SMELL)-\d+-?/i, "");
  for (const t of tokenize(slug.replace(/-/g, " "))) bag.add(t);
  return { cwes, bag: [...bag] };
}

function sonarBagBag(rule) {
  const cwes = normalizeCwe(rule.cwe);
  const bag = new Set([
    ...tokenize(rule.key),
    ...tokenize(rule.name),
    ...tokenize((rule.tags ?? []).join(" ")),
    ...tokenize(rule.htmlDesc),
  ]);
  for (const n of cwes) {
    bag.add(`cwe-${n}`);
    bag.add(String(n));
  }
  // expand tags that signal topics
  const tagText = (rule.tags ?? []).join(" ").toLowerCase();
  if (tagText.includes("sql") || tagText.includes("injection")) {
    for (const t of tokenize("sql injection")) bag.add(t);
  }
  if (tagText.includes("secret") || tagText.includes("credential")) {
    for (const t of tokenize("hardcoded secret credential")) bag.add(t);
  }
  return { cwes, bag: [...bag], haystack: [...bag].join(" ") };
}

function typeCompatible(heroType, sonarType) {
  if (!sonarType) return true;
  const h = String(heroType).toUpperCase();
  const s = String(sonarType).toUpperCase();
  if (h === s) return true;
  if (h === "VULNERABILITY" && (s === "SECURITY_HOTSPOT" || s === "VULNERABILITY")) return true;
  if (h === "CODE_SMELL" && (s === "CODE_SMELL" || s === "BUG")) return true;
  if (h === "BUG" && (s === "BUG" || s === "CODE_SMELL")) return true;
  return false;
}

function scoreMatch(hero, sonar) {
  const h = heroBagBag(hero);
  const s = sonarBagBag(sonar);
  const cweHit = h.cwes.some((c) => s.cwes.includes(c));

  let hits = 0;
  let multiHits = 0;
  for (const token of h.bag) {
    if (token.length < 3 && !/^\d+$/.test(token)) continue;
    if (s.haystack.includes(token)) {
      hits += 1;
      if (token.includes(" ") || token.length >= 6) multiHits += 1;
    }
  }
  // phrase checks for synonym phrases
  for (const n of h.cwes) {
    for (const phrase of TOPIC_SYNONYMS[n] ?? []) {
      if (s.haystack.includes(phrase.toLowerCase()) || sonar.name.toLowerCase().includes(phrase.toLowerCase())) {
        multiHits += 2;
        hits += 2;
      }
    }
  }

  const compatible = typeCompatible(hero.type, sonar.type);
  let level = null;
  if (cweHit && compatible) level = "strong";
  else if (cweHit) level = "partial";
  else if (multiHits >= 2 && compatible) level = "strong";
  else if (hits >= 3 && compatible) level = "partial";
  else if (multiHits >= 1 && hits >= 2) level = "partial";

  return { level, hits, multiHits, cweHit, compatible };
}

function langApplies(heroLangs, sonarLang, heroLangMap) {
  if (heroLangs.includes("any")) return true;
  const mapped = heroLangMap[sonarLang] ?? [];
  return mapped.some((hl) => heroLangs.includes(hl));
}

async function loadHeroRules() {
  const distPath = join(ROOT, "packages", "contracts", "dist", "rules.js");
  const indexPath = join(ROOT, "packages", "contracts", "dist", "index.js");
  let rules = null;
  for (const p of [distPath, indexPath]) {
    try {
      const mod = await import(pathToFileURL(p).href);
      if (mod.RULES?.length) {
        rules = mod.RULES;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!rules) {
    const { execSync } = await import("node:child_process");
    execSync("npm run build -w @codehero/contracts", { cwd: ROOT, stdio: "inherit" });
    const mod = await import(pathToFileURL(distPath).href);
    if (!mod.RULES?.length) throw new Error("Failed to load RULES from @codehero/contracts");
    rules = mod.RULES;
  }
  // Semântica Hero↔Sonar usa só CORE. Incluir sonar-port faria cada SONAR-*
  // “cobrir” a si mesmo e inflar a % sem ganho real de detecção.
  return rules.filter((r) => (r.implementation ?? "core") === "core");
}

async function main() {
  const index = JSON.parse(await readFile(join(DATA, "index.json"), "utf8"));
  const heroRules = await loadHeroRules();
  const golden = JSON.parse(await readFile(join(ROOT, "packages/ruleforge/corpus/golden.json"), "utf8"));
  const goldenByRule = new Map();
  for (const c of golden) {
    const arr = goldenByRule.get(c.ruleId) ?? [];
    arr.push(c);
    goldenByRule.set(c.ruleId, arr);
  }

  const sonarRules = [];
  const heroLangMap = {};
  for (const [lang, meta] of Object.entries(index.languages)) {
    heroLangMap[lang] = meta.hero ?? [];
    if (!meta.available || !meta.file) continue;
    const snap = JSON.parse(await readFile(join(DATA, meta.file), "utf8"));
    for (const r of snap.rules) {
      sonarRules.push({ ...r, _lang: lang, _note: snap.note });
    }
  }

  // Sonar → best Hero match
  const sonarResults = [];
  for (const sr of sonarRules) {
    let best = null;
    for (const hr of heroRules) {
      if (!langApplies(hr.languages, sr._lang, heroLangMap)) continue;
      const scored = scoreMatch(hr, sr);
      if (!scored.level) continue;
      const rank = scored.level === "strong" ? 2 : 1;
      if (!best || rank > best.rank || (rank === best.rank && scored.hits > best.hits)) {
        best = { ...scored, rank, heroId: hr.id, heroName: hr.name };
      }
    }
    const status = best?.level === "strong" ? "covered" : best?.level === "partial" ? "partial" : "uncovered";
    sonarResults.push({
      key: sr.key,
      name: sr.name,
      lang: sr._lang,
      type: sr.type,
      severity: sr.severity,
      tags: sr.tags,
      status,
      heroId: best?.heroId ?? null,
      hits: best?.hits ?? 0,
    });
  }

  // Hero → Sonar analogues
  const heroResults = heroRules.map((hr) => {
    const analogues = [];
    for (const sr of sonarRules) {
      if (!langApplies(hr.languages, sr._lang, heroLangMap)) continue;
      const scored = scoreMatch(hr, sr);
      if (!scored.level) continue;
      analogues.push({
        key: sr.key,
        name: sr.name,
        lang: sr._lang,
        type: sr.type,
        level: scored.level,
        hits: scored.hits,
      });
    }
    analogues.sort((a, b) => (b.level === "strong") - (a.level === "strong") || b.hits - a.hits);
    const top = analogues.slice(0, 8);
    const cases = goldenByRule.get(hr.id) ?? [];
    return {
      id: hr.id,
      name: hr.name,
      type: hr.type,
      severity: hr.severity,
      languages: hr.languages,
      cwe: hr.cwe,
      has_sonar_analogue: analogues.length > 0,
      analogueCount: analogues.length,
      analogues: top,
      in_golden_corpus: cases.length > 0,
      goldenCases: cases.length,
    };
  });

  function tally(list, keyFn) {
    const m = {};
    for (const x of list) {
      const k = keyFn(x);
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }

  const byStatus = tally(sonarResults, (r) => r.status);
  const byLang = {};
  for (const lang of Object.keys(index.languages)) {
    const subset = sonarResults.filter((r) => r.lang === lang);
    if (!subset.length && !index.languages[lang].available) {
      byLang[lang] = { available: false, note: index.languages[lang].note, total: 0 };
      continue;
    }
    const st = tally(subset, (r) => r.status);
    byLang[lang] = {
      available: true,
      total: subset.length,
      covered: st.covered ?? 0,
      partial: st.partial ?? 0,
      uncovered: st.uncovered ?? 0,
      coveragePct: subset.length
        ? Math.round((((st.covered ?? 0) + (st.partial ?? 0)) / subset.length) * 1000) / 10
        : 0,
    };
  }

  const uncoveredByType = tally(
    sonarResults.filter((r) => r.status === "uncovered"),
    (r) => r.type || "UNKNOWN",
  );

  const securityGaps = sonarResults
    .filter((r) => r.status === "uncovered" && (r.type === "VULNERABILITY" || r.type === "SECURITY_HOTSPOT"))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.key.localeCompare(b.key));

  const smellGapsSample = sonarResults
    .filter((r) => r.status === "uncovered" && r.type === "CODE_SMELL")
    .slice(0, 40);

  const heroOnly = heroResults.filter((h) => !h.has_sonar_analogue);
  const heroWithoutGolden = heroResults.filter((h) => !h.in_golden_corpus);

  const totalSonar = sonarResults.length;
  const coveredOrPartial = (byStatus.covered ?? 0) + (byStatus.partial ?? 0);

  /** Métrica que importa para o motor: ids na curadoria (live scannable), não stub. */
  let liveScannable = null;
  try {
    const catalog = JSON.parse(
      await readFile(join(ROOT, "packages/contracts/src/data/sonarWayRules.json"), "utf8"),
    );
    const curation = JSON.parse(
      await readFile(join(ROOT, "packages/contracts/src/data/sonarWayCuration.json"), "utf8"),
    );
    const selected = new Set(curation.selecao);
    const tally = (pred) => {
      const rows = catalog.filter(pred);
      const live = rows.filter((r) => selected.has(r.id));
      return {
        total: rows.length,
        stub: rows.filter((r) => r.implementation === "stub").length,
        genSonarPort: rows.filter((r) => r.implementation === "sonar-port").length,
        liveCurated: live.length,
        livePct: rows.length ? Math.round((live.length / rows.length) * 1000) / 10 : 0,
      };
    };
    liveScannable = {
      all: tally(() => true),
      vulnerability: tally((r) => r.type === "VULNERABILITY"),
      bug: tally((r) => r.type === "BUG"),
      codeSmell: tally((r) => r.type === "CODE_SMELL"),
    };
  } catch (e) {
    console.warn("live scannable metrics skipped:", e.message);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: index.source,
    fetchedAt: index.fetchedAt,
    limitations: [
      "Semantic match (Hero core ↔ Sonar names/CWE) ≠ live scannable catalog coverage.",
      "covered/partial ≠ equivalent detection power (L0 regex vs Sonar analyzers).",
      "Live scannable = sonarWayCuration.selecao; stubs do catálogo não disparam no scanner.",
      "plsql snapshot is a public proxy for DB2SQL (no dedicated DB2 Sonar way on the public instance).",
      "Dress-code overlays excluded — canonical RULES + golden corpus only.",
    ],
    summary: {
      sonarWayRules: totalSonar,
      sonarCovered: byStatus.covered ?? 0,
      sonarPartial: byStatus.partial ?? 0,
      sonarUncovered: byStatus.uncovered ?? 0,
      sonarCoveragePct: totalSonar ? Math.round((coveredOrPartial / totalSonar) * 1000) / 10 : 0,
      uncoveredByType,
      heroRules: heroRules.length,
      heroWithSonarAnalogue: heroResults.filter((h) => h.has_sonar_analogue).length,
      heroWithSonarAnaloguePct: Math.round(
        (heroResults.filter((h) => h.has_sonar_analogue).length / heroRules.length) * 1000,
      ) / 10,
      heroInGoldenCorpus: heroResults.filter((h) => h.in_golden_corpus).length,
      heroInGoldenCorpusPct: Math.round(
        (heroResults.filter((h) => h.in_golden_corpus).length / heroRules.length) * 1000,
      ) / 10,
      goldenCases: golden.length,
      liveScannable,
    },
    byLanguage: byLang,
    securityGaps: securityGaps.slice(0, 120),
    securityGapTotal: securityGaps.length,
    smellGapsSample,
    heroResults,
    heroOnly,
    heroWithoutGolden,
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "sonar-way-coverage.json"), JSON.stringify(report, null, 2));

  const md = renderMarkdown(report);
  await writeFile(join(OUT, "sonar-way-coverage.md"), md);
  console.log(`Wrote ${join(OUT, "sonar-way-coverage.json")}`);
  console.log(`Wrote ${join(OUT, "sonar-way-coverage.md")}`);
  console.log(
    `Sonar way coverage: ${report.summary.sonarCoveragePct}% (${report.summary.sonarCovered} covered + ${report.summary.sonarPartial} partial / ${report.summary.sonarWayRules})`,
  );
  console.log(
    `Hero with Sonar analogue: ${report.summary.heroWithSonarAnaloguePct}% · golden: ${report.summary.heroInGoldenCorpusPct}%`,
  );
}

function renderMarkdown(report) {
  const s = report.summary;
  const lines = [];
  lines.push("# CodeHero × Sonar way — coverage report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: \`${report.source}\` (fetched ${report.fetchedAt})`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(
    `Cobertura **semântica** (Hero core ↔ nomes/CWE Sonar): **${s.sonarCoveragePct}%** (${s.sonarCovered} covered + ${s.sonarPartial} partial out of **${s.sonarWayRules}**).`,
  );
  if (s.liveScannable) {
    const v = s.liveScannable.vulnerability;
    const a = s.liveScannable.all;
    lines.push("");
    lines.push(
      `Cobertura **live scannable** (curadoria → motor): **${a.livePct}%** do catálogo (${a.liveCurated}/${a.total}); VULN **${v.livePct}%** (${v.liveCurated}/${v.total}). Stubs **não** contam.`,
    );
  }
  lines.push("");
  lines.push(`Of **${s.heroRules}** canonical Hero rules, **${s.heroWithSonarAnalogue}** (${s.heroWithSonarAnaloguePct}%) have at least one Sonar analogue; **${s.heroInGoldenCorpus}** (${s.heroInGoldenCorpusPct}%) appear in the golden corpus (${s.goldenCases} cases).`);
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  for (const L of report.limitations) lines.push(`- ${L}`);
  lines.push("");
  if (s.liveScannable) {
    lines.push("## Live scannable (motor)");
    lines.push("");
    lines.push("| Escopo | Total | Stub catálogo | sonar-port gerado | Live curado | Live % |");
    lines.push("|--------|------:|--------------:|------------------:|------------:|-------:|");
    for (const [k, row] of Object.entries(s.liveScannable)) {
      lines.push(
        `| ${k} | ${row.total} | ${row.stub} | ${row.genSonarPort} | ${row.liveCurated} | ${row.livePct} |`,
      );
    }
    lines.push("");
    lines.push(
      "Esteira: `npm run sonar:engenharia -- all` — prioriza VULN, promove com golden/F1, smells ficam stub salvo ROI.",
    );
    lines.push("");
  }
  lines.push("## By language");
  lines.push("");
  lines.push("| Lang | Available | Total | Covered | Partial | Uncovered | Coverage % |");
  lines.push("|------|-----------|------:|--------:|--------:|----------:|-----------:|");
  for (const [lang, row] of Object.entries(report.byLanguage)) {
    if (!row.available) {
      lines.push(`| ${lang} | no | — | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${lang} | yes | ${row.total} | ${row.covered} | ${row.partial} | ${row.uncovered} | ${row.coveragePct} |`,
    );
  }
  lines.push("");
  lines.push("## Uncovered Sonar rules by type");
  lines.push("");
  for (const [t, n] of Object.entries(s.uncoveredByType).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${t}**: ${n}`);
  }
  lines.push("");
  lines.push(`## Security gaps (Vulnerability / Hotspot) — ${report.securityGapTotal} total, showing ${report.securityGaps.length}`);
  lines.push("");
  lines.push("| Lang | Key | Name | Type |");
  lines.push("|------|-----|------|------|");
  for (const g of report.securityGaps) {
    lines.push(`| ${g.lang} | \`${g.key}\` | ${g.name.replace(/\|/g, "/")} | ${g.type} |`);
  }
  lines.push("");
  lines.push("## Sample uncovered CODE_SMELL");
  lines.push("");
  for (const g of report.smellGapsSample.slice(0, 25)) {
    lines.push(`- \`${g.key}\` (${g.lang}): ${g.name}`);
  }
  lines.push("");
  lines.push("## CodeHero rules without Sonar analogue");
  lines.push("");
  if (!report.heroOnly.length) lines.push("_None — every Hero rule matched at least partially._");
  for (const h of report.heroOnly) {
    lines.push(`- \`${h.id}\` — ${h.name} (${h.type}, ${h.languages.join(",")})`);
  }
  lines.push("");
  lines.push("## CodeHero rules missing golden corpus cases");
  lines.push("");
  for (const h of report.heroWithoutGolden) {
    lines.push(`- \`${h.id}\` — ${h.name}`);
  }
  lines.push("");
  lines.push("## CodeHero catalogue (analogues)");
  lines.push("");
  lines.push("| Hero rule | Golden | Analogues | Top Sonar match |");
  lines.push("|-----------|--------|----------:|-----------------|");
  for (const h of report.heroResults) {
    const top = h.analogues[0];
    const topLabel = top ? `\`${top.key}\` (${top.level})` : "—";
    lines.push(
      `| \`${h.id}\` | ${h.in_golden_corpus ? h.goldenCases : "—"} | ${h.analogueCount} | ${topLabel} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
