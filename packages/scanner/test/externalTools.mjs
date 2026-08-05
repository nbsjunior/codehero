import { eslintJsonToSarif } from "../dist/eslintSarif.js";
import { collectExternalSarifs, runSpotbugs } from "../dist/externalTools.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

console.log("=== conversao ESLint JSON -> SARIF");
const saida = JSON.stringify([
  {
    filePath: "C:\\proj\\src\\a.js",
    messages: [
      { ruleId: "no-unused-vars", severity: 2, message: "'x' is defined but never used.", line: 3, column: 7, endLine: 3, endColumn: 8 },
      { ruleId: "eqeqeq", severity: 1, message: "Expected '===' ", line: 10, column: 5 },
      // Sem ruleId = erro de parse do proprio ESLint (config quebrada). Nao e
      // achado de qualidade do codigo — reportar seria mentira.
      { ruleId: null, severity: 2, message: "Parsing error: Unexpected token" },
    ],
  },
  { filePath: "C:\\proj\\src\\b.js", messages: [] },
]);
const sarif = eslintJsonToSarif(saida);
console.log(`  results: ${sarif.runs[0].results.length} | regras: ${sarif.runs[0].tool.driver.rules.length}`);
check(sarif !== null, "conversao nao pode falhar em JSON valido");
check(sarif.runs[0].results.length === 2, `mensagem sem ruleId tem de ser descartada, vieram ${sarif.runs[0].results.length}`);
check(sarif.runs[0].tool.driver.name === "eslint", "driver tem de se chamar eslint");
const r0 = sarif.runs[0].results[0];
check(r0.level === "error", `severity 2 -> error, veio ${r0.level}`);
check(sarif.runs[0].results[1].level === "warning", "severity 1 -> warning");
const uri = r0.locations[0].physicalLocation.artifactLocation.uri;
console.log(`  uri normalizada: ${uri}`);
check(!uri.includes("\\"), "barra invertida do Windows tem de virar /");
check(r0.locations[0].physicalLocation.region.startLine === 3, "linha preservada");

console.log("\n=== entrada invalida degrada, nao quebra");
check(eslintJsonToSarif("nao e json") === null, "JSON invalido -> null");
check(eslintJsonToSarif('{"a":1}') === null, "objeto (nao array) -> null");
check(eslintJsonToSarif("[]")?.runs[0].results.length === 0, "array vazio -> SARIF sem results");
console.log("  ok");

console.log("\n=== SpotBugs sem bytecode: mensagem tem de ser ACIONAVEL");
const sb = runSpotbugs("/caminho/que/nao/existe/xyz");
console.log(`  ok=${sb.ok} | hint: ${sb.hint}`);
check(sb.ok === false, "sem classes compiladas nao pode dar ok");
check(/compile|bytecode/i.test(sb.hint ?? ""), "a dica tem de explicar que precisa compilar, nao so 'indisponivel'");
check(/pmd/i.test(sb.hint ?? ""), "e tem de apontar a alternativa que roda no fonte");

console.log("\n=== nenhum adaptador pedido: nao roda nada");
const nada = collectExternalSarifs({ cwd: process.cwd() });
check(nada.paths.length === 0 && nada.logs.length === 0, "sem flag, nenhum processo e disparado");
console.log("  ok");

console.log("\n=== ferramenta ausente devolve log, nao lanca");
const ausente = collectExternalSarifs({ pmd: true, cwd: "/caminho/inexistente/xyz" });
console.log(`  logs: ${ausente.logs.map((l) => `${l.tool}=${l.ok}`).join(", ")} | paths: ${ausente.paths.length}`);
check(ausente.logs.length === 1, "tem de registrar a tentativa");
check(ausente.paths.length === 0, "ferramenta ausente nao contribui caminho");
check(ausente.logs[0].hint !== undefined, "falha tem de vir com dica de instalacao");


// --- Eco entre ferramentas -------------------------------------------------
const { colapsaEcoEntreFerramentas } = await import("../dist/dedupeCrossTool.js");

console.log("\n=== eco: achado de terceiro na MESMA linha de regra propria");
const nativo = (id, linha, col, file = "src/app.js") => ({
  rule: { id, severity: "MAJOR" }, file, startLine: linha, startColumn: col, endColumn: col + 2,
  snippet: "", fingerprint: id,
});
const ext = (id, linha, col, extra = {}) => ({
  ruleId: id, tool: "eslint", originalRuleId: id, severity: "MAJOR", message: "", file: "src/app.js",
  startLine: linha, startColumn: col, endColumn: col + 2, snippet: "", fingerprint: id, cwe: [],
  isDependency: false, ...extra,
});

const nativos = [nativo("HERO-A", 3, 24), nativo("HERO-B", 3, 8)];
const r = colapsaEcoEntreFerramentas(
  nativos,
  [ext("EXT:eslint:no-eval", 3, 24), ext("EXT:eslint:eqeqeq", 3, 9), ext("EXT:eslint:no-unused", 1, 7)],
  process.cwd(),
);
console.log(`  absorvidos: ${r.absorvidos} | restantes: ${r.restantes.map((x) => x.ruleId).join(", ")}`);
check(r.absorvidos === 2, `dois estavam cobertos, absorveu ${r.absorvidos}`);
check(r.restantes.length === 1, "o que nao tem equivalente proprio TEM de sobreviver");
check(r.restantes[0].ruleId === "EXT:eslint:no-unused", "sobrou o achado sem cobertura");

// A atribuicao importa: absorver `no-eval` sob a regra do `==` daria rastro de
// conformidade errado, ainda que a contagem final fosse igual.
const porId = Object.fromEntries(nativos.map((n) => [n.rule.id, n.alsoRuleIds ?? []]));
console.log(`  HERO-A(col 24) <- ${porId["HERO-A"]}`);
console.log(`  HERO-B(col  8) <- ${porId["HERO-B"]}`);
check(porId["HERO-A"].includes("EXT:eslint:no-eval"), "no-eval (col 24) tem de cair no nativo da col 24");
check(porId["HERO-B"].includes("EXT:eslint:eqeqeq"), "eqeqeq (col 9) tem de cair no nativo da col 8");

console.log("\n=== vulnerabilidade de DEPENDENCIA nunca e absorvida");
const comSca = colapsaEcoEntreFerramentas(
  [nativo("HERO-C", 5, 1)],
  [ext("EXT:trivy:CVE-2024-1", 5, 1, { isDependency: true, tool: "trivy" })],
  process.cwd(),
);
console.log(`  absorvidos: ${comSca.absorvidos} (deve ser 0)`);
check(comSca.absorvidos === 0, "SCA fala do node_modules, coincidir de linha seria acidente");
check(comSca.restantes.length === 1, "o achado de dependencia sobrevive");

console.log("\n=== sem importados, nao faz nada");
const vazio = colapsaEcoEntreFerramentas([nativo("HERO-D", 1, 1)], [], process.cwd());
check(vazio.absorvidos === 0 && vazio.restantes.length === 0, "lista vazia entra e sai vazia");
console.log("  ok");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
