#!/usr/bin/env node
/**
 * Mede o scanner contra o OWASP BenchmarkJava e REPROVA se piorar.
 *
 * Por que isto e o item mais importante da lista
 * ---------------------------------------------------------------------------
 * Ate aqui toda mudanca de regra era feita no escuro. Alguem apertava um
 * detector para matar um falso positivo e nao tinha como saber quantos
 * verdadeiros positivos foram junto. O benchmark tem 2740 casos com gabarito e
 * roda em 24 segundos: e barato o bastante para rodar a cada commit, e caro o
 * bastante de ignorar.
 *
 * A partir daqui, mexer em regra sem olhar este numero e palpite.
 *
 * O que reprova, e por que cada limiar
 * ---------------------------------------------------------------------------
 *   PRECISAO TOTAL   nao pode cair. E o numero de ADOCAO: a um terco de
 *                    apontamentos errados o time para de abrir o relatorio, e
 *                    ai o recall nao vale nada. Tolerancia minima, so para
 *                    absorver arredondamento.
 *
 *   F1 TOTAL         nao pode cair mais que meio ponto. Absorve troca honesta
 *                    entre precisao e recall, barra degradacao real.
 *
 *   F1 POR CATEGORIA nao pode cair mais que dois pontos. O total esconde
 *                    regressao localizada: quebrar LDAP inteiro mal move a
 *                    media de 2740 casos.
 *
 * Subir e sempre permitido, e a linha de base se regrava de proposito, com
 * `--gravar`. Regravar tem de ser um ato deliberado que aparece no diff.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeSource } from "../packages/scanner/dist/engine.js";

const BENCH = ".tmp/benchmark-java";
const TESTCODE = join(BENCH, "src/main/java/org/owasp/benchmark/testcode");
const GABARITO = join(BENCH, "expectedresults-1.2.csv");
const LINHA_BASE = "benchmarks/owasp-baseline.json";

const EXIGE_ACERVO = process.argv.includes("--exige-acervo");
const GRAVAR = process.argv.includes("--gravar");

// Tolerancias em pontos percentuais.
const TOL_PRECISAO = 0.2;
const TOL_F1_TOTAL = 0.5;
const TOL_F1_CATEGORIA = 2.0;

/**
 * O catalogo SONAR ainda nao traz CWE em toda regra, entao o mapa explicito
 * completa. Quando o catalogo passar a trazer, este mapa encolhe sozinho.
 */
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
  "HERO-SEC-0090-ldap-injection-java": ["90"],
  "HERO-SEC-0643-xpath-injection-java": ["643"],
  "HERO-SEC-0501-trust-boundary-java": ["501"],
  "HERO-SEC-0327-weak-hash-java": ["327", "328"],
  "HERO-SEC-0614-insecure-cookie-java": ["614"],
};

