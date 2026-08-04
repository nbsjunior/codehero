import { parseStructural } from "../dist/index.js";
import { camposDeclarados, tamanhoDoPic } from "../dist/structural/cobolData.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const FONTE = [
  "       IDENTIFICATION DIVISION.",
  "       PROGRAM-ID. PGM.",
  "       DATA DIVISION.",
  "       FILE SECTION.",
  "       FD  ARQ-CLI.",
  "       01  REG-CLI            PIC X(80).",
  "       WORKING-STORAGE SECTION.",
  "       01  WS-CONTA.",
  "           05  WS-NUM         PIC 9(10).",
  "           05  WS-SALDO       PIC S9(9)V99 COMP-3.",
  "           05  WS-STATUS      PIC X.",
  "               88  WS-ATIVO   VALUE 'A'.",
  "               88  WS-INATIVO VALUE 'I'.",
  "           05  WS-TAB         OCCURS 100 TIMES.",
  "               10  WS-ITEM    PIC X(20).",
  "           05  WS-ALT         REDEFINES WS-NUM PIC X(10).",
  "       01  WS-OUTRO           PIC 9(4) COMP.",
  "       77  WS-INDEP           PIC S9(4).",
  "       01  WS-QUEBRA",
  "           PIC X(30).",
  "       LINKAGE SECTION.",
  "       01  LK-PARM            PIC X(100).",
  "       PROCEDURE DIVISION.",
  "       MAIN-PARA.",
  "           STOP RUN.",
].join("\n");

console.log("=== a DATA DIVISION entra na arvore");
const p = await parseStructural("PGM.cbl", FONTE);
check(!!p, "tem de parsear");
const tipos = new Set();
const st = [p.root];
while (st.length) {
  const n = st.pop();
  tipos.add(n.type);
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c); }
}
for (const t of ["data_division", "working_storage_section", "linkage_section", "file_section", "data_item", "condition_name", "picture_clause", "occurs_clause", "redefines_clause"]) {
  const tem = tipos.has(t);
  console.log(`  ${t.padEnd(24)} ${tem ? "ok" : "AUSENTE"}`);
  check(tem, `nó ${t} tem de existir na árvore`);
}

console.log("\n=== campos achatados");
const campos = camposDeclarados(p.root.childForFieldName("data"));
console.log(`  ${campos.length} campo(s):`);
for (const c of campos) {
  console.log(
    `    ${String(c.nivel).padStart(2, "0")} ${c.nome.padEnd(12)} pic=${String(c.picture).padEnd(12)}` +
      ` usage=${String(c.usage).padEnd(7)} occurs=${String(c.occurs).padEnd(4)} redef=${String(c.redefines).padEnd(7)} ${c.secao}`,
  );
}
const por = (n) => campos.find((c) => c.nome === n);
check(!!por("WS-NUM"), "WS-NUM tem de existir");
check(por("WS-NUM").picture === "9(10)", `PIC de WS-NUM: ${por("WS-NUM")?.picture}`);
check(por("WS-SALDO").usage === "COMP-3", `USAGE de WS-SALDO: ${por("WS-SALDO")?.usage}`);
check(por("WS-TAB").occurs === "100", `OCCURS de WS-TAB: ${por("WS-TAB")?.occurs}`);
check(por("WS-ALT").redefines === "WS-NUM", `REDEFINES de WS-ALT: ${por("WS-ALT")?.redefines}`);
check(por("WS-ATIVO").nivel === 88, "88 tem de ser reconhecido");
check(por("WS-INDEP").nivel === 77, "77 tem de ser reconhecido");
check(por("LK-PARM").secao === "linkage_section", `LK-PARM na secao ${por("LK-PARM")?.secao}`);
check(por("REG-CLI").secao === "file_section", `REG-CLI na secao ${por("REG-CLI")?.secao}`);

console.log("\n=== hierarquia vem do NIVEL, nao da indentacao");
// WS-ITEM (10) e filho de WS-TAB (05); WS-OUTRO (01) reabre a arvore.
const div = p.root.childForFieldName("data");
const acha = (n, nome) => {
  const st2 = [n];
  while (st2.length) {
    const x = st2.pop();
    if (x.childForFieldName?.("name")?.text === nome) return x;
    for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) st2.push(c); }
  }
  return null;
};
const item = acha(div, "WS-ITEM");
console.log(`  WS-ITEM tem pai ${item?.parent?.childForFieldName("name")?.text}`);
check(item?.parent?.childForFieldName("name")?.text === "WS-TAB", "10 tem de ser filho do 05 anterior");
const outro = acha(div, "WS-OUTRO");
check(outro?.parent?.type === "working_storage_section", "01 reabre a arvore na secao");

console.log("\n=== declaracao quebrada em duas linhas");
check(por("WS-QUEBRA")?.picture === "X(30)", `PIC de WS-QUEBRA: ${por("WS-QUEBRA")?.picture} (a juncao de linhas tem de funcionar)`);
console.log("  ok");

console.log("\n=== tamanho do PIC (base da checagem host variable x coluna DB2)");
const casos = [
  ["9(10)", 10, 0, false],
  ["S9(9)V99", 11, 2, false],
  ["X(30)", 30, 0, true],
  ["9(4)", 4, 0, false],
  ["999V99", 5, 2, false],
  ["XXX", 3, 0, true],
];
for (const [pic, dig, dec, alfa] of casos) {
  const t = tamanhoDoPic(pic);
  const bom = t && t.digitos === dig && t.decimais === dec && t.alfanumerico === alfa;
  console.log(`  ${pic.padEnd(10)} -> ${t ? `${t.digitos} digito(s), ${t.decimais} decimal(is), ${t.alfanumerico ? "alfa" : "num"}` : "null"} ${bom ? "" : "  ERRO"}`);
  check(bom, `PIC ${pic}: esperado ${dig}/${dec}/${alfa}`);
}

console.log("\n=== copybook puro (sem PROCEDURE DIVISION) tem de render arvore");
const CPY = ["       01  CLI-REG.", "           05  CLI-NOME  PIC X(30)."].join("\n");
const pc = await parseStructural("CLI.cpy", CPY);
console.log(`  parseou: ${!!pc} | hasError: ${pc?.hasError}`);
// Sem DATA DIVISION explicita o copybook nao tem a secao; o importante e nao quebrar.
check(!!pc, "copybook tem de parsear sem quebrar");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
