import { analisarRotulos } from "../dist/index.js";

// ---------------------------------------------------------------------------
// O metodo tem de achar o rotulo que EU inverti de proposito. Se nao achar,
// nao serve; e se acusar todo mundo, tambem nao serve.
// ---------------------------------------------------------------------------

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const ex = (id, label, ruleId = "R") => ({ id, label, ruleId, features: {} });

console.log("=== rotulo invertido aparece no topo da fila ===");
// Nove exemplos coerentes: rotulo 1 com prob alta, rotulo 0 com prob baixa.
// E um decimo, o `envenenado`, rotulado 0 mas que o modelo ve como 1 com 96%.
const exemplos = [
  ex("a", 1), ex("b", 1), ex("c", 1), ex("d", 1),
  ex("e", 0), ex("f", 0), ex("g", 0), ex("h", 0),
  ex("envenenado", 0),
];
const probs = [0.93, 0.90, 0.88, 0.92, 0.06, 0.10, 0.08, 0.05, 0.96];

const q = analisarRotulos(exemplos, probs);
console.log(`  limiar: falso ${q.limiar.falso.toFixed(2)} | verdadeiro ${q.limiar.verdadeiro.toFixed(2)}`);
console.log(`  suspeitos: ${q.suspeitos.map((s) => s.id).join(", ") || "(nenhum)"}`);
check(q.suspeitos.length > 0, "com um rotulo claramente invertido tem de haver suspeito");
check(q.suspeitos[0]?.id === "envenenado", "o invertido tem de ser o PRIMEIRO da fila");
check(q.suspeitos[0]?.discordanciaConfiante === true, "e tem de ser discordancia confiante, nao so confianca baixa");

console.log("\n=== conjunto coerente nao produz acusacao ===");
const limpos = [ex("a", 1), ex("b", 1), ex("c", 1), ex("d", 0), ex("e", 0), ex("f", 0)];
const probsLimpas = [0.91, 0.88, 0.93, 0.07, 0.11, 0.05];
const qL = analisarRotulos(limpos, probsLimpas);
console.log(`  suspeitos: ${qL.suspeitos.length} | ruido: ${(qL.taxaDeRuido * 100).toFixed(1)}%`);
check(qL.suspeitos.length === 0, "sem rotulo errado nao pode haver suspeito");
check(qL.taxaDeRuido === 0, "taxa de ruido tem de ser zero num conjunto coerente");

console.log("\n=== o limiar acompanha a classe dificil ===");
// Classe 1 e sistematicamente dificil: o modelo so chega a 0,55 nela. Com
// limiar fixo de 0,5 metade viraria suspeita; com limiar por classe, nenhuma.
const dificil = [ex("a", 1), ex("b", 1), ex("c", 1), ex("d", 0), ex("e", 0), ex("f", 0)];
const probsDificeis = [0.56, 0.54, 0.58, 0.04, 0.06, 0.03];
const qD = analisarRotulos(dificil, probsDificeis);
console.log(`  limiar verdadeiro: ${qD.limiar.verdadeiro.toFixed(2)} (nao 0.50 fixo)`);
console.log(`  suspeitos: ${qD.suspeitos.length}`);
check(qD.limiar.verdadeiro < 0.6, "o limiar tem de descer junto com a dificuldade da classe");
check(qD.suspeitos.length === 0, "classe dificil mas coerente nao pode virar fila de revisao");

console.log("\n=== a matriz confiante conta o que promete ===");
const cj = q.conjuntoConfiante;
console.log(`  rotulado falso     -> [${cj.rotuladoFalso.join(", ")}]`);
console.log(`  rotulado verdadeiro-> [${cj.rotuladoVerdadeiro.join(", ")}]`);
check(cj.rotuladoFalso[1] >= 1, "o exemplo envenenado tem de cair fora da diagonal");
check(q.taxaDeRuido > 0, "com um fora da diagonal a taxa de ruido nao pode ser zero");

console.log("\n=== entrada incoerente falha alto, nao em silencio ===");
let lancou = false;
try {
  analisarRotulos([ex("a", 1)], [0.5, 0.5]);
} catch {
  lancou = true;
}
check(lancou, "quantidade de probabilidades diferente da de exemplos tem de lancar");
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
