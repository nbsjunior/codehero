import { parseSqlplSource, parseStructural, structuralLanguageFor } from "../dist/index.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

function achata(n, out = []) {
  out.push(n);
  for (let i = 0; i < n.childCount; i++) achata(n.child(i), out);
  return out;
}
const doTipo = (r, t) => achata(r).filter((n) => n.type === t);
const chamadas = (r) =>
  doTipo(r, "call_statement").map((n) => n.childForFieldName("function")?.text);

console.log("=== extensoes reconhecidas");
for (const f of ["a.db2", "b.sqlpl", "c.spl"]) {
  const l = structuralLanguageFor(f);
  console.log(`  ${f} -> ${l}`);
  check(l === "sqlpl", `${f} deveria ser sqlpl`);
}
check(structuralLanguageFor("x.sql") === "tsql", ".sql continua em tsql");

console.log("\n=== procedure com corpo em bloco: nome, bloco e statements");
const proc = `--#SET TERMINATOR @
CREATE PROCEDURE ATUALIZA_SALDO (IN P_CONTA VARCHAR(20), OUT P_SALDO DECIMAL(11,2))
  LANGUAGE SQL
BEGIN
  DECLARE V_SQL VARCHAR(500);
  DECLARE C1 CURSOR FOR SELECT SALDO FROM CONTAS;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET P_SALDO = 0;
  SET V_SQL = 'SELECT SALDO FROM CONTAS WHERE ID = ' || P_CONTA;
  EXECUTE IMMEDIATE V_SQL;
END@
`;
const r1 = parseSqlplSource(proc);
const procs = doTipo(r1, "procedure_definition");
console.log(`  procedures: ${procs.length} nome=${procs[0]?.childForFieldName("name")?.text}`);
check(procs.length === 1, "deve achar 1 procedure");
check(procs[0]?.childForFieldName("name")?.text === "ATUALIZA_SALDO", "nome da procedure");
check(doTipo(r1, "cursor_declaration").length === 1, "cursor declarado deve virar no");
check(doTipo(r1, "handler_declaration").length === 1, "handler deve virar no");
console.log(`  chamadas: ${JSON.stringify(chamadas(r1))}`);
check(chamadas(r1).includes("EXECUTE IMMEDIATE"), "EXECUTE IMMEDIATE deve virar call_statement");

console.log("\n=== montagem com || fica visivel como binary_expression");
const bins = doTipo(r1, "binary_expression");
console.log(`  binary_expression: ${bins.length} (SET + o EXECUTE que consome a variavel)`);
check(bins.length === 2, "SET com || e o EXECUTE da variavel montada");

console.log("\n=== a ligacao montagem -> execucao: o argumento vira 'assembled'");
const argExec = doTipo(r1, "call_statement")
  .find((n) => n.childForFieldName("function")?.text === "EXECUTE IMMEDIATE")
  ?.childForFieldName("arguments")
  ?.child(0);
console.log(`  argumento do EXECUTE IMMEDIATE: ${argExec?.type}`);
check(
  argExec?.type === "binary_expression",
  "V_SQL foi montado com || antes; o argumento deve ser remendado, nao so 'nao literal'",
);

console.log("\n=== EXECUTE de variavel NAO montada nao e remendo");
const naoMontada = parseSqlplSource(`CREATE PROCEDURE P()
BEGIN
  DECLARE V_SQL VARCHAR(100);
  SET V_SQL = 'SELECT 1 FROM SYSIBM.SYSDUMMY1';
  EXECUTE IMMEDIATE V_SQL;
END@
`);
const argNM = doTipo(naoMontada, "call_statement")[0]?.childForFieldName("arguments")?.child(0);
console.log(`  argumento: ${argNM?.type} (deve ser identifier, nao binary_expression)`);
check(argNM?.type === "identifier", "sem || nao ha remendo — nao pode virar binary_expression");

