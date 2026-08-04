import { scoreFinding, extractFeatures, trainRanker, accuracy, FEATURE_NAMES, DEFAULT_MODEL }
  from "../dist/index.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

console.log("=== o modelo semente precisa SEPARAR");
// TRAVA: com learningRate 0.2 aplicado a priors nao ajustados, a faixa inteira
// cabia em 0,06 — `dist/bundle.js` dava 0.579 contra 0.641 de um CRITICAL em
// producao. Ordenar ainda funcionava; qualquer limiar, nao. E e o numero
// absoluto que vai para o SARIF.
const casos = {
  producaoCritico: { ruleId: "R", file: "src/pagamento.ts", severity: "CRITICAL" },
  producaoInfo: { ruleId: "R", file: "src/pagamento.ts", severity: "INFO" },
  teste: { ruleId: "R", file: "src/pagamento.test.ts", severity: "CRITICAL" },
  dist: { ruleId: "R", file: "dist/bundle.js", severity: "CRITICAL" },
};
const s = Object.fromEntries(
  Object.entries(casos).map(([k, v]) => [k, scoreFinding(DEFAULT_MODEL, v).assertiveness]),
);
for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(18)} ${v.toFixed(3)}`);
const faixa = Math.max(...Object.values(s)) - Math.min(...Object.values(s));
console.log(`  faixa: ${faixa.toFixed(3)}`);
check(faixa > 0.2, `a faixa tem de ser utilizavel para limiar, veio ${faixa.toFixed(3)}`);
check(s.producaoCritico > s.teste, "producao tem de pontuar acima de arquivo de teste");
check(s.teste > s.dist, "teste tem de pontuar acima de dist/");
check(s.producaoCritico > s.producaoInfo, "severidade maior = mais assertivo");

console.log("\n=== todo atributo do vetor tem de existir");
const v = extractFeatures({ ruleId: "R", file: "a.ts", severity: "MAJOR" });
for (const f of FEATURE_NAMES) check(typeof v[f] === "number", `atributo ${f} ausente`);
console.log(`  ${FEATURE_NAMES.length} atributos, todos numericos`);

console.log("\n=== atributos que o scanner passou a informar movem o score");
// Sem stump para eles, os atributos eram calculados e nao mudavam nada: 196
// achados do repo cabiam em 2 valores distintos.
const simples = scoreFinding(DEFAULT_MODEL, { ruleId: "R", file: "src/a.ts", severity: "MAJOR", cognitive: 1, nesting: 1, fileChurn: 0 });
const complexo = scoreFinding(DEFAULT_MODEL, { ruleId: "R", file: "src/a.ts", severity: "MAJOR", cognitive: 20, nesting: 5, fileChurn: 30 });
console.log(`  funcao trivial e arquivo parado -> ${simples.assertiveness.toFixed(3)}`);
console.log(`  funcao complexa e arquivo quente -> ${complexo.assertiveness.toFixed(3)}`);
check(complexo.assertiveness > simples.assertiveness, "complexidade e churn tem de mover o score");

console.log("\n=== determinismo");
const a1 = scoreFinding(DEFAULT_MODEL, casos.producaoCritico).assertiveness;
const a2 = scoreFinding(DEFAULT_MODEL, casos.producaoCritico).assertiveness;
check(a1 === a2, "mesma entrada tem de dar exatamente a mesma saida");
console.log(`  ${a1} === ${a2}`);

console.log("\n=== o treinador aprende e e reproduzivel");
const rng = (() => { let x = 7; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
const ex = [];
for (let i = 0; i < 400; i++) {
  const teste = rng() < 0.3;
  const file = teste ? "src/x.test.ts" : "src/x.ts";
  ex.push({ id: String(i), features: extractFeatures({ ruleId: "R", file, severity: "MAJOR" }), label: teste ? 0 : 1 });
}
const m1 = trainRanker(ex, { rounds: 20, version: "t" });
const m2 = trainRanker(ex, { rounds: 20, version: "t" });
console.log(`  acuracia treinado: ${accuracy(m1, ex).toFixed(3)} | stumps: ${m1.stumps.length}`);
check(accuracy(m1, ex) > 0.9, "com sinal limpo o treinador tem de acertar");
check(JSON.stringify(m1.stumps) === JSON.stringify(m2.stumps), "treinar 2x tem de dar o mesmo modelo");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
