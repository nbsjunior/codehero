import { parseStructural } from "../dist/index.js";
import { analisarDb2 } from "../dist/structural/cobolDb2.js";

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
  return analisarDb2(p.root);
}

const tipos = (a) => a.map((x) => x.tipo);

console.log("=== 1. truncamento: host variable menor que a coluna");
const trunc = await analisar(
  ["       01  WS-VALOR           PIC S9(4).", "       01  WS-NOME            PIC X(30)."],
  [
    "       MAIN-PARA.",
    "           EXEC SQL",
    "             DECLARE T1 TABLE (VALOR INTEGER, NOME CHAR(30))",
    "           END-EXEC.",
    "           EXEC SQL",
    "             SELECT VALOR INTO :WS-VALOR FROM T1",
    "           END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log("  " + (trunc.find((x) => x.tipo === "truncamento")?.detalhe ?? "(nada)"));
check(tipos(trunc).includes("truncamento"), "PIC S9(4) recebendo INTEGER (10 digitos) deve alertar");

console.log("\n=== truncamento NAO dispara quando cabe");
const cabe = await analisar(
  ["       01  WS-VALOR           PIC S9(12)."],
  [
    "       MAIN-PARA.",
    "           EXEC SQL",
    "             DECLARE T1 TABLE (VALOR INTEGER)",
    "           END-EXEC.",
    "           EXEC SQL",
    "             SELECT VALOR INTO :WS-VALOR FROM T1",
    "           END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  achados de truncamento: ${tipos(cabe).filter((t) => t === "truncamento").length} (deve ser 0)`);
check(!tipos(cabe).includes("truncamento"), "PIC S9(12) comporta INTEGER — nao pode alertar");

console.log("\n=== 2. cursor aberto e nunca fechado");
const semClose = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.",
    "           EXEC SQL OPEN C1 END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log("  " + (semClose.find((x) => x.tipo === "cursor-sem-close")?.detalhe ?? "(nada)"));
check(tipos(semClose).includes("cursor-sem-close"), "cursor sem CLOSE deve alertar");

const comClose = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.",
    "           EXEC SQL OPEN C1 END-EXEC.",
    "           EXEC SQL CLOSE C1 END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  com CLOSE -> ${tipos(comClose).filter((t) => t === "cursor-sem-close").length} (deve ser 0)`);
check(!tipos(comClose).includes("cursor-sem-close"), "cursor fechado nao pode alertar");

console.log("\n=== 3. EXEC SQL dentro de PERFORM (N+1 no mainframe)");
const emLaco = await analisar(
  ["       01  WS-I               PIC 9(4)."],
  [
    "       MAIN-PARA.",
    "           PERFORM UNTIL WS-I > 100",
    "             EXEC SQL",
    "               SELECT A INTO :WS-I FROM T WHERE K = :WS-I",
    "             END-EXEC",
    "           END-PERFORM.",
    "           STOP RUN.",
  ],
);
console.log("  " + (emLaco.find((x) => x.tipo === "sql-em-laco")?.detalhe ?? "(nada)"));
check(tipos(emLaco).includes("sql-em-laco"), "SELECT dentro de PERFORM deve alertar");

console.log("\n=== FETCH em laco NAO alerta — e a forma correta de consumir cursor");
const fetchLaco = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           PERFORM UNTIL SQLCODE = 100",
    "             EXEC SQL FETCH C1 INTO :WS-A END-EXEC",
    "           END-PERFORM.",
    "           STOP RUN.",
  ],
);
console.log(`  FETCH em laco -> ${tipos(fetchLaco).filter((t) => t === "sql-em-laco").length} (deve ser 0)`);
check(!tipos(fetchLaco).includes("sql-em-laco"), "FETCH em laco e o idioma CORRETO, nao pode alertar");

console.log("\n=== 4. COMMIT em laco com cursor sem WITH HOLD");
const commitRuim = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.",
    "           EXEC SQL OPEN C1 END-EXEC.",
    "           PERFORM UNTIL SQLCODE = 100",
    "             EXEC SQL FETCH C1 INTO :WS-A END-EXEC",
    "             EXEC SQL COMMIT END-EXEC",
    "           END-PERFORM.",
    "           EXEC SQL CLOSE C1 END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log("  " + (commitRuim.find((x) => x.tipo === "commit-em-cursor")?.detalhe ?? "(nada)"));
check(tipos(commitRuim).includes("commit-em-cursor"), "COMMIT em laco sem WITH HOLD deve alertar");

console.log("\n=== COMMIT com WITH HOLD NAO alerta");
const commitOk = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C1 CURSOR WITH HOLD FOR SELECT A FROM T END-EXEC.",
    "           EXEC SQL OPEN C1 END-EXEC.",
    "           PERFORM UNTIL SQLCODE = 100",
    "             EXEC SQL FETCH C1 INTO :WS-A END-EXEC",
    "             EXEC SQL COMMIT END-EXEC",
    "           END-PERFORM.",
    "           EXEC SQL CLOSE C1 END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  com WITH HOLD -> ${tipos(commitOk).filter((t) => t === "commit-em-cursor").length} (deve ser 0)`);
check(!tipos(commitOk).includes("commit-em-cursor"), "WITH HOLD sobrevive ao COMMIT — nao pode alertar");

console.log("\n=== programa sem SQL nao produz nada");
const semSql = await analisar([], ["       MAIN-PARA.", "           STOP RUN."]);
check(semSql.length === 0, `sem EXEC SQL nao ha achado, vieram ${semSql.length}`);
console.log("  ok");

console.log("\n=== COMMIT em laco NAO conta como N+1 — checkpoint e pratica de batch");
const commitNaoNMais1 = await analisar(
  [],
  [
    "       MAIN-PARA.",
    "           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.",
    "           EXEC SQL OPEN C1 END-EXEC.",
    "           PERFORM UNTIL SQLCODE = 100",
    "             EXEC SQL FETCH C1 INTO :WS-A END-EXEC",
    "             EXEC SQL COMMIT END-EXEC",
    "           END-PERFORM.",
    "           EXEC SQL CLOSE C1 END-EXEC.",
    "           STOP RUN.",
  ],
);
console.log(`  COMMIT em laco -> sql-em-laco: ${tipos(commitNaoNMais1).filter((t) => t === "sql-em-laco").length} (deve ser 0)`);
check(
  !tipos(commitNaoNMais1).includes("sql-em-laco"),
  "COMMIT nao e query; o risco real e reportado por commit-em-cursor",
);

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
