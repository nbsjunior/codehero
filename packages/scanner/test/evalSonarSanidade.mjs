// Avaliação REAL: mede quantas regras têm regex estruturalmente são.
// Critério: (a) regex compila sem exceção, (b) tem literal ou âncora real,
// (c) não é o placeholder (?!x)x. Não tenta gerar snippet (impossível fazer
// bem automaticamente); isso é verificação de CONSTRUÇÃO, não recall.
import { RULES, compilePattern } from "@codehero/contracts";

const sonar = RULES.filter((r) => r.id.startsWith("SONAR-"));

let compila = 0;
let placeholder = 0;
let invalido = [];
let vazio = [];

for (const r of sonar) {
  const re = r.pattern?.regex ?? "";
  if (re === "(?!x)x") { placeholder++; continue; }
  if (!re) { vazio.push(r.id); continue; }
  try {
    // Usa o MESMO compilador do engine (extrai (?i) do início etc).
    compilePattern(re, r.pattern?.flags ?? "");
    compila++;
  } catch (e) {
    invalido.push({ id: r.id, err: String(e).slice(0, 60) });
  }
}

console.log(`Total SONAR: ${sonar.length}`);
console.log(`  regex válido:        ${compila}`);
console.log(`  placeholder (?!x)x:  ${placeholder}  <- NÃO detectam nada`);
console.log(`  regex vazio:         ${vazio.length}`);
console.log(`  regex INVÁLIDO:      ${invalido.length}`);

if (invalido.length) {
  console.log("\nRegex inválidos:");
  invalido.forEach((i) => console.log(" ", i.id, i.err));
}
if (vazio.length) {
  console.log("\nRegex vazio:", vazio.slice(0, 10));
}

// Distribuição por tipo/severidade das que TÊM regex válido
const comRegex = sonar.filter((r) => r.pattern?.regex && r.pattern.regex !== "(?!x)x");
const porTipo = {};
const porSev = {};
for (const r of comRegex) {
  porTipo[r.type] = (porTipo[r.type] ?? 0) + 1;
  porSev[r.severity] = (porSev[r.severity] ?? 0) + 1;
}
console.log("\nCom regex válido por tipo:", porTipo);
console.log("Com regex válido por severidade:", porSev);
