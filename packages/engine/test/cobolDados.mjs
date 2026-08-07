import { parseStructural } from "../dist/index.js";
import { analisarDados } from "../dist/structural/cobolDados.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const prog = (dados, proc) =>
  [
    "       IDENTIFICATION DIVISION.",
    "       PROGRAM-ID. PGM.",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    ...dados,
    "       PROCEDURE DIVISION.",
    ...proc,
  ].join("\n");

async function analisar(dados, proc) {
  const p = await parseStructural("PGM.cbl", prog(dados, proc));
  return analisarDados(p.root);
}
const tipos = (a) => a.map((x) => x.tipo);
const doTipo = (a, t) => a.filter((x) => x.tipo === t);

console.log("=== 1. MOVE numerico que nao cabe ===");
const trunca = await analisar(
  ["       01  WS-GRANDE          PIC 9(9).", "       01  WS-PEQUENO         PIC 9(4)."],
  ["       MAIN-PARA.", "           MOVE WS-GRANDE TO WS-PEQUENO.", "           STOP RUN."],
);
console.log("  " + (doTipo(trunca, "move-trunca")[0]?.detalhe ?? "(nada)"));
check(tipos(trunca).includes("move-trunca"), "9(9) para 9(4) deve apontar");
check(
  /mais significativos/i.test(doTipo(trunca, "move-trunca")[0]?.detalhe ?? ""),
  "a mensagem precisa dizer que o corte e nos digitos da FRENTE, que e o que muda a ordem de grandeza",
);

console.log("\n=== MOVE que cabe NAO aponta ===");
const cabe = await analisar(
  ["       01  WS-PEQUENO         PIC 9(4).", "       01  WS-GRANDE         PIC 9(9)."],
  ["       MAIN-PARA.", "           MOVE WS-PEQUENO TO WS-GRANDE.", "           STOP RUN."],
);
console.log(`  achados: ${doTipo(cabe, "move-trunca").length} (deve ser 0)`);
check(doTipo(cabe, "move-trunca").length === 0, "destino maior que a origem nao trunca");

console.log("\n=== MOVE de mesmo tamanho NAO aponta ===");
const igual = await analisar(
  ["       01  WS-A               PIC X(10).", "       01  WS-B               PIC X(10)."],
  ["       MAIN-PARA.", "           MOVE WS-A TO WS-B.", "           STOP RUN."],
);
check(doTipo(igual, "move-trunca").length === 0, "tamanhos iguais nao truncam");
console.log("  ok");

console.log("\n=== MOVE para varios destinos avalia cada um ===");
const varios = await analisar(
  [
    "       01  WS-ORIG            PIC 9(8).",
    "       01  WS-OK              PIC 9(8).",
    "       01  WS-CURTO           PIC 9(3).",
  ],
  ["       MAIN-PARA.", "           MOVE WS-ORIG TO WS-OK WS-CURTO.", "           STOP RUN."],
);
console.log(`  apontou ${doTipo(varios, "move-trunca").length} destino(s) problematico(s)`);
check(doTipo(varios, "move-trunca").length === 1, "so o destino curto deve ser apontado");
check(
  (doTipo(varios, "move-trunca")[0]?.detalhe ?? "").includes("WS-CURTO"),
  "o apontamento tem de nomear QUAL destino",
);

console.log("\n=== 2. alfanumerico movido para numerico ===");
const classe = await analisar(
  ["       01  WS-TEXTO           PIC X(10).", "       01  WS-NUM             PIC 9(10)."],
  ["       MAIN-PARA.", "           MOVE WS-TEXTO TO WS-NUM.", "           STOP RUN."],
);
console.log("  " + (doTipo(classe, "move-alfa-para-num")[0]?.detalhe ?? "(nada)"));
check(tipos(classe).includes("move-alfa-para-num"), "X(10) para 9(10) deve apontar");
check(
  doTipo(classe, "move-trunca").length === 0,
  "classes diferentes sao tratadas na analise propria, nao contadas duas vezes",
);

