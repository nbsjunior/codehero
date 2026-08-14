// Juliet Java (NIST) — avaliação por CWE nos módulos baixados.
// Metodologia: cada teste tem bad() (vulnerável) e good*() (seguro).
// TP = finding do CWE esperado em linha dentro de bad()
// FP = finding do CWE esperado só em good*() (sem bad)
// FN = bad() sem finding do CWE
// TN = não aplicável por arquivo (cada arquivo tem bad)
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeSource } from "../../scanner/dist/engine.js";

const ROOT = ".tmp/juliet-java";
const OUT = ".tmp/juliet-results";
mkdirSync(OUT, { recursive: true });

const MODULOS = [
  { dir: "juliet-cwe89", cwe: "89", nome: "sqli" },
  { dir: "juliet-cwe78", cwe: "78", nome: "cmdi" },
  { dir: "juliet-cwe80", cwe: "79", nome: "xss" }, // CWE-80 é XSS (variante de 79)
  { dir: "juliet-cwe23", cwe: "22", nome: "path-rel" },
  { dir: "juliet-cwe36", cwe: "22", nome: "path-abs" },
  { dir: "juliet-cwe90", cwe: "90", nome: "ldapi" },
  { dir: "juliet-cwe643", cwe: "643", nome: "xpathi" },
];

const CWE_POR_REGRA = {
  "HERO-SEC-0089-jdbc-sqli": ["89"],
  "HERO-SEC-0078-cmd-injection-java": ["78"],
  "HERO-SEC-0022-path-traversal-java": ["22"],
  "HERO-SEC-0079-xss-java": ["79"],
  "HERO-SEC-0090-ldap-injection-java": ["90"],
  "HERO-SEC-0643-xpath-injection-java": ["643"],
  "SONAR-java-S2076": ["78"], "SONAR-java-S2083": ["22"], "SONAR-java-S2078": ["90"],
  "SONAR-java-S2091": ["643"], "SONAR-java-S5131": ["79"],
};

function listJava(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".java") && !e.name.startsWith("Main") && !e.name.startsWith("ServletMain")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Intervalos [start,end] de métodos bad/good por nome. */
function metodos(fonte) {
  const linhas = fonte.split(/\r?\n/);
  const ranges = { bad: [], good: [] };
  let atual = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const m = /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:void|[\w.<>,\[\]\s]+)\s+(bad|good\w*)\s*\(/.exec(l);
    if (m && depth === 0) {
      atual = m[1].startsWith("bad") ? "bad" : "good";
      start = i + 1;
      depth = 0;
    }
    if (atual) {
      for (const c of l) {
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            ranges[atual].push([start, i + 1]);
            atual = null;
          }
        }
      }
    }
  }
  return ranges;
}

function cwesDoFinding(f) {
  const doCat = (f.rule.cwe ?? []).map((c) => c.replace(/^CWE-/, ""));
  const doMap = CWE_POR_REGRA[f.rule.id] ?? [];
  return [...new Set([...doCat, ...doMap])];
}

const resumo = [];
console.log("cwe  | nome      | arquivos | TP   | FN   | FP   | recall | precisão | F1");
console.log("-----+-----------+----------+------+------+------+--------+----------+------");

for (const mod of MODULOS) {
  const base = join(ROOT, mod.dir);
  const arquivos = listJava(base);
  // Amostra se muito grande (mantém custo razoável)
  const amostra = arquivos.length > 400
    ? arquivos.filter((_, i) => i % Math.ceil(arquivos.length / 400) === 0).slice(0, 400)
    : arquivos;

  let tp = 0, fn = 0, fp = 0;
  for (const arq of amostra) {
    const fonte = readFileSync(arq, "utf8");
    const ranges = metodos(fonte);
    if (!ranges.bad.length) continue; // skip helpers
    const findings = analyzeSource(arq, fonte).filter((f) => cwesDoFinding(f).includes(mod.cwe));
    const emBad = findings.some((f) => ranges.bad.some(([a, b]) => f.startLine >= a && f.startLine <= b));
    const emGood = findings.some((f) => ranges.good.some(([a, b]) => f.startLine >= a && f.startLine <= b));
    if (emBad) tp++;
    else fn++;
    if (emGood && !emBad) fp++; // finding só no good = FP clássico
    else if (emGood && emBad) {
      // finding em ambos — conta um FP parcial? conservador: não conta FP extra
    }
  }
  const recall = tp / (tp + fn || 1);
  const prec = tp / (tp + fp || 1);
  const f1 = (2 * prec * recall) / (prec + recall || 1);
  console.log(
    `${mod.cwe.padEnd(4)} | ${mod.nome.padEnd(9)} | ${String(amostra.length).padStart(8)} | ${String(tp).padStart(4)} | ${String(fn).padStart(4)} | ${String(fp).padStart(4)} | ${(recall * 100).toFixed(1).padStart(6)}% | ${(prec * 100).toFixed(1).padStart(8)}% | ${(f1 * 100).toFixed(1)}%`,
  );
  resumo.push({ ...mod, amostrados: amostra.length, total: arquivos.length, tp, fn, fp, recall, prec, f1 });
}

const tot = resumo.reduce((a, r) => ({ tp: a.tp + r.tp, fn: a.fn + r.fn, fp: a.fp + r.fp }), { tp: 0, fn: 0, fp: 0 });
const recall = tot.tp / (tot.tp + tot.fn || 1);
const prec = tot.tp / (tot.tp + tot.fp || 1);
const f1 = (2 * prec * recall) / (prec + recall || 1);
console.log("-----+-----------+----------+------+------+------+--------+----------+------");
console.log(`TOTAL          |          | ${String(tot.tp).padStart(4)} | ${String(tot.fn).padStart(4)} | ${String(tot.fp).padStart(4)} | ${(recall * 100).toFixed(1).padStart(6)}% | ${(prec * 100).toFixed(1).padStart(8)}% | ${(f1 * 100).toFixed(1)}%`);

writeFileSync(join(OUT, "resultados.json"), JSON.stringify({
  geradoEm: new Date().toISOString(),
  metodologia: "finding do CWE em linha dentro de bad() = TP; só em good() = FP",
  modulos: resumo,
  total: { ...tot, recall, prec, f1 },
}, null, 2));
console.log("\ngravado:", join(OUT, "resultados.json"));
