import { RULES } from "../../contracts/dist/index.js";
import { supportsDeepAnalysis } from "../dist/index.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

// ---------------------------------------------------------------------------
// Trava contra promessa que o motor não cumpre.
//
// Uma regra com bloco `taint` declarando uma linguagem que o motor não analisa
// em profundidade é uma promessa vazia: o catálogo anuncia rastreamento de
// fluxo e o usuário recebe regex por linha. Quem lê o catálogo não tem como
// saber a diferença.
//
// Este teste não proíbe a situação — proíbe que ela seja SILENCIOSA. Cada par
// (regra, linguagem) sem suporte precisa estar declarado aqui, com a razão.
// Regra nova que declarar taint numa linguagem sem motor quebra o teste.
// ---------------------------------------------------------------------------

/** Lacunas conhecidas e aceitas, com o motivo. */
const LACUNAS_CONHECIDAS = {
  "HERO-SEC-0089-sql-injection": {
    python: "L0 (regex) roda em Python; o rastreamento de fluxo completo é só JS/TS — Python usa o lineTaint (L2 sem parser).",
  },
  "HERO-SEC-0095-code-injection-eval": {
    python: "idem: a regra vale em Python no nível L0/lineTaint, sem análise de fluxo Babel.",
  },
};

// Linguagens com motor L2: JS/TS usam o taint completo (Babel); Java, Python,
// C# e Go usam o lineTaint (rastreador de variável sem parser, lineTaint.ts).
const LINGUAGENS_COM_L2 = new Set(["javascript", "typescript", "java", "python", "csharp", "go"]);

console.log("=== regras com taint x linguagens que o motor analisa a fundo");

const comTaint = RULES.filter((r) => r.taint);
console.log(`  ${comTaint.length} regra(s) com bloco taint`);

const naoDeclaradas = [];
for (const r of comTaint) {
  for (const lang of r.languages ?? []) {
    // Linguagem com motor L2 (profundo OU lineTaint) não é lacuna.
    if (LINGUAGENS_COM_L2.has(lang)) continue;
    if (supportsDeepAnalysis(lang)) continue;
    const motivo = LACUNAS_CONHECIDAS[r.id]?.[lang];
    if (motivo) {
      console.log(`  aceita  ${r.id} / ${lang}`);
      console.log(`          ${motivo}`);
    } else {
      naoDeclaradas.push(`${r.id} / ${lang}`);
    }
  }
}

for (const x of naoDeclaradas) {
  console.log(`  NOVA LACUNA NAO DECLARADA: ${x}`);
}
check(
  naoDeclaradas.length === 0,
  `${naoDeclaradas.length} regra(s) prometem taint em linguagem sem motor, sem declarar a lacuna. ` +
    "Ou implemente o motor, ou registre em LACUNAS_CONHECIDAS com o motivo.",
);

console.log("\n=== o motor cobre exatamente o que diz cobrir");
for (const [lang, esperado] of [
  ["javascript", true],
  ["typescript", true],
  ["python", false],
  ["java", false],
  ["csharp", false],
  ["cobol", false],
]) {
  const got = supportsDeepAnalysis(lang);
  check(got === esperado, `supportsDeepAnalysis(${lang}) deveria ser ${esperado}`);
}
console.log("  javascript e typescript: sim | python, java, csharp, cobol: não");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
