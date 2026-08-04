import { buildLexicalMask, lexicalProfileFor, matchPattern } from "../dist/index.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

// A máscara tem de preservar posição: mesmo tamanho, mesmas quebras de linha.
// Sem isso, linha e coluna do achado saem erradas.
function checaGeometria(src, m, rotulo) {
  for (const [nome, v] of Object.entries(m)) {
    check(v.length === src.length, `${rotulo}/${nome}: tamanho ${v.length} != ${src.length}`);
    check(
      v.split("\n").length === src.split("\n").length,
      `${rotulo}/${nome}: numero de linhas mudou`,
    );
  }
}

console.log("=== C-like");
const js = [
  'const a = "senha123";',
  "// TODO: trocar a senha123",
  "foo(); /* nota com senha123 */ bar();",
  "const t = `template ${x} senha123`;",
  'const esc = "aspas \\" dentro";',
].join("\n");
const mjs = buildLexicalMask(js, "clike");
checaGeometria(js, mjs, "clike");
console.log("  code:     " + JSON.stringify(mjs.code.split("\n")[0]));
console.log("  comments: " + JSON.stringify(mjs.comments.split("\n")[1]));
console.log("  strings:  " + JSON.stringify(mjs.strings.split("\n")[0]));
check(!mjs.code.includes("senha123"), "code nao pode conter texto de string/comentario");
check(mjs.comments.includes("TODO"), "comments tem de conter o TODO");
check(mjs.strings.includes("senha123"), "strings tem de conter o literal");
// Código na mesma linha do comentário sobrevive.
check(mjs.code.split("\n")[2].includes("foo()"), "codigo antes do bloco tem de sobreviver");
check(mjs.code.split("\n")[2].includes("bar()"), "codigo depois do bloco tem de sobreviver");
check(!mjs.code.split("\n")[2].includes("nota"), "conteudo do bloco nao pode vazar para code");
// Escape: a aspa escapada NAO fecha a string.
check(!mjs.code.includes("dentro"), "aspa escapada nao pode encerrar a string");

console.log("\n=== Python (aspas triplas e #)");
const py = ['s = """', "senha no docstring", '"""', "# comentario", "x = 'literal'"].join("\n");
const mpy = buildLexicalMask(py, "python");
checaGeometria(py, mpy, "python");
check(!mpy.code.includes("senha"), "docstring nao e codigo");
check(mpy.strings.includes("senha"), "docstring conta como string");
check(mpy.comments.includes("comentario"), "# e comentario");

console.log("\n=== SQL (-- e '' escapando)");
const sql = ["SELECT 'a''b' AS x -- nota", "WHERE y = 1"].join("\n");
const msql = buildLexicalMask(sql, "sql");
checaGeometria(sql, msql, "sql");
check(msql.code.includes("SELECT"), "SELECT e codigo");
check(!msql.code.includes("nota"), "-- inicia comentario");
check(msql.code.includes("WHERE y = 1"), "aspa dobrada nao pode vazar a string para a linha seguinte");

console.log("\n=== COBOL (formato fixo: indicador na coluna 7)");
const cbl = ["      * linha toda comentada", "       MOVE A TO B.", "      *> inline"].join("\n");
const mcbl = buildLexicalMask(cbl, "cobol");
checaGeometria(cbl, mcbl, "cobol");
check(!mcbl.code.includes("comentada"), "asterisco na coluna 7 comenta a linha");
check(mcbl.code.includes("MOVE A TO B"), "linha de codigo COBOL tem de sobreviver");

console.log("\n=== VB.NET (aspa simples comenta)");
const vb = ["Dim s As String = \"x\" ' nota", "Dim y = 2"].join("\n");
const mvb = buildLexicalMask(vb, "vbnet");
check(!mvb.code.includes("nota"), "aspa simples comenta em VB");
check(mvb.code.includes("Dim y = 2"), "codigo VB seguinte sobrevive");

console.log("\n=== perfil por extensao");
for (const [f, esp] of [["a.ts", "clike"], ["a.py", "python"], ["a.sql", "sql"], ["a.cbl", "cobol"], ["a.vb", "vbnet"], ["a.desconhecido", "clike"]]) {
  const got = lexicalProfileFor(f);
  check(got === esp, `${f} -> esperado ${esp}, veio ${got}`);
}
console.log("  ok");

console.log("\n=== matchPattern honra o escopo");
const fonte = ['const x = 1; // TODO: arrumar', 'const s = "TODO no literal";', "// eslint-disable"].join("\n");
const casos = [
  ["code (padrao)", {}, 0],
  ["comments", { scope: "comments" }, 1],
  ["strings", { scope: "strings" }, 1],
  ["any", { scope: "any" }, 2],
];
for (const [nome, extra, esperado] of casos) {
  const r = matchPattern({ regex: "TODO", ...extra }, fonte, { profile: "clike" });
  console.log(`  ${nome.padEnd(14)} -> ${r.length} (esperado ${esperado})`);
  check(r.length === esperado, `${nome}: esperado ${esperado}, veio ${r.length}`);
}

// O snippet vem da linha CRUA, nao da mascarada: o relatorio mostra o codigo real.
const snip = matchPattern({ regex: "TODO", scope: "comments" }, fonte, { profile: "clike" });
console.log("  snippet: " + JSON.stringify(snip[0].snippet));
check(snip[0].snippet.includes("const x = 1"), "snippet tem de ser a linha original inteira");
check(snip[0].line === 1, "linha tem de ser 1");

// TRAVA: mascarar nao pode CRIAR achado. Apagar as aspas junto com o conteudo
// fez `import { x } from "mod";` virar `import { x } from        ;`, e a regra
// de import sem `from` disparou 490 vezes no repo. A aspa e sintaxe.
console.log("\n=== mascara nao pode criar achado (aspas sao sintaxe)");
const imp = 'import { readFileSync } from "node:fs";';
const mimp = buildLexicalMask(imp, "clike");
console.log("  code: " + JSON.stringify(mimp.code));
check(mimp.code.includes('"'), "as aspas tem de sobreviver em code");
check(!mimp.code.includes("node:fs"), "o conteudo da string tem de sumir");
const importSemFrom = { regex: "(?i)^\\s*import\\s+[\\w.{*}\\s,]+;\\s*$" };
const r1 = matchPattern(importSemFrom, imp, { profile: "clike" });
console.log(`  regra "import sem from" -> ${r1.length} (deve ser 0)`);
check(r1.length === 0, `import com from NAO pode casar, veio ${r1.length}`);
// e o caso legitimo continua casando
const r2 = matchPattern(importSemFrom, "import polyfill;", { profile: "clike" });
check(r2.length === 1, `import sem from DEVE casar, veio ${r2.length}`);

console.log("\n=== arquivo sem comentario/string nao muda nada");
const puro = "function f(a, b) {\n  return a + b;\n}\n";
const mp = buildLexicalMask(puro, "clike");
check(mp.code === puro, "codigo puro tem de sair identico");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
