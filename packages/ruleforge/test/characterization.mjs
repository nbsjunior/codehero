import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, matchPattern } from "@codehero/contracts";

// ---------------------------------------------------------------------------
// Guarda de regressao das regras L0.
//
// Duas perguntas diferentes, que exigem dois testes diferentes:
//
//   A regra PAROU de achar o que achava?
//     Cada caso de caracterizacao e um trecho real que a regra casa hoje. Se
//     algum deixar de casar, alguma mudanca estreitou o detector sem querer.
//
//   A regra passou a achar DEMAIS?
//     Cada orcamento e quantas vezes a regra dispara no acervo. Foi assim que
//     650 falsos positivos entraram de uma vez aqui: uma regex de cripto sem
//     \b passou a casar dentro de "MODES" e "candidates", o volume explodiu e
//     ninguem viu. O orcamento transforma isso em falha de teste.
//
// O que este arquivo NAO faz: dizer que o apontamento esta certo. Para isso
// existe o corpus dourado, onde alguem decidiu caso a caso. Somar os dois
// numeros como se fossem a mesma coisa seria inflar a cobertura.
// ---------------------------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const dados = JSON.parse(
  readFileSync(join(aqui, "..", "corpus", "characterization.json"), "utf8"),
);

const porId = new Map(RULES.map((r) => [r.id, r]));
let falhas = 0;

console.log("=== A regra ainda acha o que achava? ===");
const quebrados = [];
for (const c of dados.casos) {
  const regra = porId.get(c.ruleId);
  if (!regra) {
    // Regra removida do catalogo: nao e falha, mas o caso ficou orfao.
    quebrados.push({ id: c.ruleId, motivo: "regra nao existe mais no catalogo" });
    continue;
  }
  let casa = false;
  try {
    casa = matchPattern(regra.pattern, c.code, { profile: c.profile ?? "clike" }).length > 0;
  } catch (e) {
    quebrados.push({ id: c.ruleId, motivo: `regex invalida: ${e.message}` });
    continue;
  }
  if (!casa) quebrados.push({ id: c.ruleId, motivo: "parou de casar", trecho: c.code.slice(0, 70) });
}
console.log(`  ${dados.casos.length - quebrados.length}/${dados.casos.length} casos seguem casando`);
for (const q of quebrados.slice(0, 12)) {
  console.log(`  FALHA ${q.id}: ${q.motivo}${q.trecho ? `\n        ${q.trecho}` : ""}`);
}
if (quebrados.length > 12) console.log(`  ... e mais ${quebrados.length - 12}`);
falhas += quebrados.length;

console.log("\n=== O orcamento de volume esta integro? ===");
// A comparacao de verdade exige recontar sobre o acervo inteiro, o que leva
// minutos e nao cabe aqui. Ela roda em `node scripts/mine-characterization.mjs
// --check`, que reusa exatamente o mesmo codigo da extracao, entao nao ha duas
// implementacoes para divergir.
//
// Aqui fica so o que e barato e ainda assim util: o arquivo nao pode ter
// numero invalido nem regra que sumiu do catalogo.
const invalidos = dados.orcamentos.filter((o) => !Number.isFinite(o.acertos) || o.acertos <= 0);
const orfaos = dados.orcamentos.filter((o) => !porId.has(o.ruleId));
console.log(`  ${dados.orcamentos.length} regra(s) com orcamento gravado`);
console.log(`  invalidos: ${invalidos.length} | orfaos: ${orfaos.length}`);
if (invalidos.length || orfaos.length) {
  for (const o of [...invalidos, ...orfaos].slice(0, 8)) console.log(`  FALHA ${o.ruleId}: ${o.acertos}`);
  falhas += invalidos.length + orfaos.length;
}

console.log("\n=== A cobertura e contada com honestidade? ===");
// Este teste existe para impedir uma mentira especifica: apresentar
// caracterizacao como se fosse validacao humana.
const dourados = JSON.parse(readFileSync(join(aqui, "..", "corpus", "golden.json"), "utf8"));
const listaDourada = Array.isArray(dourados) ? dourados : (dourados.cases ?? dourados.casos ?? []);
const regrasDouradas = new Set(listaDourada.map((c) => c.ruleId));
const regrasCaracterizadas = new Set(dados.casos.map((c) => c.ruleId));
const soCaracterizadas = [...regrasCaracterizadas].filter((r) => !regrasDouradas.has(r));

console.log(`  regras com caso DOURADO (validado por pessoa): ${regrasDouradas.size}`);
console.log(`  regras com caso de CARACTERIZACAO           : ${regrasCaracterizadas.size}`);
console.log(`  destas, sem nenhuma validacao humana        : ${soCaracterizadas.length}`);
if (!dados._porque || !/NAO afirma que o apontamento esta correto/i.test(dados._porque)) {
  console.log("  FALHA: o arquivo perdeu a ressalva que separa caracterizacao de validacao");
  falhas++;
}

console.log(
  falhas === 0
    ? "\ntodas as asserções passaram"
    : `\n${falhas} FALHA(S)`,
);
process.exitCode = falhas === 0 ? 0 : 1;
