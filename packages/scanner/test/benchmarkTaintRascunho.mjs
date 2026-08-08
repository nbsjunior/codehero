// Mede o ganho de um rastreador de variável simples (sem parser) no benchmark.
// Estratégia: para cada arquivo, (1) achar variáveis atribuídas com concatenação,
// (2) achar sinks que recebem essas variáveis. Cobre o padrão de 2 linhas que
// derrubou o recall de 100% dos casos para 0%.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BENCH = ".tmp/benchmark-java/src/main/java/org/owasp/benchmark/testcode";
const csv = readFileSync(".tmp/benchmark-java/expectedresults-1.2.csv", "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const gabarito = new Map();
for (const l of csv) {
  const [name, categoria, real, cwe] = l.split(",");
  gabarito.set(name.trim(), { categoria: categoria.trim(), real: real.trim() === "true", cwe: cwe.trim() });
}

// Atribuição: Tipo? var = "..." + algo  OU  var = algo + "..."
const ATRIB = /(?:String|char\[\]|byte\[\])?\s*(\w+)\s*=\s*[^;]*\+/;
const SINKS = {
  sqli: /(executeQuery|executeUpdate|execute|prepareCall|prepareStatement|createStatement)\s*\(\s*(\w+)/,
  cmdi: /(exec|execSync|Runtime\.getRuntime\(\)\.exec|ProcessBuilder)\s*\(\s*(\w+)/,
  pathtraver: /(new\s+File|FileInputStream|FileOutputStream|Files\.(read|write|newInputStream)|Paths\.get)\s*\(\s*(\w+)/,
};

// Fontes de input no benchmark: param, request.getParameter, etc.
const FONTE = /(getParameter|getQueryString|getHeader|getCookies|getReader|getInputStream|param\b|\binput\b|request\.)/i;

function detecta(fonte, sinkRe) {
  const linhas = fonte.split("\n");
  // var -> true se recebeu valor de FONTE (request.getParameter etc) OU concatenação com tainted
  const tainted = new Set();
  for (const l of linhas) {
    // fonte direta: String p = request.getParameter("x")
    const atrib = /(?:[\w<>\[\]]+\s+)?(\w+)\s*=\s*(.+);/.exec(l);
    if (atrib) {
      const [, v, rhs] = atrib;
      if (FONTE.test(rhs)) tainted.add(v);
      // propagação: rhs referencia var tainted
      for (const t of tainted) if (new RegExp("\\b" + t + "\\b").test(rhs)) { tainted.add(v); break; }
      // concatenação com qualquer coisa tainted ou de fonte
      if (/\+/.test(rhs) && (FONTE.test(rhs) || [...tainted].some((t) => rhs.includes(t)))) tainted.add(v);
    }
  }
  for (const l of linhas) {
    const s = sinkRe.exec(l);
    if (!s) continue;
    if (tainted.has(s[2])) return true;
    if (/\+/.test(l) && FONTE.test(l)) return true; // sink com concatenação de fonte inline
  }
  return false;
}

const cats = ["sqli", "cmdi", "pathtraver"];
const stats = {};
for (const c of cats) stats[c] = { tp: 0, fp: 0, tn: 0, fn: 0 };

for (const [nome, g] of gabarito) {
  if (!cats.includes(g.categoria)) continue;
  const fonte = readFileSync(join(BENCH, nome + ".java"), "utf8");
  const hit = detecta(fonte, SINKS[g.categoria]);
  const s = stats[g.categoria];
  if (g.real) { if (hit) s.tp++; else s.fn++; }
  else { if (hit) s.fp++; else s.tn++; }
}

for (const c of cats) {
  const s = stats[c];
  const rec = s.tp / (s.tp + s.fn || 1), prec = s.tp / (s.tp + s.fp || 1);
  const f1 = (2 * prec * rec) / (prec + rec || 1);
  console.log(`${c.padEnd(12)} recall ${(100 * rec).toFixed(1)}%  precisão ${(100 * prec).toFixed(1)}%  F1 ${(100 * f1).toFixed(1)}%  (tp${s.tp} fn${s.fn} fp${s.fp} tn${s.tn})`);
}
