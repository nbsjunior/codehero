// OWASP Benchmark + Presence Pack (CodeHero native + Semgrep).
// Compara native-only vs native+semgrep no mesmo gabarito.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeSource } from "../../scanner/dist/engine.js";

const BENCH = ".tmp/benchmark-java";
const TESTCODE = join(BENCH, "src/main/java/org/owasp/benchmark/testcode");
const OUT = join(".tmp", "presence-owasp");
mkdirSync(OUT, { recursive: true });

const CWE_POR_REGRA = {
  "HERO-SEC-0089-jdbc-sqli": ["89"],
  "HERO-SEC-0078-cmd-injection-java": ["78"],
  "HERO-SEC-0022-path-traversal-java": ["22"],
  "HERO-SEC-0079-xss-java": ["79"],
  "HERO-SEC-0090-ldap-injection-java": ["90"],
  "HERO-SEC-0643-xpath-injection-java": ["643"],
  "HERO-SEC-0501-trust-boundary-java": ["501"],
  "HERO-SEC-0327-weak-hash": ["327", "328"],
  "HERO-SEC-0327-weak-hash-java": ["327", "328"],
  "HERO-SEC-0614-insecure-cookie-java": ["614"],
  "SONAR-java-S2076": ["78"], "SONAR-java-S5883": ["78"], "SONAR-java-S4036": ["78"],
  "SONAR-java-S2083": ["22"], "SONAR-java-S6096": ["22"],
  "SONAR-java-S2078": ["90"], "SONAR-java-S2091": ["643"],
  "SONAR-java-S5131": ["79"], "SONAR-java-S2245": ["330"],
  "SONAR-java-S4790": ["328"], "SONAR-java-S2053": ["328", "759"],
  "SONAR-java-S4426": ["327"], "SONAR-java-S5542": ["327"], "SONAR-java-S5547": ["327"],
  "SONAR-java-S3329": ["329", "327"], "SONAR-java-S2092": ["614"], "SONAR-java-S3330": ["614", "1004"],
  "SONAR-java-S6287": ["501"],
};

// Semgrep rule-id / message heuristics → CWE (cobertura típica do p/java + p/security-audit)
function cweDoSemgrep(ruleId, message = "") {
  const s = `${ruleId} ${message}`.toLowerCase();
  if (/sql.?inject|sqli|jdbc|preparestatement/.test(s)) return ["89"];
  if (/command.?inject|os.?command|processbuilder|runtime\.exec|cmdi/.test(s)) return ["78"];
  if (/path.?travers|path.?inject|zip.?slip|file.?inject|directory.?travers/.test(s)) return ["22"];
  if (/xss|cross.?site.?script|reflcted/.test(s)) return ["79"];
  if (/ldap/.test(s)) return ["90"];
  if (/xpath/.test(s)) return ["643"];
  if (/cookie|secure.?flag|httponly/.test(s)) return ["614"];
  if (/weak.?hash|md5|sha1|message.?digest/.test(s)) return ["328"];
  if (/weak.?crypt|des\b|rc4|blowfish|insecure.?cipher|aes.?ecb/.test(s)) return ["327"];
  if (/random|prng|math\.random|util\.random/.test(s)) return ["330"];
  if (/trust.?bound|session.?setattribute|putvalue/.test(s)) return ["501"];
  return [];
}

