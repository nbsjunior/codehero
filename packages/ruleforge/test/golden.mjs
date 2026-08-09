import { RULES, matchPattern, buildLexicalMask } from "@codehero/contracts";
import { loadCorpus } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Avalia o corpus DOURADO contra as regras de verdade.
//
// Este teste nao existia. O corpus tinha 84 casos escritos a mao, versionados,
// e NENHUM deles era exercitado pela suite. Descobri isso escrevendo casos
// novos: um caso antigo (`path-02`) falhava havia quem sabe quanto tempo, e a
// regra de travessia apontava `fs.readFile(path.join(BASE, "readme.txt"))`
// como vulnerabilidade porque a palavra `path` aparecia no argumento.
//
// Corpus que ninguem roda nao e garantia, e decoracao. O numero de casos
// aparece em apresentacao e nao protege nada.
//
// A diferenca para `characterization.mjs`: la os casos congelam o que a regra
// FAZ hoje; aqui eles declaram o que ela DEVE fazer, porque uma pessoa leu a
// regex e decidiu. Sao garantias diferentes e por isso testes diferentes.
// ---------------------------------------------------------------------------

const casos = loadCorpus();
const porId = new Map(RULES.map((r) => [r.id, r]));

let acertos = 0;
const falsoNegativo = []; // deveria pegar e nao pegou
const falsoPositivo = []; // nao deveria pegar e pegou
const orfaos = [];

for (const c of casos) {
  const regra = porId.get(c.ruleId);
  if (!regra) {
    orfaos.push(c.id);
    continue;
  }
  let casa = false;
  try {
    casa = matchPattern(regra.pattern, c.code, {
      mask: buildLexicalMask(c.code, c.profile ?? "clike"),
    }).length > 0;
  } catch (e) {
    falsoNegativo.push({ id: c.id, ruleId: c.ruleId, code: `regex invalida: ${e.message}` });
    continue;
  }
  const esperaCasar = c.expected === "match";
  if (casa === esperaCasar) {
    acertos++;
    continue;
  }
  (esperaCasar ? falsoNegativo : falsoPositivo).push({
    id: c.id,
    ruleId: c.ruleId,
    code: c.code.slice(0, 72),
    note: c.note,
  });
}

console.log(`=== corpus dourado: ${acertos}/${casos.length} ===`);
console.log(`  regras cobertas: ${new Set(casos.map((c) => c.ruleId)).size}`);

if (falsoNegativo.length) {
  console.log(`\n--- FALSO NEGATIVO (${falsoNegativo.length}): a regra nao pega o que deveria ---`);
  for (const f of falsoNegativo.slice(0, 10)) console.log(`  ${f.ruleId}\n      ${f.code}`);
  if (falsoNegativo.length > 10) console.log(`  ... e mais ${falsoNegativo.length - 10}`);
}
if (falsoPositivo.length) {
  console.log(`\n--- FALSO POSITIVO (${falsoPositivo.length}): a regra pega o que nao deveria ---`);
  for (const f of falsoPositivo.slice(0, 10)) {
    console.log(`  ${f.ruleId}\n      ${f.code}${f.note ? `\n      (${f.note})` : ""}`);
  }
  if (falsoPositivo.length > 10) console.log(`  ... e mais ${falsoPositivo.length - 10}`);
}
if (orfaos.length) {
  console.log(`\n--- ORFAOS (${orfaos.length}): caso aponta para regra que nao existe mais ---`);
  for (const id of orfaos.slice(0, 8)) console.log(`  ${id}`);
}

const falhas = falsoNegativo.length + falsoPositivo.length + orfaos.length;
console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