console.log("\n=== o conjunto de variaveis montadas nao vaza entre rotinas");
const duas = parseSqlplSource(`CREATE PROCEDURE A()
BEGIN
  SET V_SQL = 'X' || P;
END@
CREATE PROCEDURE B()
BEGIN
  EXECUTE IMMEDIATE V_SQL;
END@
`);
const argB = doTipo(duas, "call_statement")[0]?.childForFieldName("arguments")?.child(0);
console.log(`  argumento em B: ${argB?.type} (deve ser identifier)`);
check(argB?.type === "identifier", "montagem na procedure A nao diz nada sobre a B");

console.log("\n=== SET sem concatenacao NAO vira binary_expression");
const semConcat = parseSqlplSource(`CREATE PROCEDURE P()
BEGIN
  SET V = 10;
END@
`);
console.log(`  binary_expression: ${doTipo(semConcat, "binary_expression").length} (deve ser 0)`);
check(doTipo(semConcat, "binary_expression").length === 0, "SET simples nao e montagem de SQL");

console.log("\n=== END IF / END WHILE nao fecham o bloco composto");
const ninho = `CREATE PROCEDURE P()
BEGIN
  DECLARE V INT;
  WHILE V < 10 DO
    IF V = 5 THEN
      SET V = V + 1;
    END IF;
  END WHILE;
  EXECUTE IMMEDIATE 'COMMIT';
END@
`;
const r2 = parseSqlplSource(ninho);
console.log(`  while=${doTipo(r2, "while_statement").length} if=${doTipo(r2, "if_statement").length}`);
check(doTipo(r2, "while_statement").length === 1, "deve achar 1 WHILE");
check(doTipo(r2, "if_statement").length === 1, "deve achar 1 IF");
// Se END IF tivesse fechado o bloco, o EXECUTE cairia fora da procedure.
const execDentro = doTipo(r2, "call_statement").some((n) => {
  let p = n.parent;
  while (p) { if (p.type === "procedure_definition") return true; p = p.parent; }
  return false;
});
console.log(`  EXECUTE ficou dentro da procedure: ${execDentro}`);
check(execDentro, "END IF nao pode ter fechado a procedure");

console.log("\n=== numeracao de linha sobrevive ao corpo numa unica sentenca");
// Sem `;` no fim das linhas internas o corpo inteiro vira UMA sentenca; o
// deslocamento de linha precisa ser preservado mesmo assim.
const umaSentenca = `-- cabecalho
-- outra linha
CREATE PROCEDURE Q() BEGIN
  EXECUTE IMMEDIATE V_X;
END@
`;
const r3 = parseSqlplSource(umaSentenca);
const c3 = doTipo(r3, "call_statement")[0];
console.log(`  EXECUTE na linha ${c3?.startPosition.row} (0-based; esperado 3)`);
check(c3 !== undefined, "deve achar o EXECUTE IMMEDIATE");
check(c3?.startPosition.row === 3, `linha errada: ${c3?.startPosition.row}`);

console.log("\n=== literal string nao e confundido com comentario nem terminador");
const literais = parseSqlplSource(`CREATE PROCEDURE R()
BEGIN
  SET V = 'nao -- e comentario; nem @ terminador';
  EXECUTE IMMEDIATE 'SELECT 1';
END@
`);
const c4 = doTipo(literais, "call_statement");
console.log(`  chamadas: ${c4.length} arg=${c4[0]?.childForFieldName("arguments")?.child(0)?.type}`);
check(c4.length === 1, "o literal com -- e @ nao pode partir a analise");
check(
  c4[0]?.childForFieldName("arguments")?.child(0)?.type === "string_literal",
  "EXECUTE IMMEDIATE de literal deve ser string_literal, nao identifier",
);

console.log("\n=== parseStructural roteia .db2 para o parser certo");
const p5 = await parseStructural("proc.db2", proc);
console.log(`  language=${p5?.language} parseError=${p5?.root.hasError?.() ?? false}`);
check(p5?.language === "sqlpl", ".db2 deve chegar como sqlpl");
check(doTipo(p5.root, "procedure_definition").length === 1, "procedure via parseStructural");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