console.log("\n=== numerico para alfanumerico NAO aponta (e conversao normal) ===");
const numParaAlfa = await analisar(
  ["       01  WS-NUM             PIC 9(6).", "       01  WS-TEXTO           PIC X(6)."],
  ["       MAIN-PARA.", "           MOVE WS-NUM TO WS-TEXTO.", "           STOP RUN."],
);
check(doTipo(numParaAlfa, "move-alfa-para-num").length === 0, "numero para texto e uso normal");
console.log("  ok");

console.log("\n=== 3. coluna que aceita nulo sem indicador ===");
const semInd = await analisar(
  ["       01  WS-NOME            PIC X(30)."],
  [
    "       MAIN-PARA.",
    "           EXEC SQL",
    "             DECLARE T1 TABLE (ID INTEGER NOT NULL, NOME CHAR(30))",
    "           END-EXEC.",
    "           EXEC SQL",
    "             SELECT NOME INTO :WS-NOME FROM T1",
    "           END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log("  " + (doTipo(semInd, "indicador-nulo-ausente")[0]?.detalhe ?? "(nada)"));
check(tipos(semInd).includes("indicador-nulo-ausente"), "coluna sem NOT NULL exige indicador");

console.log("\n=== com indicador NAO aponta ===");
const comInd = await analisar(
  ["       01  WS-NOME            PIC X(30).", "       01  WS-NOME-IND        PIC S9(4) COMP."],
  [
    "       MAIN-PARA.",
    "           EXEC SQL",
    "             DECLARE T1 TABLE (NOME CHAR(30))",
    "           END-EXEC.",
    "           EXEC SQL",
    "             SELECT NOME INTO :WS-NOME:WS-NOME-IND FROM T1",
    "           END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  achados: ${doTipo(comInd, "indicador-nulo-ausente").length} (deve ser 0)`);
check(doTipo(comInd, "indicador-nulo-ausente").length === 0, "com indicador nao ha o que apontar");

console.log("\n=== coluna NOT NULL NAO exige indicador ===");
const notNull = await analisar(
  ["       01  WS-ID              PIC S9(9) COMP."],
  [
    "       MAIN-PARA.",
    "           EXEC SQL",
    "             DECLARE T1 TABLE (ID INTEGER NOT NULL)",
    "           END-EXEC.",
    "           EXEC SQL",
    "             SELECT ID INTO :WS-ID FROM T1",
    "           END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  achados: ${doTipo(notNull, "indicador-nulo-ausente").length} (deve ser 0)`);
check(doTipo(notNull, "indicador-nulo-ausente").length === 0, "NOT NULL dispensa indicador");

console.log("\n=== 4. cursor declarado e nunca aberto ===");
const cursorMorto = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C-VELHO CURSOR FOR SELECT A FROM T END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log("  " + (doTipo(cursorMorto, "cursor-nunca-usado")[0]?.detalhe ?? "(nada)"));
check(tipos(cursorMorto).includes("cursor-nunca-usado"), "cursor sem OPEN deve ser apontado");

const cursorVivo = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.",
    "           EXEC SQL OPEN C1 END-EXEC.",
    "           EXEC SQL CLOSE C1 END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  cursor usado -> ${doTipo(cursorVivo, "cursor-nunca-usado").length} (deve ser 0)`);
check(doTipo(cursorVivo, "cursor-nunca-usado").length === 0, "cursor aberto nao e morto");

console.log("\n=== programa sem nada disso nao produz achado ===");
const limpo = await analisar(
  ["       01  WS-A               PIC 9(4)."],
  ["       MAIN-PARA.", "           ADD 1 TO WS-A.", "           STOP RUN."],
);
check(limpo.length === 0, `esperava 0, vieram ${limpo.length}: ${tipos(limpo).join(",")}`);
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
