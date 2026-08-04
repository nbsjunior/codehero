import { parseStructural } from "../dist/index.js";
import { sqlcodeNaoChecado } from "../dist/structural/cobolSqlcode.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const prog = (corpo) =>
  [
    "       IDENTIFICATION DIVISION.",
    "       PROGRAM-ID. PGM.",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01  WS-SALDO           PIC S9(9)V99 COMP-3.",
    "       01  WS-NUM             PIC 9(10).",
    "       PROCEDURE DIVISION.",
    ...corpo,
  ].join("\n");

async function achados(corpo) {
  const p = await parseStructural("PGM.cbl", prog(corpo));
  return sqlcodeNaoChecado(p.root);
}

console.log("=== o caso que a regra existe para pegar");
const semCheck = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL",
  "             SELECT SALDO INTO :WS-SALDO FROM CONTAS WHERE NUM = :WS-NUM",
  "           END-EXEC.",
  "           DISPLAY WS-SALDO.",
  "           STOP RUN.",
]);
console.log(`  SELECT sem checagem -> ${semCheck.length} achado(s): ${semCheck.map((a) => a.verbo).join(", ")}`);
check(semCheck.length === 1, `deveria achar 1, achou ${semCheck.length}`);
check(semCheck[0]?.verbo === "SELECT", `verbo ${semCheck[0]?.verbo}`);
check(semCheck[0]?.paragrafo === "MAIN-PARA", `paragrafo ${semCheck[0]?.paragrafo}`);

console.log("\n=== checagem INLINE logo depois");
const inline = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL",
  "             SELECT SALDO INTO :WS-SALDO FROM CONTAS",
  "           END-EXEC.",
  "           IF SQLCODE NOT = 0",
  "              DISPLAY 'ERRO'",
  "           END-IF.",
  "           STOP RUN.",
]);
console.log(`  IF SQLCODE depois -> ${inline.length} (deve ser 0)`);
check(inline.length === 0, `checagem inline conta, vieram ${inline.length}`);

console.log("\n=== checagem via PERFORM (interprocedural — o que separa a regra)");
const viaPerform = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL",
  "             SELECT SALDO INTO :WS-SALDO FROM CONTAS",
  "           END-EXEC.",
  "           PERFORM CHECK-SQL.",
  "           STOP RUN.",
  "       CHECK-SQL.",
  "           IF SQLCODE NOT = 0",
  "              DISPLAY 'ERRO SQL'",
  "           END-IF.",
]);
console.log(`  PERFORM p/ paragrafo que checa -> ${viaPerform.length} (deve ser 0)`);
check(viaPerform.length === 0, `PERFORM para paragrafo que checa conta, vieram ${viaPerform.length}`);

console.log("\n=== PERFORM para paragrafo que NAO checa nao vale");
const performFalso = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL",
  "             SELECT SALDO INTO :WS-SALDO FROM CONTAS",
  "           END-EXEC.",
  "           PERFORM GRAVA-LOG.",
  "           STOP RUN.",
  "       GRAVA-LOG.",
  "           DISPLAY 'LOG'.",
]);
console.log(`  PERFORM p/ paragrafo que NAO checa -> ${performFalso.length} (deve ser 1)`);
check(performFalso.length === 1, `confiar no nome seria adivinhacao, vieram ${performFalso.length}`);

console.log("\n=== PERFORM em cadeia (A performa B, B checa)");
const cadeia = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL",
  "             SELECT SALDO INTO :WS-SALDO FROM CONTAS",
  "           END-EXEC.",
  "           PERFORM TRATA.",
  "           STOP RUN.",
  "       TRATA.",
  "           PERFORM VERIFICA.",
  "       VERIFICA.",
  "           IF SQLCODE NOT = 0 DISPLAY 'X' END-IF.",
]);
console.log(`  cadeia de PERFORM -> ${cadeia.length} (deve ser 0)`);
check(cadeia.length === 0, `fecho transitivo tem de funcionar, vieram ${cadeia.length}`);

console.log("\n=== o que NAO executa SQL nao exige checagem");
for (const [nome, cmd] of [
  ["INCLUDE SQLCA", "INCLUDE SQLCA"],
  ["DECLARE CURSOR", "DECLARE C1 CURSOR FOR SELECT NUM FROM CONTAS"],
  ["BEGIN DECLARE SECTION", "BEGIN DECLARE SECTION"],
  ["WHENEVER", "WHENEVER SQLERROR CONTINUE"],
]) {
  const r = await achados([
    "       MAIN-PARA.",
    "           EXEC SQL",
    `             ${cmd}`,
    "           END-EXEC.",
    "           STOP RUN.",
  ]);
  console.log(`  ${nome.padEnd(24)} -> ${r.length} (deve ser 0)`);
  check(r.length === 0, `${nome} nao executa SQL, vieram ${r.length}`);
}

console.log("\n=== WHENEVER SQLERROR ativo cobre o que vem depois");
const whenever = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL",
  "             WHENEVER SQLERROR GO TO ERRO-PARA",
  "           END-EXEC.",
  "           EXEC SQL",
  "             SELECT SALDO INTO :WS-SALDO FROM CONTAS",
  "           END-EXEC.",
  "           STOP RUN.",
  "       ERRO-PARA.",
  "           DISPLAY 'ERRO'.",
]);
console.log(`  com WHENEVER SQLERROR GOTO -> ${whenever.length} (deve ser 0)`);
check(whenever.length === 0, `WHENEVER ativo cobre os seguintes, vieram ${whenever.length}`);

console.log("\n=== dois EXEC SQL seguidos: o primeiro fica sem checagem");
const dois = await achados([
  "       MAIN-PARA.",
  "           EXEC SQL SELECT A INTO :WS-NUM FROM T1 END-EXEC.",
  "           EXEC SQL SELECT B INTO :WS-NUM FROM T2 END-EXEC.",
  "           IF SQLCODE NOT = 0 DISPLAY 'X' END-IF.",
  "           STOP RUN.",
]);
console.log(`  dois seguidos, uma checagem -> ${dois.length} (deve ser 1)`);
check(dois.length === 1, `o primeiro ficou descoberto, vieram ${dois.length}`);

console.log("\n=== programa sem SQL nenhum");
const semSql = await achados(["       MAIN-PARA.", "           STOP RUN."]);
check(semSql.length === 0, "sem EXEC SQL, nenhum achado");
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
