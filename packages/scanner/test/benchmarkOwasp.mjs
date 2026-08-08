// Avaliação OWASP BenchmarkJava v1.2 — mede precisão/recall reais do CodeHero.
//
// O Benchmark tem 2.740 servlets Java rotulados: cada caso é vulnerável
// (real=true) ou uma isca semanticamente segura (real=false — sink presente,
// mas entrada hardcoded/sanitizada). O CSV dá a categoria e o CWE esperado.
//
// Metodologia: para cada arquivo, rodamos as regras Java do CodeHero
// (matchPattern, mesmo caminho do scanner), coletamos os CWEs disparados e
// comparamos com o CWE rotulado:
//   TP: caso real e pelo menos uma regra do CWE certo disparou
//   FN: caso real e nada do CWE disparou
//   FP: isca e algo do CWE disparou
//   TN: isca e nada disparou
//
// O mapeamento regra→CWE usa os números S estáveis do Sonar (o catálogo
// CodeHero ainda não importa o campo CWE do Sonar — pendência registrada).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RULES, matchPattern, lexicalProfileFor } from "@codehero/contracts";

const BENCH = ".tmp/benchmark-java";
const TESTCODE = join(BENCH, "src/main/java/org/owasp/benchmark/testcode");

// CWE por categoria do Benchmark.
const CWE_DA_CATEGORIA = {
  sqli: "89",
  cmdi: "78",
  pathtraver: "22",
  xss: "79",
  ldapi: "90",
  xpathi: "643",
  weakrand: "330",
  hash: "328",
  crypto: "327",
  securecookie: "614",
  trustbound: "501",
};

// Regra → CWE (números S do Sonar são estáveis; HERO já tem CWE no catálogo).
const CWE_POR_REGRA = {
  "HERO-SEC-0089-jdbc-sqli": ["89"],
  "HERO-SEC-0078-cmd-injection-java": ["78"],
  "HERO-SEC-0327-weak-hash": ["327", "328"],
  "SONAR-java-S2076": ["78"],   // command injection
  "SONAR-java-S5883": ["78"],   // argument injection
  "SONAR-java-S4036": ["78"],   // PATH resolution (parcial)
  "SONAR-java-S2083": ["22"],   // path traversal
  "SONAR-java-S6096": ["22"],   // zip slip
  "SONAR-java-S2078": ["90"],   // ldap
  "SONAR-java-S2091": ["643"],  // xpath
  "SONAR-java-S5131": ["79"],   // xss
  "SONAR-java-S2245": ["330"],  // weak random
  "SONAR-java-S4790": ["328"],  // weak hash
  "SONAR-java-S2053": ["328", "759"], // salt
  "SONAR-java-S4426": ["327"],  // weak crypto keys
  "SONAR-java-S5542": ["327"],  // insecure mode/padding
  "SONAR-java-S5547": ["327"],  // weak cipher
  "SONAR-java-S3329": ["329", "327"], // CBC IV
  "SONAR-java-S2092": ["614"],  // secure flag cookie
  "SONAR-java-S3330": ["614", "1004"], // httponly
  "SONAR-java-S6287": ["501"],  // session from untrusted input (trustbound)
  "SONAR-java-S2068": ["798"],  // hardcoded creds
  "SONAR-java-S6418": ["798"],
  "SONAR-java-S6437": ["798"],
  "SONAR-java-S2115": ["521"],  // db password
};

// Regras candidatas: Java ou any, com regex real.
const regras = RULES.filter(
  (r) =>
    (r.languages.includes("java") || r.languages.includes("any")) &&
    r.pattern?.regex &&
    r.pattern.regex !== "(?!x)x",
);

// Anexa o CWE resolvido a cada regra (catálogo ou mapa).
const regrasComCwe = regras
  .map((r) => {
    const doCatalogo = (r.cwe ?? []).map((c) => c.replace(/^CWE-/, ""));
    const doMapa = CWE_POR_REGRA[r.id] ?? [];
    const cwes = [...new Set([...doCatalogo, ...doMapa])];
    return { rule: r, cwes };
  })
  .filter((x) => x.cwes.length > 0);

console.log(`Regras Java/any com regex: ${regras.length}; com CWE resolvido: ${regrasComCwe.length}`);

// Lê o gabarito.
const csv = readFileSync(join(BENCH, "expectedresults-1.2.csv"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#"));
const gabarito = new Map(); // name -> { categoria, real, cwe }
for (const l of csv) {
  const [name, categoria, real, cwe] = l.split(",");
  gabarito.set(name.trim(), { categoria: categoria.trim(), real: real.trim() === "true", cwe: cwe.trim() });
}

const arquivos = readdirSync(TESTCODE).filter((f) => f.endsWith(".java"));
console.log(`Casos no disco: ${arquivos.length}; gabarito: ${gabarito.size}\n`);

// Estatísticas por categoria.
const stats = new Map(); // categoria -> {tp,fp,tn,fn}
const stat = (cat) => {
  if (!stats.has(cat)) stats.set(cat, { tp: 0, fp: 0, tn: 0, fn: 0 });
  return stats.get(cat);
};

let processados = 0;
const inicio = Date.now();

for (const arq of arquivos) {
  const nome = arq.replace(/\.java$/, "");
  const g = gabarito.get(nome);
  if (!g) continue;
  const cweEsperado = g.cwe;
  const fonte = readFileSync(join(TESTCODE, arq), "utf8");
  const profile = lexicalProfileFor(arq);

  // CWEs que o CodeHero disparou neste arquivo.
  const disparados = new Set();
  for (const { rule, cwes } of regrasComCwe) {
    if (matchPattern(rule.pattern, fonte, { profile }).length > 0) {
      for (const c of cwes) disparados.add(c);
    }
  }

  const s = stat(g.categoria);
  const acertou = disparados.has(cweEsperado);
  if (g.real) {
    if (acertou) s.tp++; else s.fn++;
  } else {
    if (acertou) s.fp++; else s.tn++;
  }
  processados++;
}

const fmt = (n) => (n * 100).toFixed(1) + "%";
let tot = { tp: 0, fp: 0, tn: 0, fn: 0 };
console.log("categoria      |   TP |   FN |   FP |   TN | recall | precisão | F1");
console.log("---------------+------+------+------+------+--------+----------+------");
for (const [cat, s] of [...stats.entries()].sort()) {
  const recall = s.tp / (s.tp + s.fn || 1);
  const prec = s.tp / (s.tp + s.fp || 1);
  const f1 = (2 * prec * recall) / (prec + recall || 1);
  console.log(
    `${cat.padEnd(14)} | ${String(s.tp).padStart(4)} | ${String(s.fn).padStart(4)} | ${String(s.fp).padStart(4)} | ${String(s.tn).padStart(4)} | ${fmt(recall).padStart(6)} | ${fmt(prec).padStart(8)} | ${fmt(f1)}`,
  );
  tot.tp += s.tp; tot.fp += s.fp; tot.tn += s.tn; tot.fn += s.fn;
}
const recall = tot.tp / (tot.tp + tot.fn || 1);
const prec = tot.tp / (tot.tp + tot.fp || 1);
const f1 = (2 * prec * recall) / (prec + recall || 1);
console.log("---------------+------+------+------+------+--------+----------+------");
console.log(
  `${"TOTAL".padEnd(14)} | ${String(tot.tp).padStart(4)} | ${String(tot.fn).padStart(4)} | ${String(tot.fp).padStart(4)} | ${String(tot.tn).padStart(4)} | ${fmt(recall).padStart(6)} | ${fmt(prec).padStart(8)} | ${fmt(f1)}`,
);
console.log(`\n${processados} casos em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
