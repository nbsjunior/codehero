import {
  halsteadDe,
  indiceManutenibilidade,
  faixaManutenibilidade,
  parseStructural,
  computeFileMetrics,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Indice de Manutenibilidade: a formula e a unidade em que ela e aplicada.
//
// O risco aqui nao e o calculo errado, e o calculo CERTO na unidade errada. A
// formula tem um termo `16.2 * ln(LOC)`, e aplicada ao arquivo inteiro ela
// mede tamanho de arquivo disfarcado de manutenibilidade: todo arquivo grande
// da zero, inclusive um bem organizado em funcoes pequenas.
//
// Por isso o teste que mais importa aqui e o de UNIDADE: dois arquivos com
// exatamente as mesmas funcoes, um deles com o dobro de funcoes, precisam ter
// indices parecidos — porque a dificuldade de manter cada funcao nao mudou.
// ---------------------------------------------------------------------------

let falhas = 0;
const check = (ok, msg, detalhe = "") => {
  if (!ok) {
    falhas++;
    console.log("  FALHA: " + msg + (detalhe ? "  " + detalhe : ""));
  }
};

console.log("=== a formula bate com o calculo a mao");
{
  // 171 - 5.2*ln(1000) - 0.23*10 - 16.2*ln(100) = 58.18 ; *100/171 = 34.0
  const mi = indiceManutenibilidade(1000, 10, 100);
  check(Math.abs(mi - 34.0) < 0.2, "MI(V=1000, G=10, LOC=100) deveria ser ~34.0", `veio ${mi}`);
}

console.log("=== o piso em zero existe e nao vira negativo");
{
  const mi = indiceManutenibilidade(500000, 400, 5000);
  check(mi === 0, "codigo absurdo deveria dar 0, nunca negativo", `veio ${mi}`);
  check(mi >= 0, "MI nunca pode ser negativo");
}

console.log("=== cada termo empurra para o lado certo");
{
  const base = indiceManutenibilidade(1000, 10, 100);
  check(indiceManutenibilidade(2000, 10, 100) < base, "mais volume deveria BAIXAR o indice");
  check(indiceManutenibilidade(1000, 40, 100) < base, "mais complexidade deveria BAIXAR o indice");
  check(indiceManutenibilidade(1000, 10, 400) < base, "mais linhas deveria BAIXAR o indice");
  check(indiceManutenibilidade(500, 2, 30) > base, "codigo menor e simples deveria SUBIR o indice");
}

console.log("=== as faixas seguem a convencao do mercado");
{
  check(faixaManutenibilidade(5) === "ruim", "abaixo de 10 e ruim");
  check(faixaManutenibilidade(15) === "atencao", "entre 10 e 20 e atencao");
  check(faixaManutenibilidade(45) === "boa", "acima de 20 e boa");
  check(faixaManutenibilidade(9.9) === "ruim", "o limite de 10 e exclusivo embaixo");
  check(faixaManutenibilidade(20) === "boa", "20 ja e boa");
}

console.log("=== Halstead separa operador de operando");
{
  const src = `function soma(a, b) { return a + b; }`;
  const p = await parseStructural("x.ts", src);
  check(!!p, "parseou");
  const h = halsteadDe(p.root);
  // `a`, `b`, `soma` sao operandos; `function`, `+`, `return`, `=` sao operadores.
  check(h.operandos > 0, "deveria contar operandos", `${h.operandos}`);
  check(h.operadores > 0, "deveria contar operadores", `${h.operadores}`);
  check(h.operandosDistintos <= h.operandos, "distintos nao pode passar do total");
  check(h.operadoresDistintos <= h.operadores, "distintos nao pode passar do total");
  check(h.volume > 0, "volume deveria ser positivo", `${h.volume}`);
}

console.log("=== codigo mais complicado tem volume MAIOR");
{
  const simples = await parseStructural("a.ts", `function f(a) { return a; }`);
  const complexo = await parseStructural(
    "b.ts",
    `function g(a, b, c) { if (a > b && b < c) { return a * b - c / 2; } return (a + b) % c; }`,
  );
  const vs = halsteadDe(simples.root).volume;
  const vc = halsteadDe(complexo.root).volume;
  check(vc > vs, "volume deveria crescer com a complexidade", `${vc} vs ${vs}`);
}

console.log("=== A UNIDADE: arquivo maior com as MESMAS funcoes nao pode despencar");
{
  // Este e o teste que justifica calcular por funcao. Se o MI fosse do
  // arquivo, dobrar a quantidade de funcoes identicas derrubaria o indice —
  // e isso seria medir tamanho, nao manutenibilidade.
  const uma = `function f1(a, b) { if (a > b) { return a; } return b; }`;
  const src1 = uma;
  const src8 = Array.from({ length: 8 }, (_, i) => uma.replace("f1", `f${i + 1}`)).join("\n");

  const p1 = await parseStructural("um.ts", src1);
  const p8 = await parseStructural("oito.ts", src8);
  const m1 = computeFileMetrics("um.ts", src1, p1);
  const m8 = computeFileMetrics("oito.ts", src8, p8);

  check(m1.functions.length === 1, "o primeiro tem 1 funcao", `${m1.functions.length}`);
  check(m8.functions.length === 8, "o segundo tem 8 funcoes", `${m8.functions.length}`);
  check(
    Math.abs(m1.maintainabilityIndex - m8.maintainabilityIndex) < 5,
    "oito copias da MESMA funcao deveriam dar indice parecido",
    `${m1.maintainabilityIndex} vs ${m8.maintainabilityIndex}`,
  );
  // E a prova de que a unidade importa: o calculo direto no arquivo grande
  // despenca, apesar de o codigo ser identico funcao a funcao.
  const diretoNoArquivo = indiceManutenibilidade(m8.halsteadVolume, m8.cyclomatic, m8.linesOfCode);
  check(
    diretoNoArquivo < m8.maintainabilityIndex - 10,
    "o calculo por ARQUIVO deveria ser bem pior, e e por isso que ele nao e usado",
    `arquivo=${diretoNoArquivo} vs funcao=${m8.maintainabilityIndex}`,
  );
}

console.log("=== arquivo sem funcao nenhuma ainda tem indice");
{
  const src = `export const TABELA = { a: 1, b: 2, c: 3 };`;
  const p = await parseStructural("dados.ts", src);
  const m = computeFileMetrics("dados.ts", src, p);
  check(m.functions.length === 0, "sem funcoes", `${m.functions.length}`);
  check(m.maintainabilityIndex > 0, "dado puro deveria ter indice alto, nao zero", `${m.maintainabilityIndex}`);
}

console.log("=== deterministico");
{
  const src = `function f(a, b) { return a > b ? a : b; }`;
  const p = await parseStructural("d.ts", src);
  const um = computeFileMetrics("d.ts", src, p);
  const dois = computeFileMetrics("d.ts", src, p);
  check(um.maintainabilityIndex === dois.maintainabilityIndex, "duas medicoes, mesmo indice");
  check(um.halsteadVolume === dois.halsteadVolume, "duas medicoes, mesmo volume");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nok: manutenibilidade");
// `process.exitCode` e nao `process.exit()`: o WASM do tree-sitter ainda tem
// handle aberto, e sair a forca derruba o libuv com
// `!(handle->flags & UV_HANDLE_CLOSING)` e codigo 127 — que reprovaria a CI
// com o teste inteiro verde.
process.exitCode = falhas ? 1 : 0;
