import { cruzarComplexidadeComCobertura } from "../dist/complexidadeCoberta.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

console.log("=== complexidade coberta vs não coberta ===");
const estrutura = [
  {
    file: "src/a.ts",
    functions: [
      { startLine: 10, endLine: 20, cyclomatic: 5 },  // coberta
      { startLine: 30, endLine: 40, cyclomatic: 3 },  // não coberta
      { startLine: 50, endLine: 55, cyclomatic: 2 },  // coberta
    ],
  },
  {
    file: "src/b.ts",
    functions: [
      { startLine: 1, endLine: 10, cyclomatic: 8 },   // não coberta
    ],
  },
];
const cobertura = {
  format: "jacoco",
  lines: { covered: 15, total: 25 },
  files: [
    { path: "src/a.ts", lines: { covered: 15, total: 20 }, uncoveredLines: [], coveredLines: [12, 14, 15, 16, 17, 18, 19, 20, 51, 52, 53, 54, 55] },
    { path: "src/b.ts", lines: { covered: 0, total: 5 }, uncoveredLines: [1,2,3,4,5], coveredLines: [] },
  ],
};

const r = cruzarComplexidadeComCobertura(estrutura, cobertura);
console.log(`  coberta: ${r.coberta} | não coberta: ${r.naoCoberta} | ${r.percentual}%`);
check(r.coberta === 7, "a.ts tem 5+2 cobertos");
check(r.naoCoberta === 11, "3 de a.ts + 8 de b.ts não cobertos");
check(r.percentual === 38.9, "7/18 = 38.9%");
check(r.porArquivo[0].file === "src/b.ts", "b.ts primeiro (mais dívida)");

console.log("\n=== função sem endLine válido entra como não coberta ===");
const estruturaRuim = [
  { file: "src/c.ts", functions: [{ startLine: 5, endLine: 0, cyclomatic: 4 }] },
];
const r2 = cruzarComplexidadeComCobertura(estruturaRuim, cobertura);
check(r2.naoCoberta === 4, "endLine=0 não é coberto");

console.log("\n=== arquivo sem cobertura = tudo não coberto ===");
const estruturaSemCobertura = [
  { file: "src/inexistente.ts", functions: [{ startLine: 1, endLine: 10, cyclomatic: 6 }] },
];
const r3 = cruzarComplexidadeComCobertura(estruturaSemCobertura, cobertura);
check(r3.naoCoberta === 6, "arquivo fora do relatório = 100% não coberto");

console.log("\n=== sem função = 100% (nada a medir) ===");
const r4 = cruzarComplexidadeComCobertura([], cobertura);
check(r4.percentual === 100, "denominador zero não reprova");

if (falhas > 0) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\ntodas as asserções passaram");