function medir() {
  const csv = readFileSync(GABARITO, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const gabarito = new Map();
  for (const l of csv) {
    const [nome, categoria, real, cwe] = l.split(",");
    gabarito.set(nome.trim(), {
      categoria: categoria.trim(),
      real: real.trim() === "true",
      cwe: cwe.trim(),
    });
  }

  const arquivos = readdirSync(TESTCODE).filter((f) => f.endsWith(".java"));
  const stats = new Map();
  const stat = (c) => {
    if (!stats.has(c)) stats.set(c, { tp: 0, fp: 0, tn: 0, fn: 0 });
    return stats.get(c);
  };

  for (const arq of arquivos) {
    const g = gabarito.get(arq.replace(/\.java$/, ""));
    if (!g) continue;
    const fonte = readFileSync(join(TESTCODE, arq), "utf8");
    const disparados = new Set();
    for (const f of analyzeSource(arq, fonte)) {
      for (const c of (f.rule.cwe ?? []).map((x) => x.replace(/^CWE-/, ""))) disparados.add(c);
      for (const c of CWE_POR_REGRA[f.rule.id] ?? []) disparados.add(c);
    }
    const s = stat(g.categoria);
    const acertou = disparados.has(g.cwe);
    if (g.real) acertou ? s.tp++ : s.fn++;
    else acertou ? s.fp++ : s.tn++;
  }
  return { stats, casos: arquivos.length };
}

const pct = (n) => Number((n * 100).toFixed(1));
function indices(s) {
  const recall = s.tp / (s.tp + s.fn || 1);
  const precisao = s.tp / (s.tp + s.fp || 1);
  const f1 = (2 * precisao * recall) / (precisao + recall || 1);
  return { recall: pct(recall), precisao: pct(precisao), f1: pct(f1) };
}

// --- acervo presente? -------------------------------------------------------
if (!existsSync(TESTCODE) || !existsSync(GABARITO)) {
  const recado =
    `acervo do OWASP Benchmark ausente em ${BENCH}\n` +
    "  para medir localmente:\n" +
    "    git clone --depth 1 https://github.com/OWASP-Benchmark/BenchmarkJava.git .tmp/benchmark-java";
  if (EXIGE_ACERVO) {
    console.error(`reprovado: ${recado}`);
    console.error("  (o passo de CI usa --exige-acervo justamente para nao passar em silencio)");
    process.exit(1);
  }
  console.log(`pulando: ${recado}`);
  process.exit(0);
}

// --- mede -------------------------------------------------------------------
const inicio = Date.now();
const { stats, casos } = medir();

const porCategoria = {};
let tot = { tp: 0, fp: 0, tn: 0, fn: 0 };
for (const [cat, s] of [...stats.entries()].sort()) {
  porCategoria[cat] = { ...s, ...indices(s) };
  tot.tp += s.tp; tot.fp += s.fp; tot.tn += s.tn; tot.fn += s.fn;
}
const total = { ...tot, ...indices(tot) };
// Escore do proprio OWASP: taxa de verdadeiros menos taxa de falsos.
total.escoreOwasp = Number((total.recall - pct(tot.fp / (tot.fp + tot.tn || 1))).toFixed(1));

const atual = { casos, total, porCategoria };

console.log("categoria      |   TP |   FN |   FP |   TN | recall | precisão |     F1");
console.log("---------------+------+------+------+------+--------+----------+-------");
for (const [cat, m] of Object.entries(porCategoria)) {
  console.log(
    `${cat.padEnd(14)} | ${String(m.tp).padStart(4)} | ${String(m.fn).padStart(4)} | ` +
      `${String(m.fp).padStart(4)} | ${String(m.tn).padStart(4)} | ` +
      `${(m.recall + "%").padStart(6)} | ${(m.precisao + "%").padStart(8)} | ${(m.f1 + "%").padStart(6)}`,
  );
}
console.log("---------------+------+------+------+------+--------+----------+-------");
console.log(
  `${"TOTAL".padEnd(14)} | ${String(total.tp).padStart(4)} | ${String(total.fn).padStart(4)} | ` +
    `${String(total.fp).padStart(4)} | ${String(total.tn).padStart(4)} | ` +
    `${(total.recall + "%").padStart(6)} | ${(total.precisao + "%").padStart(8)} | ${(total.f1 + "%").padStart(6)}`,
);
console.log(`\nescore OWASP (verdadeiros menos falsos): ${total.escoreOwasp}`);
console.log(`${casos} casos em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

// --- grava a linha de base --------------------------------------------------
if (GRAVAR) {
  mkdirSync("benchmarks", { recursive: true });
  writeFileSync(
    LINHA_BASE,
    JSON.stringify(
      {
        _porque:
          "Linha de base do OWASP BenchmarkJava v1.2. Regravar e ato deliberado: " +
          "so faca depois de conferir que a mudanca de numero e melhoria, e diga no commit por que.",
        _medidoEm: new Date().toISOString().slice(0, 10),
        ...atual,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nlinha de base gravada: ${LINHA_BASE}`);
  process.exit(0);
}

// --- compara ----------------------------------------------------------------
if (!existsSync(LINHA_BASE)) {
  console.error(`\nsem linha de base. Grave a primeira com:  node ${process.argv[1]} --gravar`);
  process.exit(1);
}
const base = JSON.parse(readFileSync(LINHA_BASE, "utf8"));

const quedas = [];
const dPrec = atual.total.precisao - base.total.precisao;
const dF1 = atual.total.f1 - base.total.f1;

if (dPrec < -TOL_PRECISAO) {
  quedas.push(
    `precisão total caiu ${(-dPrec).toFixed(1)} ponto(s): ${base.total.precisao}% -> ${atual.total.precisao}%. ` +
      "É o número de adoção; queda aqui custa mais que ganho de recall.",
  );
}
if (dF1 < -TOL_F1_TOTAL) {
  quedas.push(`F1 total caiu ${(-dF1).toFixed(1)} ponto(s): ${base.total.f1}% -> ${atual.total.f1}%`);
}
for (const [cat, m] of Object.entries(porCategoria)) {
  const b = base.porCategoria?.[cat];
  if (!b) continue;
  const d = m.f1 - b.f1;
  if (d < -TOL_F1_CATEGORIA) {
    quedas.push(`F1 de ${cat} caiu ${(-d).toFixed(1)} ponto(s): ${b.f1}% -> ${m.f1}%`);
  }
}

const subiu = [];
if (dPrec > TOL_PRECISAO) subiu.push(`precisão +${dPrec.toFixed(1)}`);
if (dF1 > TOL_F1_TOTAL) subiu.push(`F1 +${dF1.toFixed(1)}`);

console.log("\n--- contra a linha de base ---");
console.log(`  precisão ${base.total.precisao}% -> ${atual.total.precisao}%  (${dPrec >= 0 ? "+" : ""}${dPrec.toFixed(1)})`);
console.log(`  F1       ${base.total.f1}% -> ${atual.total.f1}%  (${dF1 >= 0 ? "+" : ""}${dF1.toFixed(1)})`);

if (quedas.length) {
  console.error("\nREPROVADO:");
  for (const q of quedas) console.error(`  - ${q}`);
  console.error(
    "\nSe a queda for troca consciente, regrave a linha de base com --gravar e explique no commit.",
  );
  process.exit(1);
}
console.log(subiu.length ? `\nok, e melhorou: ${subiu.join(", ")}` : "\nok: sem regressão");
