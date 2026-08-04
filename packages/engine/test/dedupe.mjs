import { analyzeFile } from "../dist/index.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

const regra = (id, severity, regex) => ({
  id, name: id, severity, type: "CODE_SMELL", remediationEffortMin: 5,
  cwe: [], owasp: [], message: id, sddTemplateId: "x",
  languages: ["javascript"], pattern: { regex, scope: "any" },
});

const fonte = "const perigo = 1;\n";
const base = { file: "a.js", source: fonte, language: "javascript", enableDeepAnalysis: false };

console.log("=== detector IDENTICO colapsa");
const iguais = [
  regra("R-INFO", "INFO", "perigo"),
  regra("R-BLOCKER", "BLOCKER", "perigo"),
  regra("R-MINOR", "MINOR", "perigo"),
];
const r1 = analyzeFile({ ...base, rules: iguais });
console.log(`  3 regras com a mesma regex -> ${r1.length} achado(s)`);
check(r1.length === 1, `deveria colapsar em 1, veio ${r1.length}`);
// TRAVA DE GATE: se a colapsada nao for a mais severa, o build para de reprovar.
check(r1[0].ruleId === "R-BLOCKER", `deve ficar a mais severa, ficou ${r1[0]?.ruleId}`);
console.log(`  sobreviveu: ${r1[0].ruleId} | absorvidas: ${JSON.stringify(r1[0].alsoRuleIds)}`);
check(r1[0].alsoRuleIds?.length === 2, "as duas absorvidas tem de ficar registradas");
check(
  r1[0].alsoRuleIds.includes("R-INFO") && r1[0].alsoRuleIds.includes("R-MINOR"),
  "nenhum id pode se perder",
);

console.log("\n=== detector DIFERENTE nao colapsa");
const diferentes = [
  regra("R-A", "MAJOR", "perigo"),
  regra("R-B", "MAJOR", "const"),
];
const r2 = analyzeFile({ ...base, rules: diferentes });
console.log(`  2 regras com regex diferente -> ${r2.length} achado(s)`);
check(r2.length === 2, `dois problemas distintos ficam os dois, vieram ${r2.length}`);

console.log("\n=== regex diferente, MESMA posicao e MESMO tipo, colapsa");
// `console.log` era detectado por SONAR-S4507 e por HERO-SMELL-0489 com
// padroes distintos: 71 dos 170 apontamentos do repo eram esse par.
const mesmoPonto = [
  { ...regra("R-CURTA", "MINOR", "console\\.log"), type: "CODE_SMELL" },
  { ...regra("R-LONGA", "MAJOR", "console\\.(log|debug)\\s*\\("), type: "CODE_SMELL" },
];
const r4 = analyzeFile({ ...base, source: "console.log(1);\n", rules: mesmoPonto });
console.log(`  2 padroes p/ console.log -> ${r4.length} achado(s)`);
check(r4.length === 1, `mesma deteccao colapsa, veio ${r4.length}`);
check(r4[0].ruleId === "R-LONGA", `fica a mais severa, ficou ${r4[0]?.ruleId}`);

console.log("\n=== TIPOS diferentes na mesma posicao NAO colapsam");
// Detectores DIFERENTES (senao a passada 1 colapsa, e com razao: regex
// identica e a mesma deteccao, mesmo com rotulo de tipo diferente).
const tiposDiferentes = [
  { ...regra("R-SMELL", "MINOR", "console\\.log"), type: "CODE_SMELL" },
  { ...regra("R-VULN", "BLOCKER", "console\\.(log|warn)\\s*\\("), type: "VULNERABILITY" },
];
const r5 = analyzeFile({ ...base, source: "console.log(segredo);\n", rules: tiposDiferentes });
console.log(`  smell + vulnerability no mesmo ponto -> ${r5.length} achado(s)`);
check(r5.length === 2, `dois tipos sao dois problemas, vieram ${r5.length}`);

console.log("\n=== regex identica com tipos diferentes: colapsa na mais severa");
const mesmaRegexTipos = [
  { ...regra("R-S", "MINOR", "console\\.log"), type: "CODE_SMELL" },
  { ...regra("R-V", "BLOCKER", "console\\.log"), type: "VULNERABILITY" },
];
const r6 = analyzeFile({ ...base, source: "console.log(1);\n", rules: mesmaRegexTipos });
console.log(`  mesma regex, tipos diferentes -> ${r6.length} (fica ${r6[0]?.ruleId})`);
check(r6.length === 1, `regex identica e a mesma deteccao, vieram ${r6.length}`);
check(r6[0].ruleId === "R-V", "a mais severa tem de sobreviver ao colapso");

console.log("\n=== posicoes diferentes nao colapsam");
const duasLinhas = { ...base, source: "const perigo = 1;\nconst perigo = 2;\n" };
const r3 = analyzeFile({ ...duasLinhas, rules: [regra("R-X", "MAJOR", "perigo")] });
console.log(`  mesma regra em 2 linhas -> ${r3.length} achado(s)`);
check(r3.length === 2, `linhas distintas sao achados distintos, vieram ${r3.length}`);

console.log("\n=== resultado estavel entre execucoes (o gate nao pode oscilar)");
const empate = [regra("R-ZZ", "MAJOR", "perigo"), regra("R-AA", "MAJOR", "perigo")];
const a = analyzeFile({ ...base, rules: empate });
const b = analyzeFile({ ...base, rules: [...empate].reverse() });
console.log(`  ordem 1 -> ${a[0].ruleId} | ordem 2 -> ${b[0].ruleId}`);
check(a[0].ruleId === b[0].ruleId, "empate tem de resolver igual independente da ordem das regras");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
