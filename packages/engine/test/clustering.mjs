import { parseStructural } from "../dist/index.js";
import { extractPathContexts, vectorize, vectorizeFile } from "../dist/structural/pathContexts.js";
import { kmeans, detectarAnomalias, paresSimilares } from "../dist/structural/clustering.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

console.log("=== path-contexts sao DETERMINISTICOS");
const src = `function soma(a, b) { let t = 0; for (const x of a) { t = t + x; } return t + b; }`;
const p1 = await parseStructural("a.js", src);
const p2 = await parseStructural("a.js", src);
const c1 = extractPathContexts(p1.root);
const c2 = extractPathContexts(p2.root);
console.log(`  ${c1.length} caminho(s) extraidos`);
check(c1.length > 0, "tem de extrair algum caminho");
check(JSON.stringify(c1) === JSON.stringify(c2), "mesma entrada tem de dar exatamente os mesmos caminhos");
const v1 = vectorize(c1);
const v2 = vectorize(c2);
check(v1.every((x, i) => x === v2[i]), "o vetor tem de ser identico entre execucoes");

console.log("\n=== vetor normalizado: tamanho nao pode virar distancia");
const curto = vectorize(extractPathContexts((await parseStructural("b.js", "function f(a){return a;}")).root));
const longo = vectorize(extractPathContexts((await parseStructural("c.js",
  "function g(a,b,c,d){let x=a+b;let y=c+d;let z=x*y;return z+a+b+c+d;}")).root));
const norma = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
console.log(`  norma curto=${norma(curto).toFixed(3)} longo=${norma(longo).toFixed(3)}`);
check(Math.abs(norma(curto) - 1) < 1e-9, "vetor tem de ser unitario");
check(Math.abs(norma(longo) - 1) < 1e-9, "vetor tem de ser unitario independente do tamanho");

console.log("\n=== literais nao explodem o vocabulario");
const a42 = vectorize(extractPathContexts((await parseStructural("d.js", "function f(){return 42;}")).root));
const a43 = vectorize(extractPathContexts((await parseStructural("e.js", "function f(){return 43;}")).root));
check(a42.every((x, i) => x === a43[i]), "42 e 43 nao podem gerar vetores diferentes");
console.log("  ok — numeros viram <NUM>");

console.log("\n=== K-Means e reproduzivel (o gate nao pode oscilar)");
const pts = [];
for (let i = 0; i < 30; i++) {
  const v = new Float64Array(8);
  const grupo = i % 3;
  v[grupo] = 1;
  v[(grupo + 3) % 8] = 0.5;
  v[7] = i / 100;
  pts.push(v);
}
const r1 = kmeans(pts, 3);
const r2 = kmeans(pts, 3);
console.log(`  iteracoes=${r1.iteracoes} | tamanhos=${r1.clusters.map((c) => c.membros.length).join(",")}`);
check(JSON.stringify(r1.atribuicao) === JSON.stringify(r2.atribuicao), "duas execucoes tem de dar a MESMA atribuicao");
check(r1.clusters.length === 3, "tem de formar 3 grupos");
// A ordem de entrada nao pode mudar o AGRUPAMENTO (so os rotulos).
const invertido = kmeans([...pts].reverse(), 3);
const tam1 = r1.clusters.map((c) => c.membros.length).sort().join(",");
const tam2 = invertido.clusters.map((c) => c.membros.length).sort().join(",");
console.log(`  tamanhos normal=${tam1} invertido=${tam2}`);
check(tam1 === tam2, "a particao tem de ser estavel a ordem de entrada");

console.log("\n=== anomalia: a funcao ESTRANHA tem de aparecer");
const fake = (nome, v, linha) => ({ file: "x.js", name: nome, startLine: linha, endLine: linha + 3, vector: v, contexts: 10 });
const familia = [];
for (let i = 0; i < 14; i++) {
  const v = new Float64Array(8);
  v[0] = 1; v[1] = 0.5 + i / 1000;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  familia.push(fake(`normal${i}`, v.map((x) => x / n), i * 5));
}
const estranha = new Float64Array(8);
estranha[6] = 1; estranha[7] = 1;
const ne = Math.sqrt(2);
familia.push(fake("ESTRANHA", estranha.map((x) => x / ne), 999));

const anomalias = detectarAnomalias(familia, { zMin: 1.5 });
console.log(`  anomalias: ${anomalias.map((a) => `${a.fn.name}(z=${a.zscore.toFixed(2)})`).join(", ") || "(nenhuma)"}`);
check(anomalias.length > 0, "a funcao destoante tem de ser detectada");
check(anomalias[0].fn.name === "ESTRANHA", `a mais atipica tem de ser a ESTRANHA, veio ${anomalias[0]?.fn.name}`);

console.log("\n=== acervo pequeno demais nao gera anomalia (nao ha distribuicao)");
check(detectarAnomalias(familia.slice(0, 5)).length === 0, "com 5 unidades nao da para dizer o que e atipico");
console.log("  ok");

console.log("\n=== par similar que o hash de forma NAO pegaria");
// Mesmo algoritmo, escrito diferente: for-of vs for classico.
const forOf = "function somaA(xs){let t=0;for(const x of xs){t=t+x;}return t;}";
const forI = "function somaB(ys){let s=0;for(let i=0;i<ys.length;i++){s=s+ys[i];}return s;}";
const vs = [
  ...vectorizeFile(await parseStructural("f1.js", forOf), "f1.js"),
  ...vectorizeFile(await parseStructural("f2.js", forI), "f2.js"),
  ...vectorizeFile(await parseStructural("f3.js", "function nada(){return null;}"), "f3.js"),
];
console.log(`  ${vs.length} funcao(oes) vetorizada(s): ${vs.map((v) => v.name).join(", ")}`);
check(vs.length >= 2, "as funcoes tem de ser vetorizadas");
const pares = paresSimilares(vs, { minSimilaridade: 0.3 });
console.log(`  pares: ${pares.map((x) => `${x.a.name}~${x.b.name}=${x.similaridade.toFixed(2)}`).join(", ") || "(nenhum)"}`);
// Nao exigimos que casem — exigimos que a comparacao rode e seja ordenada.
check(pares.every((x, i) => i === 0 || pares[i - 1].similaridade >= x.similaridade), "pares tem de vir ordenados");

console.log("\n=== arquivo sem funcao nao quebra");
const vazio = vectorizeFile(await parseStructural("g.js", "const x = 1;"), "g.js");
check(Array.isArray(vazio), "tem de devolver lista");
console.log(`  ${vazio.length} funcao(oes)`);

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
