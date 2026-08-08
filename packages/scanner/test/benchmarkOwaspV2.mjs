// Re-avaliação OWASP BenchmarkJava com o scanner REAL (analyzeSource),
// agora incluindo o lineTaint (L2 sem parser) para Java.
//
// O catálogo SONAR ainda não importa CWE (bug de dados separado), então o
// harness mapeia regra→CWE explicitamente — mesmo mapa do V1.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeSource } from "../../scanner/dist/engine.js";

const BENCH = ".tmp/benchmark-java";
const TESTCODE = join(BENCH, "src/main/java/org/owasp/benchmark/testcode");

const CWE_DA_CATEGORIA = {
  sqli: "89", cmdi: "78", pathtraver: "22", xss: "79", ldapi: "90",
  xpathi: "643", weakrand: "330", hash: "328", crypto: "327",
  securecookie: "614", trustbound: "501",
};

// Regra → CWE (números S estáveis do Sonar + HERO que já têm CWE).
const CWE_POR_REGRA = {
  "HERO-SEC-0089-jdbc-sqli": ["89"],
  "HERO-SEC-0078-cmd-injection-java": ["78"],
  "HERO-SEC-0022-path-traversal-java": ["22"],
  "HERO-SEC-0079-xss-java": ["79"],
  "HERO-SEC-0327-weak-hash": ["327", "328"],
  "SONAR-java-S2076": ["78"], "SONAR-java-S5883": ["78"], "SONAR-java-S4036": ["78"],
  "SONAR-java-S2083": ["22"], "SONAR-java-S6096": ["22"],
  "SONAR-java-S2078": ["90"], "SONAR-java-S2091": ["643"],
  "SONAR-java-S5131": ["79"], "SONAR-java-S2245": ["330"],
  "SONAR-java-S4790": ["328"], "SONAR-java-S2053": ["328", "759"],
  "SONAR-java-S4426": ["327"], "SONAR-java-S5542": ["327"], "SONAR-java-S5547": ["327"],
  "SONAR-java-S3329": ["329", "327"], "SONAR-java-S2092": ["614"], "SONAR-java-S3330": ["614", "1004"],
  "SONAR-java-S6287": ["501"], "SONAR-java-S2068": ["798"], "SONAR-java-S6418": ["798"],
  "SONAR-java-S6437": ["798"], "SONAR-java-S2115": ["521"],
  // Regras taint novas (Java)
  "HERO-SEC-0090-ldap-injection-java": ["90"],
  "HERO-SEC-0643-xpath-injection-java": ["643"],
  "HERO-SEC-0501-trust-boundary-java": ["501"],
  "HERO-SEC-0327-weak-hash-java": ["327", "328"],
  "HERO-SEC-0614-insecure-cookie-java": ["614"],
};

const csv = readFileSync(join(BENCH, "expectedresults-1.2.csv"), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const gabarito = new Map();
for (const l of csv) {
  const [name, categoria, real, cwe] = l.split(",");
  gabarito.set(name.trim(), { categoria: categoria.trim(), real: real.trim() === "true", cwe: cwe.trim() });
}

const arquivos = readdirSync(TESTCODE).filter((f) => f.endsWith(".java"));
const stats = new Map();
const stat = (cat) => { if (!stats.has(cat)) stats.set(cat, { tp: 0, fp: 0, tn: 0, fn: 0 }); return stats.get(cat); };

const inicio = Date.now();
for (const arq of arquivos) {
  const nome = arq.replace(/\.java$/, "");
  const g = gabarito.get(nome);
  if (!g) continue;
  const cweEsperado = g.cwe;
  const fonte = readFileSync(join(TESTCODE, arq), "utf8");

  const disparados = new Set();
  for (const f of analyzeSource(arq, fonte)) {
    // CWE do catálogo OU do mapa (catálogo SONAR ainda tem cwe vazio).
    const doCatalogo = (f.rule.cwe ?? []).map((c) => c.replace(/^CWE-/, ""));
    const doMapa = CWE_POR_REGRA[f.rule.id] ?? [];
    for (const c of [...doCatalogo, ...doMapa]) disparados.add(c);
  }

  const s = stat(g.categoria);
  const acertou = disparados.has(cweEsperado);
  if (g.real) { if (acertou) s.tp++; else s.fn++; }
  else { if (acertou) s.fp++; else s.tn++; }
}

const fmt = (n) => (n * 100).toFixed(1) + "%";
let tot = { tp: 0, fp: 0, tn: 0, fn: 0 };
console.log("categoria      |   TP |   FN |   FP |   TN | recall | precisão | F1");
console.log("---------------+------+------+------+------+--------+----------+------");
for (const [cat, s] of [...stats.entries()].sort()) {
  const recall = s.tp / (s.tp + s.fn || 1), prec = s.tp / (s.tp + s.fp || 1);
  const f1 = (2 * prec * recall) / (prec + recall || 1);
  console.log(`${cat.padEnd(14)} | ${String(s.tp).padStart(4)} | ${String(s.fn).padStart(4)} | ${String(s.fp).padStart(4)} | ${String(s.tn).padStart(4)} | ${fmt(recall).padStart(6)} | ${fmt(prec).padStart(8)} | ${fmt(f1)}`);
  tot.tp += s.tp; tot.fp += s.fp; tot.tn += s.tn; tot.fn += s.fn;
}
const recall = tot.tp / (tot.tp + tot.fn || 1), prec = tot.tp / (tot.tp + tot.fp || 1);
const f1 = (2 * prec * recall) / (prec + recall || 1);
console.log("---------------+------+------+------+------+--------+----------+------");
console.log(`${"TOTAL".padEnd(14)} | ${String(tot.tp).padStart(4)} | ${String(tot.fn).padStart(4)} | ${String(tot.fp).padStart(4)} | ${String(tot.tn).padStart(4)} | ${fmt(recall).padStart(6)} | ${fmt(prec).padStart(8)} | ${fmt(f1)}`);
console.log(`\n${arquivos.length} casos em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
