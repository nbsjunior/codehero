#!/usr/bin/env node
/**
 * Promove ao corpus dourado o que a indução conseguiu sustentar, e SÓ isso.
 *
 * O critério, e por que ele é o ponto inteiro deste arquivo
 * ---------------------------------------------------------------------------
 * Caso induzido `match` é quase tautológico para a regra que o gerou: o trecho
 * está ali porque ela casou nele, então ela vai casar de novo. Promover isso
 * como "regra validada" seria mentir para o painel.
 *
 * Então cada caso é classificado pela FORÇA da evidência, e cada força tem um
 * destino diferente:
 *
 *   CORROBORADO   o arquivo tem gabarito externo (OWASP) e ele concorda com o
 *                 rótulo induzido. Evidência de verdade, não circular. Vira
 *                 caso de corpus e a regra conta como validada.
 *
 *   GUARDA        rótulo confiante, sem gabarito externo. Não prova que a
 *                 regra está certa; prova o que ela faz HOJE. Vira caso e
 *                 impede que uma edição futura mude o comportamento em
 *                 silêncio. Fica marcado como guarda, e não como validação.
 *
 *   PENDENCIA     a indução diz que a regra NÃO deveria ter casado. Este é o
 *                 caso valioso e é o único que não entra no corpus: ele
 *                 REPROVA a regra como ela está hoje, então promovê-lo
 *                 quebraria o build. Sai num arquivo à parte, que é a lista de
 *                 trabalho.
 *
 *   DESCARTADO    o gabarito externo CONTRADIZ o rótulo induzido. Fora.
 *
 * Uso: node scripts/aprovar-regras.mjs [--aplicar]
 * Sem `--aplicar` só relata. Escrever no corpus é ato deliberado.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { analyzeSource } from "../packages/scanner/dist/engine.js";
import { RULES } from "../packages/contracts/dist/index.js";
import { induzirCorpus, estadoVazio } from "../packages/ruleforge/dist/index.js";

const APLICAR = process.argv.includes("--aplicar");
const CORPUS = "packages/ruleforge/corpus/golden.json";
const PENDENCIAS = "packages/ruleforge/corpus/pendencias-inducao.json";
const BENCH = ".tmp/benchmark-java/src/main/java/org/owasp/benchmark/testcode";

const EXTS = new Set([".java", ".js", ".ts", ".tsx", ".py", ".cs", ".go", ".cbl", ".cpy", ".sql"]);
const PULAR = ["node_modules", ".git", "dist", ".tmp", "out", "bundled", ".next", "test", "__tests__"];

function varrer(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (PULAR.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) varrer(p, out);
    else if (EXTS.has(extname(e.name).toLowerCase()) && statSync(p).size < 400_000) out.push(p);
  }
  return out;
}

// --- gabarito externo -------------------------------------------------------
const gab = new Map();
if (existsSync(".tmp/benchmark-java/expectedresults-1.2.csv")) {
  for (const l of readFileSync(".tmp/benchmark-java/expectedresults-1.2.csv", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))) {
    const [n, , r, w] = l.split(",");
    gab.set(n.trim(), { real: r.trim() === "true", cwe: w.trim() });
  }
}
const cweDaRegra = new Map(RULES.map((r) => [r.id, (r.cwe ?? []).map((c) => c.replace(/^CWE-/, ""))]));

// --- corpo de código: repositório + acervo ---------------------------------
const caminhos = [...varrer("packages"), ...varrer("apps"), ...varrer("scripts")];
if (existsSync(BENCH)) {
  for (const f of readdirSync(BENCH)) if (f.endsWith(".java")) caminhos.push(join(BENCH, f));
}
console.log(`arquivos: ${caminhos.length}`);

const arquivos = [];
for (const p of caminhos) {
  let fonte;
  try {
    fonte = readFileSync(p, "utf8");
  } catch {
    continue;
  }
  const linhas = fonte.split(/\r?\n/);
  const achados = [];
  for (const f of analyzeSource(p, fonte)) {
    achados.push({
      ruleId: f.rule.id,
      linha: f.startLine,
      colunaInicio: f.startColumn ?? 0,
      colunaFim: f.endColumn ?? 0,
      trecho: linhas[f.startLine - 1] ?? f.snippet ?? "",
      motor: f.engine ?? "pattern",
      temCaminhoDeTaint: Array.isArray(f.taintPath) && f.taintPath.length > 0,
    });
  }
  if (achados.length) arquivos.push({ caminho: p, fonte, achados });
}
console.log(`com apontamento: ${arquivos.length}`);

const r = induzirCorpus(arquivos, RULES, { estadoAnterior: estadoVazio() });
console.log(`candidatos: ${r.candidatosTotais} | casos induzidos: ${r.casos.length}`);

// --- de que motor veio cada apontamento ------------------------------------
//
// Isto decide o que PODE virar caso, e é um limite do formato do corpus, não
// da indução.
//
// Um caso de corpus é `(trecho, esperado)` avaliado com `matchPattern`, que é
// um casador LÉXICO sobre o texto dado. Apontamento do motor de taint não
// cabe ali: ele existe porque o valor viajou por várias linhas, e a linha do
// sink sozinha não casa com padrão nenhum.
//
// Custou uma tentativa reprovada para eu ver isso. Promovi 7 casos
// corroborados por gabarito, todos de regra Java de segurança, e o teste do
// corpus deu 6 falhas na hora: `request.getSession().setAttribute(param, ...)`
// é um achado de fluxo de dados, e como linha solta não casa com nada.
//
// Enquanto o corpus não souber representar contexto de fluxo, só apontamento
// léxico pode ser promovido.
const motorDe = new Map();
for (const a of arquivos) {
  for (const ac of a.achados) motorDe.set(`${a.caminho}:${ac.linha}:${ac.ruleId}`, ac.motor);
}

// --- classificação por força da evidência ----------------------------------
const corroborados = [];
const guardas = [];
const pendencias = [];
let descartados = 0;
let semFormato = 0;

for (const caso of r.casos) {
  const m = /— (.+):(\d+)$/.exec(caso.note ?? "");
  const arquivo = m ? m[1] : "";
  const nome = arquivo.split(/[\\/]/).pop()?.replace(/\.java$/, "") ?? "";
  const g = gab.get(nome);
  const temGabarito = !!g && (cweDaRegra.get(caso.ruleId) ?? []).includes(g.cwe);

  if (caso.expected === "no_match") {
    pendencias.push(caso);
    continue;
  }
  if (m && motorDe.get(`${arquivo}:${m[2]}:${caso.ruleId}`) !== "pattern") {
    semFormato++;
    continue;
  }
  if (temGabarito) {
    if (g.real) corroborados.push(caso);
    else descartados++;
    continue;
  }
  guardas.push(caso);
}

// Uma regra não precisa de cem casos iguais. Fica com os primeiros de cada
// arquivo distinto: caso repetido não acrescenta garantia e incha o corpus.
function amostrar(casos, porRegra = 3) {
  const vistos = new Map();
  const out = [];
  const codigos = new Set();
  for (const c of casos) {
    const chave = c.ruleId;
    const n = vistos.get(chave) ?? 0;
    const codigo = c.code.trim();
    if (n >= porRegra || !codigo || codigo.length < 12 || codigos.has(codigo)) continue;
    vistos.set(chave, n + 1);
    codigos.add(codigo);
    out.push(c);
  }
  return out;
}

const corpusAtual = JSON.parse(readFileSync(CORPUS, "utf8"));
const jaTem = new Set(corpusAtual.map((c) => c.ruleId));
const codigosExistentes = new Set(corpusAtual.map((c) => c.code.trim()));

const novosCorroborados = amostrar(corroborados).filter((c) => !codigosExistentes.has(c.code.trim()));
const novasGuardas = amostrar(guardas).filter((c) => !codigosExistentes.has(c.code.trim()));

const regrasCorroboradas = new Set(novosCorroborados.map((c) => c.ruleId));
const regrasGuarda = new Set(novasGuardas.map((c) => c.ruleId));
const novasValidadas = [...regrasCorroboradas].filter((id) => !jaTem.has(id));
const novasComGuarda = [...regrasGuarda].filter((id) => !jaTem.has(id) && !regrasCorroboradas.has(id));

console.log("\n=== classificação por força da evidência ===");
console.log(`  CORROBORADO por gabarito externo : ${corroborados.length} caso(s), ${regrasCorroboradas.size} regra(s)`);
console.log(`  GUARDA (trava comportamento)     : ${guardas.length} caso(s), ${regrasGuarda.size} regra(s)`);
console.log(`  PENDENCIA (regra deveria calar)  : ${pendencias.length} caso(s)`);
console.log(`  DESCARTADO (gabarito contradiz)  : ${descartados}`);

console.log("\n=== o que entra no corpus ===");
console.log(`  casos corroborados novos : ${novosCorroborados.length}`);
console.log(`  casos guarda novos       : ${novasGuardas.length}`);
console.log(`  regras que passam a ter VALIDAÇÃO : ${novasValidadas.length}`);
console.log(`  regras que passam a ter GUARDA    : ${novasComGuarda.length}`);
if (novasValidadas.length) console.log("     " + novasValidadas.slice(0, 12).join("\n     "));

if (process.argv.includes("--listar")) {
  console.log("\n=== casos corroborados (entram como validação) ===");
  for (const c of novosCorroborados) {
    console.log(`\n  ${c.ruleId}`);
    console.log(`    ${c.code.slice(0, 108)}`);
    console.log(`    ${(c.note ?? "").slice(0, 108)}`);
  }
  console.log("\n=== casos guarda (entram como trava de comportamento) ===");
  for (const c of novasGuardas) {
    console.log(`\n  ${c.ruleId}`);
    console.log(`    ${c.code.slice(0, 108)}`);
  }
}

if (!APLICAR) {
  console.log("\n(relatório apenas. use --aplicar para escrever no corpus)");
  process.exit(0);
}

// SÓ o corroborado entra. A guarda ficou de fora depois de eu olhar o que ela
// promoveria: `SONAR-ts-S2083` casando em `// src/ -> ../models`, que é
// comentário, e `SONAR-ts-S4507` casando num `console.log` de ajuda. São
// falsos positivos, e gravá-los como caso os transformaria em comportamento
// ESPERADO — a partir dali o corpus reprovaria justamente a correção da regra.
//
// A linha que ficou é simples e defensável: promove quem tem gabarito
// EXTERNO. O acordo entre votantes escolhe o que vale a pena conferir; ele não
// tem autoridade para dizer o que é verdade.
const marcados = novosCorroborados.map((c) => ({
  ...c,
  note: "[corroborado por gabarito OWASP] " + c.note,
}));
writeFileSync(CORPUS, JSON.stringify([...corpusAtual, ...marcados], null, 2) + "\n");
writeFileSync(PENDENCIAS, JSON.stringify(pendencias.slice(0, 500), null, 2) + "\n");
console.log(`\ncorpus: ${corpusAtual.length} -> ${corpusAtual.length + marcados.length}`);
console.log(`guardas NAO promovidas: ${novasGuardas.length} (evidência fraca demais)`);
console.log(`pendências gravadas em ${PENDENCIAS} (amostra de ${Math.min(pendencias.length, 500)} de ${pendencias.length})`);
