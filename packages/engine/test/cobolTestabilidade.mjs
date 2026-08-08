import { parseStructural } from "../dist/index.js";
import { analisarTestabilidade } from "../dist/structural/cobolTestabilidade.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const prog = (proc) =>
  [
    "       IDENTIFICATION DIVISION.",
    "       PROGRAM-ID. PGM.",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01  WS-A               PIC 9(9).",
    "       01  WS-B               PIC 9(9).",
    "       PROCEDURE DIVISION.",
    ...proc,
  ].join("\n");

async function analisar(proc) {
  const p = await parseStructural("PGM.cbl", prog(proc));
  return analisarTestabilidade(p.root);
}
const doTipo = (a, t) => a.filter((x) => x.tipo === t);

console.log("=== 1. paragrafo que mistura calculo com dependencia externa ===");
const misturado = await analisar([
  "       CALCULA-E-GRAVA.",
  "           EXEC SQL SELECT A INTO :WS-A FROM T END-EXEC.",
  "           COMPUTE WS-B = WS-A * 12.",
  "           IF WS-B > 1000",
  "             COMPUTE WS-B = WS-B - 100",
  "           END-IF.",
  "           MOVE WS-B TO WS-A.",
  "           CALL 'GRAVADOR' USING WS-B.",
  "           DISPLAY 'FEITO'.",
  "       FIM.",
  "           STOP RUN.",
]);
console.log("  " + (doTipo(misturado, "paragrafo-intestavel")[0]?.detalhe.slice(0, 110) ?? "(nada)"));
check(doTipo(misturado, "paragrafo-intestavel").length === 1, "calculo + SQL + CALL + DISPLAY deve apontar");

console.log("\n=== paragrafo so de entrada e saida NAO aponta ===");
const soIo = await analisar([
  "       GRAVA-TUDO.",
  "           WRITE REGISTRO-A.",
  "           WRITE REGISTRO-B.",
  "           WRITE REGISTRO-C.",
  "           WRITE REGISTRO-D.",
  "       FIM.",
  "           STOP RUN.",
]);
console.log(`  achados: ${doTipo(soIo, "paragrafo-intestavel").length} (deve ser 0)`);
check(
  doTipo(soIo, "paragrafo-intestavel").length === 0,
  "paragrafo cuja funcao E falar com o mundo nao pode ser acusado de intestavel",
);

console.log("\n=== paragrafo so de calculo NAO aponta ===");
const soCalculo = await analisar([
  "       CALCULA.",
  "           COMPUTE WS-B = WS-A * 12.",
  "           COMPUTE WS-B = WS-B + 5.",
  "           IF WS-B > 100",
  "             MOVE 100 TO WS-B",
  "           END-IF.",
  "           MOVE WS-B TO WS-A.",
  "       FIM.",
  "           STOP RUN.",
]);
console.log(`  achados: ${doTipo(soCalculo, "paragrafo-intestavel").length} (deve ser 0)`);
check(doTipo(soCalculo, "paragrafo-intestavel").length === 0, "calculo puro e o caso FACIL de testar");

console.log("\n=== uma so natureza de dependencia NAO aponta ===");
const umaNatureza = await analisar([
  "       LE-E-CALCULA.",
  "           READ ARQUIVO-A.",
  "           READ ARQUIVO-B.",
  "           COMPUTE WS-B = WS-A * 2.",
  "           IF WS-B > 10",
  "             MOVE 10 TO WS-B",
  "           END-IF.",
  "           MOVE WS-B TO WS-A.",
  "       FIM.",
  "           STOP RUN.",
]);
console.log(`  achados: ${doTipo(umaNatureza, "paragrafo-intestavel").length} (deve ser 0)`);
check(
  doTipo(umaNatureza, "paragrafo-intestavel").length === 0,
  "ler arquivo e contar e o idioma normal do batch; so vira problema com varias naturezas",
);

console.log("\n=== 2. PERFORM THRU sobre intervalo largo ===");
const thruLargo = await analisar([
  "       MAIN-PARA.",
  "           PERFORM P-INICIO THRU P-FIM.",
  "           STOP RUN.",
  "       P-INICIO.",
  "           MOVE 1 TO WS-A.",
  "       P-MEIO-UM.",
  "           MOVE 2 TO WS-A.",
  "       P-MEIO-DOIS.",
  "           MOVE 3 TO WS-A.",
  "       P-MEIO-TRES.",
  "           MOVE 4 TO WS-A.",
  "       P-FIM.",
  "           MOVE 5 TO WS-A.",
]);
console.log("  " + (doTipo(thruLargo, "perform-thru-fragil")[0]?.detalhe.slice(0, 120) ?? "(nada)"));
check(doTipo(thruLargo, "perform-thru-fragil").length === 1, "intervalo com 3 no meio deve apontar");
check(
  /P-MEIO-UM/.test(doTipo(thruLargo, "perform-thru-fragil")[0]?.detalhe ?? ""),
  "o apontamento tem de NOMEAR os paragrafos que executam pelo meio",
);

console.log("\n=== PERFORM THRU curto NAO aponta ===");
const thruCurto = await analisar([
  "       MAIN-PARA.",
  "           PERFORM P-A THRU P-B.",
  "           STOP RUN.",
  "       P-A.",
  "           MOVE 1 TO WS-A.",
  "       P-B.",
  "           MOVE 2 TO WS-A.",
]);
console.log(`  achados: ${doTipo(thruCurto, "perform-thru-fragil").length} (deve ser 0)`);
check(doTipo(thruCurto, "perform-thru-fragil").length === 0, "THRU e idioma legitimo; so o intervalo LARGO preocupa");

console.log("\n=== PERFORM simples NAO aponta ===");
const simples = await analisar([
  "       MAIN-PARA.",
  "           PERFORM P-A.",
  "           STOP RUN.",
  "       P-A.",
  "           MOVE 1 TO WS-A.",
]);
check(simples.length === 0, `PERFORM sem THRU nao tem intervalo, vieram ${simples.length}`);
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
