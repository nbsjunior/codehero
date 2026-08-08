import {
  selecionarParaLeitura,
  estimarTokens,
  observacoesNaoEntramNoGate,
} from "../dist/leituraAssistida.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

// Um arquivo sintetico com linhas numeradas, para conferir o recorte.
const linhas = Array.from({ length: 60 }, (_, i) => `linha ${i + 1} com algum codigo aqui`);
const fonte = () => linhas.join("\n");

console.log("=== o teto corta ANTES de despachar ===");
const muitosHunks = Array.from({ length: 20 }, (_, i) => ({
  arquivo: "a.ts",
  linhaInicial: i * 3 + 1,
  linhaFinal: i * 3 + 2,
}));
const apertado = selecionarParaLeitura(muitosHunks, [], fonte, { tetoDeTokens: 200 });
console.log(`  escolhidos: ${apertado.trechos.length} | tokens: ${apertado.tokensEstimados} | descartados: ${apertado.descartadosPorOrcamento}`);
check(apertado.tokensEstimados <= 200, "o gasto NUNCA pode passar do teto");
check(apertado.descartadosPorOrcamento > 0, "com teto apertado tem de haver descarte");
check(apertado.trechos.length > 0, "teto apertado nao pode zerar a leitura");

console.log("\n=== teto zero desliga tudo ===");
const desligado = selecionarParaLeitura(muitosHunks, [], fonte, { tetoDeTokens: 0 });
console.log(`  trechos: ${desligado.trechos.length} | tokens: ${desligado.tokensEstimados}`);
check(desligado.trechos.length === 0, "teto zero nao pode selecionar nada");
check(desligado.tokensEstimados === 0, "teto zero nao pode gastar nada");

console.log("\n=== linha ja apontada por regra NAO vai para o modelo ===");
const doisHunks = [
  { arquivo: "a.ts", linhaInicial: 10, linhaFinal: 12 },
  { arquivo: "a.ts", linhaInicial: 40, linhaFinal: 42 },
];
const comRegra = selecionarParaLeitura(
  doisHunks,
  [{ arquivo: "a.ts", linha: 11 }], // uma regra ja apontou no meio do primeiro
  fonte,
  { tetoDeTokens: 100000 },
);
console.log(`  trechos: ${comRegra.trechos.length} | ja cobertos por regra: ${comRegra.jaCobertosPorRegra}`);
check(comRegra.jaCobertosPorRegra === 1, "o hunk com apontamento tem de ser contado como coberto");
check(comRegra.trechos.length === 1, "so o hunk SEM apontamento deve ir para leitura");
check(
  comRegra.trechos[0]?.linhaInicial <= 40 && comRegra.trechos[0]?.linhaFinal >= 42,
  "o trecho escolhido tem de ser o segundo, que nao tinha regra",
);

console.log("\n=== e o que MEDE a economia ===");
const semRegra = selecionarParaLeitura(doisHunks, [], fonte, { tetoDeTokens: 100000 });
const economia = 1 - comRegra.tokensEstimados / semRegra.tokensEstimados;
console.log(`  sem regras: ${semRegra.tokensEstimados} tokens | com regra cobrindo 1 hunk: ${comRegra.tokensEstimados}`);
console.log(`  economia: ${(economia * 100).toFixed(0)}%`);
check(comRegra.tokensEstimados < semRegra.tokensEstimados, "cobrir com regra tem de BAIXAR o custo de leitura");

console.log("\n=== contexto ao redor do trecho ===");
const comContexto = selecionarParaLeitura(
  [{ arquivo: "a.ts", linhaInicial: 20, linhaFinal: 20 }],
  [],
  fonte,
  { tetoDeTokens: 100000, contexto: 5 },
);
const t = comContexto.trechos[0];
console.log(`  linha 20 virou o intervalo ${t?.linhaInicial}-${t?.linhaFinal}`);
check(t?.linhaInicial === 15 && t?.linhaFinal === 25, "contexto de 5 tem de abrir 5 para cada lado");

console.log("\n=== contexto nao pode passar do inicio nem do fim do arquivo ===");
const naBorda = selecionarParaLeitura(
  [{ arquivo: "a.ts", linhaInicial: 1, linhaFinal: 1 }, { arquivo: "a.ts", linhaInicial: 60, linhaFinal: 60 }],
  [],
  fonte,
  { tetoDeTokens: 100000, contexto: 10 },
);
const inicios = naBorda.trechos.map((x) => x.linhaInicial);
const fins = naBorda.trechos.map((x) => x.linhaFinal);
console.log(`  inicios: ${inicios.join(",")} | fins: ${fins.join(",")}`);
check(Math.min(...inicios) >= 1, "nao pode comecar antes da linha 1");
check(Math.max(...fins) <= 60, "nao pode terminar depois da ultima linha");

console.log("\n=== estimativa e conservadora ===");
const texto = "a".repeat(400);
console.log(`  400 caracteres -> ${estimarTokens(texto)} tokens`);
check(estimarTokens(texto) >= 100, "estimar para MENOS e o defeito que estoura a conta");

console.log("\n=== observacao de modelo nao entra no gate ===");
const doGate = [{ severity: "CRITICAL" }, { severity: "MAJOR" }];
const obs = [{ arquivo: "a.ts", linha: 3, texto: "isto parece suspeito", modelo: "barato-1" }];
const sep = observacoesNaoEntramNoGate(doGate, obs);
console.log(`  gate: ${sep.gate.length} | fora do gate: ${sep.foraDoGate.length}`);
check(sep.gate.length === 2, "o gate tem de ficar exatamente como estava");
check(sep.foraDoGate.length === 1, "a observacao tem de existir, mas do lado de fora");
check(
  !sep.gate.some((x) => x.severity === undefined),
  "nenhuma observacao pode ter escorregado para dentro do gate",
);

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
