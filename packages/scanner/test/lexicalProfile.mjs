import { analyzeSource, languageForFile } from "../dist/engine.js";

// ---------------------------------------------------------------------------
// O perfil lexico tem de vir do ARQUIVO, nao de um padrao fixo.
//
// Este teste existe por um defeito real: o scanner chamava
// `matchPattern(rule.pattern, source)` sem opcoes, entao a mascara caia em
// `clike` para TODA linguagem que nao e JS/TS — so elas passam pela rota de
// analise profunda, que ja construia a mascara certa. Resultado: `#` do
// Python, `--` do SQL e o `*` na coluna 7 do COBOL nunca eram reconhecidos
// como comentario, e o motor apontava defeito dentro de comentario.
//
// O repositorio do proprio CodeHero e quase todo TypeScript, entao a
// regressao NAO aparece no scan dele. Por isso este teste: e o unico lugar
// onde o defeito fica visivel.
// ---------------------------------------------------------------------------

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

/** Achados numa linha especifica (1-based). */
const naLinha = (achados, n) => achados.filter((f) => f.startLine === n);

console.log("=== extensoes de SQL PL chegam como db2sql");
for (const f of ["p.db2", "p.sqlpl", "p.spl"]) {
  const l = languageForFile(f);
  console.log(`  ${f} -> ${l}`);
  check(l === "db2sql", `${f} deveria mapear para db2sql`);
}

console.log("\n=== SQL: `--` e comentario, nao codigo");
const sql = [
  "-- executado por EXECUTE IMMEDIATE. Injecao classica, em DB2.",
  "EXECUTE IMMEDIATE V_SQL;",
].join("\n");
const aSql = analyzeSource("proc.db2", sql);
console.log(`  linha 1 (comentario): ${naLinha(aSql, 1).length} | linha 2 (codigo): ${naLinha(aSql, 2).length}`);
check(naLinha(aSql, 1).length === 0, "comentario SQL nao pode gerar achado");
check(naLinha(aSql, 2).length > 0, "o EXECUTE IMMEDIATE real tem de ser apontado");

console.log("\n=== Python: `#` e comentario");
const py = [
  "# cuidado: nunca use eval(entrada) aqui",
  "resultado = eval(entrada)",
].join("\n");
const aPy = analyzeSource("m.py", py);
console.log(`  linha 1 (comentario): ${naLinha(aPy, 1).length} | linha 2 (codigo): ${naLinha(aPy, 2).length}`);
check(naLinha(aPy, 1).length === 0, "comentario Python nao pode gerar achado");
check(naLinha(aPy, 2).length > 0, "o eval real tem de ser apontado");

console.log("\n=== COBOL formato fixo: `*` na coluna 7 comenta a linha inteira");
const cbl = [
  "      * este programa usa EXEC SQL sem checar SQLCODE, veja abaixo",
  "           EXEC SQL SELECT A INTO :WS-A FROM T END-EXEC.",
].join("\n");
const aCbl = analyzeSource("p.cbl", cbl);
console.log(`  linha 1 (comentario): ${naLinha(aCbl, 1).length} | linha 2 (codigo): ${naLinha(aCbl, 2).length}`);
check(naLinha(aCbl, 1).length === 0, "comentario COBOL de formato fixo nao pode gerar achado");

console.log("\n=== o perfil e mesmo o do arquivo, nao um fixo");
// A prova de que o perfil VARIA: em Python `#` comenta, em C-like nao. A mesma
// fonte, so trocando a extensao, tem de dar resultados DIFERENTES. Se derem o
// mesmo, o perfil voltou a ser fixo e as asserções acima viram decoracao.
const fonteHash = "# eval(entrada) citado aqui\nx = 1";
const comoPy = analyzeSource("m.py", fonteHash);
const comoJs = analyzeSource("m.js", fonteHash);
console.log(`  como .py: ${naLinha(comoPy, 1).length} | como .js: ${naLinha(comoJs, 1).length}`);
check(naLinha(comoPy, 1).length === 0, "em Python a linha 1 e comentario");
check(
  naLinha(comoJs, 1).length > naLinha(comoPy, 1).length,
  "em C-like `#` NAO comenta — os dois perfis tem de divergir",
);

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
