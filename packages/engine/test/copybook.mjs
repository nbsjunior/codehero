import { expandCopybooks, origemDaLinha } from "../dist/structural/copybook.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

/** Resolver de mentira: um mapa de nome -> fonte. */
const resolverDe = (mapa) => ({
  resolve(nome, lib) {
    const chave = lib ? `${lib}.${nome}` : nome;
    const src = mapa[chave] ?? mapa[nome];
    return src === undefined ? null : { path: `${nome}.cpy`, source: src };
  },
});

console.log("=== expansao basica e mapa de linhas");
const prog = [
  "       IDENTIFICATION DIVISION.",
  "       PROGRAM-ID. TESTE.",
  "       DATA DIVISION.",
  "       WORKING-STORAGE SECTION.",
  "       COPY CLIENTE.",
  "       01  WS-FIM  PIC X.",
].join("\n");
const cliente = [
  "       01  CLI-REG.",
  "           05  CLI-NOME  PIC X(30).",
  "           05  CLI-CPF   PIC 9(11).",
].join("\n");

const r1 = expandCopybooks(prog, { file: "PROG.cbl", resolver: resolverDe({ CLIENTE: cliente }) });
console.log(`  resolvidos: ${JSON.stringify(r1.resolved)} | ausentes: ${JSON.stringify(r1.missing)}`);
console.log(`  linhas: ${prog.split("\n").length} -> ${r1.source.split("\n").length} (${r1.expandedLines} vieram de copybook)`);
check(r1.resolved.length === 1, "CLIENTE tem de ser resolvido");
check(r1.missing.length === 0, "nao deveria faltar nenhum");
check(r1.source.includes("CLI-CPF"), "o conteudo do copybook tem de entrar no fonte");
check(!r1.source.includes("COPY CLIENTE"), "a linha COPY e substituida, nao mantida");
check(r1.expandedLines === 3, `3 linhas vindas do copybook, vieram ${r1.expandedLines}`);

// O MAPA e o que impede o achado de apontar para a linha errada.
const linhas = r1.source.split("\n");
const idxCpf = linhas.findIndex((l) => l.includes("CLI-CPF")) + 1;
const oCpf = origemDaLinha(r1, idxCpf);
console.log(`  CLI-CPF esta na linha ${idxCpf} do expandido -> ${oCpf.file}:${oCpf.line} (depth ${oCpf.depth})`);
check(oCpf.file === "CLIENTE.cpy", `origem tem de ser o copybook, veio ${oCpf.file}`);
check(oCpf.line === 3, `linha 3 do copybook, veio ${oCpf.line}`);

const idxFim = linhas.findIndex((l) => l.includes("WS-FIM")) + 1;
const oFim = origemDaLinha(r1, idxFim);
console.log(`  WS-FIM esta na linha ${idxFim} do expandido -> ${oFim.file}:${oFim.line}`);
check(oFim.file === "PROG.cbl", "linha do programa tem de mapear para o programa");
check(oFim.line === 6, `linha 6 do programa, veio ${oFim.line} (o deslocamento tem de ser desfeito)`);

console.log("\n=== COPY ausente NAO pode virar COPY limpo");
const r2 = expandCopybooks(prog, { file: "PROG.cbl", resolver: resolverDe({}) });
console.log(`  ausentes: ${JSON.stringify(r2.missing)}`);
check(r2.missing.includes("CLIENTE"), "copybook nao encontrado tem de entrar em missing");
check(r2.source.includes("COPY CLIENTE"), "a linha COPY fica visivel quando nao resolve");
check(r2.expandedLines === 0, "nada foi expandido");

console.log("\n=== REPLACING com pseudo-texto");
const generico = ["       01  :PFX:-REG.", "           05  :PFX:-ID  PIC 9(5)."].join("\n");
const progRep = "       COPY GENERICO REPLACING ==:PFX:== BY ==CLI==.";
const r3 = expandCopybooks(progRep, { file: "P.cbl", resolver: resolverDe({ GENERICO: generico }) });
console.log("  " + r3.source.split("\n").map((l) => l.trim()).join(" | "));
check(r3.source.includes("CLI-REG"), "==:PFX:== BY ==CLI== tem de trocar o prefixo");
check(!r3.source.includes(":PFX:"), "nenhum marcador pode sobrar");

console.log("\n=== REPLACING atravessando linhas");
const progML = [
  "       COPY GENERICO",
  "            REPLACING ==:PFX:== BY ==FOR==.",
].join("\n");
const r4 = expandCopybooks(progML, { file: "P.cbl", resolver: resolverDe({ GENERICO: generico }) });
check(r4.source.includes("FOR-REG"), `REPLACING multilinha tem de funcionar; saiu: ${r4.source.trim()}`);
console.log("  ok");

console.log("\n=== COPY aninhado (copybook que inclui copybook)");
const nivel2 = "       05  N2-CAMPO  PIC X.";
const nivel1 = ["       01  N1-REG.", "       COPY NIVEL2."].join("\n");
const r5 = expandCopybooks("       COPY NIVEL1.", {
  file: "P.cbl",
  resolver: resolverDe({ NIVEL1: nivel1, NIVEL2: nivel2 }),
});
console.log(`  resolvidos: ${JSON.stringify(r5.resolved)}`);
check(r5.source.includes("N2-CAMPO"), "COPY dentro de copybook tem de expandir");
const oN2 = origemDaLinha(r5, r5.source.split("\n").findIndex((l) => l.includes("N2-CAMPO")) + 1);
console.log(`  N2-CAMPO -> ${oN2.file}:${oN2.line} depth ${oN2.depth}`);
check(oN2.depth === 2, `profundidade 2 para COPY aninhado, veio ${oN2.depth}`);

console.log("\n=== ciclo NAO pode travar o parser");
const a = "       COPY CICLOB.";
const b = "       COPY CICLOA.";
const r6 = expandCopybooks("       COPY CICLOA.", {
  file: "P.cbl",
  resolver: resolverDe({ CICLOA: a, CICLOB: b }),
});
console.log(`  ciclos detectados: ${r6.cycles.length} -> ${r6.cycles[0] ?? ""}`);
check(r6.cycles.length > 0, "o ciclo tem de ser detectado, nao estourar a pilha");

console.log("\n=== COPY em linha de comentario e ignorado");
const comentado = ["      * COPY CLIENTE.", "       01 X PIC 9."].join("\n");
const r7 = expandCopybooks(comentado, { file: "P.cbl", resolver: resolverDe({ CLIENTE: cliente }) });
console.log(`  resolvidos: ${r7.resolved.length} (deve ser 0)`);
check(r7.resolved.length === 0, "COPY comentado nao expande");

console.log("\n=== programa sem COPY sai identico");
const puro = ["       01 A PIC X.", "       01 B PIC 9."].join("\n");
const r8 = expandCopybooks(puro, { file: "P.cbl", resolver: resolverDe({}) });
check(r8.source === puro, "fonte sem COPY nao pode ser alterado");
check(r8.origins.length === 2, "o mapa cobre todas as linhas");
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
