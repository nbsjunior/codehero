import { parseStructural } from "../dist/index.js";
import { camposMortos } from "../dist/structural/cobolDeadData.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const FONTE = [
  "       IDENTIFICATION DIVISION.",
  "       PROGRAM-ID. PGM.",
  "       DATA DIVISION.",
  "       WORKING-STORAGE SECTION.",
  "       01  WS-GRUPO.",
  "           05  WS-USADO       PIC 9(4).",
  "           05  WS-MORTO       PIC X(10).",
  "           05  FILLER         PIC X(5).",
  "       01  WS-NUM             PIC 9(8).",
  "       01  WS-ALT             REDEFINES WS-NUM PIC X(8).",
  "       01  WS-FLAG            PIC X.",
  "           88  WS-LIGADO      VALUE 'S'.",
  "       01  WS-ORFAO           PIC 9(2).",
  "       LINKAGE SECTION.",
  "       01  LK-ENTRADA         PIC X(50).",
  "       PROCEDURE DIVISION.",
  "       MAIN-PARA.",
  "           MOVE 10 TO WS-USADO.",
  "           IF WS-LIGADO",
  "              DISPLAY WS-USADO",
  "           END-IF.",
  "           STOP RUN.",
].join("\n");

console.log("=== campos mortos");
const p = await parseStructural("PGM.cbl", FONTE);
const mortos = camposMortos(p.root);
console.log("  " + mortos.map((m) => `${m.nome}(${m.linha + 1})`).join(", "));

const nomes = new Set(mortos.map((m) => m.nome));
check(nomes.has("WS-MORTO"), "WS-MORTO nunca e referenciado -> tem de aparecer");
check(nomes.has("WS-ORFAO"), "WS-ORFAO nunca e referenciado -> tem de aparecer");

console.log("\n=== o que NAO pode ser reportado (cada exclusao tem motivo)");
const naoDeve = [
  ["WS-USADO", "e usado em MOVE e DISPLAY"],
  ["WS-GRUPO", "grupo: usar o filho conta como usar o grupo"],
  ["FILLER", "preenchimento nao tem nome para referenciar"],
  ["WS-NUM", "e redefinido por WS-ALT: o acesso e pelo par"],
  ["WS-ALT", "tem REDEFINES: idem"],
  ["WS-FLAG", "o 88 WS-LIGADO e usado, entao o pai esta em uso"],
  ["LK-ENTRADA", "LINKAGE e interface: quem usa e quem chama"],
  ["WS-LIGADO", "88 nao e campo"],
];
for (const [nome, motivo] of naoDeve) {
  const errou = nomes.has(nome);
  console.log(`  ${errou ? "FALHA" : "ok   "} ${nome.padEnd(12)} ${motivo}`);
  check(!errou, `${nome} NAO pode ser dado morto (${motivo})`);
}

console.log("\n=== campo usado so dentro de copybook expandido conta como usado");
const COM_USO = FONTE.replace("           STOP RUN.", "           MOVE WS-MORTO TO WS-ORFAO.\n           STOP RUN.");
const p2 = await parseStructural("PGM.cbl", COM_USO);
const m2 = new Set(camposMortos(p2.root).map((m) => m.nome));
console.log(`  mortos agora: ${[...m2].join(", ") || "(nenhum)"}`);
check(!m2.has("WS-MORTO"), "WS-MORTO passou a ser usado");
check(!m2.has("WS-ORFAO"), "WS-ORFAO passou a ser usado");

console.log("\n=== programa sem DATA DIVISION nao quebra");
const semDados = ["       PROCEDURE DIVISION.", "       P.", "           STOP RUN."].join("\n");
const p3 = await parseStructural("X.cbl", semDados);
check(camposMortos(p3.root).length === 0, "sem dados, nenhum campo morto");
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