const csv = readFileSync(join(BENCH, "expectedresults-1.2.csv"), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const gabarito = new Map();
for (const l of csv) {
  const [name, categoria, real, cwe] = l.split(",");
  gabarito.set(name.trim(), { categoria: categoria.trim(), real: real.trim() === "true", cwe: cwe.trim() });
}

// --- Semgrep uma vez no diretório ---
const sarifPath = join(OUT, "semgrep.sarif");
if (!existsSync(sarifPath)) {
  console.log("rodando Semgrep (p/java + p/security-audit) no testcode…");
  const r = spawnSync(
    "semgrep",
    ["scan", "--config", "p/java", "--config", "p/security-audit", "--sarif", "--output", sarifPath, "--quiet", TESTCODE],
    { encoding: "utf8", timeout: 600_000, env: { ...process.env, PATH: process.env.PATH } },
  );
  if (!existsSync(sarifPath)) {
    console.error("Semgrep falhou:", (r.stderr || r.stdout || "").slice(0, 500));
    process.exit(1);
  }
  console.log("SARIF gravado:", sarifPath);
} else {
  console.log("reusando SARIF:", sarifPath);
}

const sarif = JSON.parse(readFileSync(sarifPath, "utf8"));
const semgrepPorArquivo = new Map(); // basename sem .java -> Set<cwe>
for (const run of sarif.runs ?? []) {
  for (const res of run.results ?? []) {
    const uri = res.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "";
    const base = uri.replace(/\\/g, "/").split("/").pop()?.replace(/\.java$/, "");
    if (!base) continue;
    const ruleId = res.ruleId ?? "";
    const msg = res.message?.text ?? "";
    const cwes = cweDoSemgrep(ruleId, msg);
    if (!cwes.length) continue;
    if (!semgrepPorArquivo.has(base)) semgrepPorArquivo.set(base, new Set());
    for (const c of cwes) semgrepPorArquivo.get(base).add(c);
  }
}
console.log(`Semgrep: ${semgrepPorArquivo.size} arquivos com CWE mapeado`);

// CWEs onde o engine native é confiável (path-sensitive após P0). Nessas o
// Presence só aceita Semgrep se o native TAMBÉM marcou (interseção) — corta FP.
// Nas fracas (ldap/xpath/trustbound pré-P1) o Semgrep entra em união (recall).
const CWE_NATIVO_FORTE = new Set(["89", "78", "22", "79", "328", "327", "330", "614"]);
const CWE_UNIAO = new Set(["90", "643", "501"]); // engine nativo fraco → aceita Semgrep

function score(mode) {
  const stats = new Map();
  const stat = (cat) => {
    if (!stats.has(cat)) stats.set(cat, { tp: 0, fp: 0, tn: 0, fn: 0 });
    return stats.get(cat);
  };
  for (const arq of readdirSync(TESTCODE).filter((f) => f.endsWith(".java"))) {
    const nome = arq.replace(/\.java$/, "");
    const g = gabarito.get(nome);
    if (!g) continue;
    const nativo = new Set();
    if (mode === "native" || mode === "combined" || mode === "smart") {
      const fonte = readFileSync(join(TESTCODE, arq), "utf8");
      for (const f of analyzeSource(arq, fonte)) {
        const doCat = (f.rule.cwe ?? []).map((c) => c.replace(/^CWE-/, ""));
        const doMap = CWE_POR_REGRA[f.rule.id] ?? [];
        for (const c of [...doCat, ...doMap]) nativo.add(c);
      }
    }
    const sem = mode === "semgrep" || mode === "combined" || mode === "smart"
      ? (semgrepPorArquivo.get(nome) ?? new Set())
      : new Set();

    const disparados = new Set();
    if (mode === "native") {
      for (const c of nativo) disparados.add(c);
    } else if (mode === "semgrep") {
      for (const c of sem) disparados.add(c);
    } else if (mode === "combined") {
      for (const c of nativo) disparados.add(c);
      for (const c of sem) disparados.add(c);
    } else if (mode === "smart") {
      // P2 — merge inteligente:
      //  - CWE forte (path-sensitive): Semgrep só conta se native também (interseção).
      //  - CWE fraca (ldap/xpath/trustbound): união para não perder recall.
      for (const c of nativo) disparados.add(c);
      for (const c of sem) {
        if (CWE_UNIAO.has(c)) disparados.add(c);
        else if (CWE_NATIVO_FORTE.has(c) && nativo.has(c)) disparados.add(c); // já incluído
        else if (!CWE_NATIVO_FORTE.has(c) && !CWE_UNIAO.has(c)) disparados.add(c);
      }
    }
    const s = stat(g.categoria);
    const hit = disparados.has(g.cwe);
    if (g.real) { if (hit) s.tp++; else s.fn++; }
    else { if (hit) s.fp++; else s.tn++; }
  }
  let tot = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const s of stats.values()) {
    tot.tp += s.tp; tot.fp += s.fp; tot.tn += s.tn; tot.fn += s.fn;
  }
  const tpr = tot.tp / (tot.tp + tot.fn || 1);
  const fpr = tot.fp / (tot.fp + tot.tn || 1);
  const prec = tot.tp / (tot.tp + tot.fp || 1);
  const f1 = (2 * prec * tpr) / (prec + tpr || 1);
  return { stats, tot, tpr, fpr, prec, f1, score: tpr - fpr };
}

const fmt = (n) => (n * 100).toFixed(1) + "%";
console.log("\nmodo           | recall | precisão | FPR   | F1    | OWASP Score");
console.log("---------------+--------+----------+-------+-------+------------");
const resultados = {};
for (const mode of ["native", "semgrep", "combined", "smart"]) {
  const r = score(mode);
  resultados[mode] = r;
  console.log(
    `${mode.padEnd(14)} | ${fmt(r.tpr).padStart(6)} | ${fmt(r.prec).padStart(8)} | ${fmt(r.fpr).padStart(5)} | ${fmt(r.f1).padStart(5)} | ${(r.score * 100).toFixed(1)}`,
  );
}

const pick = (m) => ({ tpr: m.tpr, fpr: m.fpr, prec: m.prec, f1: m.f1, score: m.score, tot: m.tot });
writeFileSync(join(OUT, "resultados.json"), JSON.stringify({
  geradoEm: new Date().toISOString(),
  semgrepArquivos: semgrepPorArquivo.size,
  native: pick(resultados.native),
  semgrep: pick(resultados.semgrep),
  combined: pick(resultados.combined),
  smart: pick(resultados.smart),
}, null, 2));
console.log("\ngravado:", join(OUT, "resultados.json"));
