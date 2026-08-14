#!/usr/bin/env node
/**
 * Gera o relatório arquitetural determinístico de um diretório.
 *
 * Junta três coisas que existiam separadas e não se falavam:
 *
 *   grafo        quem importa quem, quem chama quem (code-graph)
 *   complexidade ciclomática e cognitiva por função (engine/structural)
 *   corpus       quais regras têm garantia de teste (ruleforge)
 *
 * Separadas, cada uma responde meia pergunta. "Esta função tem ciclomática 34"
 * não decide nada sem saber quantos módulos dependem dela; "quarenta módulos
 * importam este arquivo" não decide nada sem saber se ele é complicado.
 *
 * Uso:
 *   node scripts/relatorio-arquitetura.mjs [dir] -o apps/web/public/arquitetura.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { buildCodeGraph } from "../packages/code-graph/dist/build.js";
import { analisarArquitetura } from "../packages/code-graph/dist/arquitetura.js";
import { parseStructural, computeFileMetrics, structuralLanguageFor } from "../packages/engine/dist/index.js";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const RAIZ = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : ".";
const SAIDA = arg("-o", "reports/arquitetura.json");
const IGNORA = new Set([
  "node_modules", ".git", "dist", "out", "bundled", ".next", "_next", "coverage",
  ".tmp", "tmp", ".claude", ".turbo", "build", ".firebase", ".vercel", "vendor",
]);

/**
 * Arquivo minificado NÃO é código de ninguém, e conta como se fosse.
 *
 * A primeira execução deste relatório colocou `framework-efd27007.js` do
 * `.firebase/` no topo da lista de risco, com complexidade cognitiva 8868.
 * Um bundle gerado ficou classificado como o lugar mais perigoso do
 * repositório, e o resto da tabela foi empurrado para baixo dele.
 *
 * A lista de diretórios ignorados resolve o caso conhecido; esta guarda
 * resolve o caso que ninguém lembrou de listar. Linha média muito longa é a
 * assinatura de minificação, e é barata de checar.
 */
function pareceGerado(fonte) {
  const linhas = fonte.split(/\r?\n/);
  if (linhas.length === 0) return false;
  const media = fonte.length / linhas.length;
  return media > 200 || /^\/\/ *(GENERATED|AUTO-GENERATED|@generated)/im.test(fonte);
}

function coletar(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORA.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) coletar(p, out);
    else if (structuralLanguageFor(p) && !e.name.endsWith(".d.ts") && statSync(p).size < 400_000) {
      out.push(resolve(p));
    }
  }
  return out;
}

const arquivos = coletar(RAIZ);
console.log(`arquivos analisáveis: ${arquivos.length}`);

const doc = await buildCodeGraph({ root: RAIZ, files: arquivos });
console.log(`grafo: ${doc.nodes.length} nós, ${doc.edges.length} arestas`);

// --- complexidade por arquivo ----------------------------------------------
// Exportações só-de-tipo alimentam a APROXIMAÇÃO de abstratividade. É contagem
// de declaração, não análise de tipo, e o relatório diz isso na tela.
const SO_TIPO = /^\s*export\s+(?:declare\s+)?(?:interface|type)\s+\w/gm;
const EXPORTACAO = /^\s*export\s+(?:declare\s+)?(?:interface|type|const|let|var|function|class|async\s+function|enum|default)\b/gm;

const metricas = new Map();
let comErro = 0;
for (const p of arquivos) {
  const rel = relative(RAIZ, p).split("\\").join("/");
  let fonte;
  try {
    fonte = readFileSync(p, "utf8");
  } catch {
    continue;
  }
  if (pareceGerado(fonte)) continue;
  const parsed = await parseStructural(rel, fonte);
  if (!parsed) continue;
  const m = computeFileMetrics(rel, fonte, parsed);
  if (m.parseError) comErro++;
  metricas.set(rel, {
    linhasDeCodigo: m.linesOfCode,
    ciclomatica: m.cyclomatic,
    cognitiva: m.cognitive,
    funcoes: m.functions.length,
    maiorFuncao: m.functions.reduce((a, f) => Math.max(a, f.cyclomatic), 0),
    exportacoesDeTipo: (fonte.match(SO_TIPO) ?? []).length,
    exportacoesTotais: (fonte.match(EXPORTACAO) ?? []).length,
    linguagem: m.language,
    halsteadVolume: m.halsteadVolume,
    mi: m.maintainabilityIndex,
    piorFuncaoMi: m.functions.length ? Math.min(...m.functions.map((x) => x.maintainabilityIndex)) : null,
    comentarios: m.commentLines,
  });
}
console.log(`medidos: ${metricas.size}${comErro ? ` (${comErro} com erro de sintaxe)` : ""}`);

const rel = analisarArquitetura(doc, metricas);

mkdirSync(dirname(SAIDA), { recursive: true });
writeFileSync(SAIDA, JSON.stringify(rel, null, 2) + "\n");

const t = rel.totais;
console.log(`
=== leitura arquitetural ===
  módulos                 ${t.modulos}
  linhas de código        ${t.linhasDeCodigo}
  funções                 ${t.funcoes}
  ciclomática média/função ${t.ciclomaticaMedia}
  cognitiva média/função   ${t.cognitivaMedia}
  arestas internas        ${t.arestasInternas}
  dependências externas   ${t.dependenciasExternas}
  módulos em ciclo        ${t.modulosEmCiclo}${t.modulosEmCiclo ? "   <= importação circular" : ""}
  módulos órfãos          ${t.modulosOrfaos}   (ninguém importa e não é entrada)

  ciclos encontrados: ${rel.ciclos.length}`);
for (const c of rel.ciclos.slice(0, 3)) {
  console.log(`    ciclo ${c.id}: ${c.modulos.length} módulos — ${c.modulos.slice(0, 3).join(" → ")}${c.modulos.length > 3 ? " → …" : ""}`);
}

console.log(`
  maior risco (cognitiva × alcance):`);
console.log("  módulo                                             |   Ca |   Ce |    I | cogn | risco");
for (const m of rel.modulos.slice(0, 10)) {
  console.log(
    "  " + m.arquivo.slice(-50).padEnd(50) +
      " |" + String(m.ca).padStart(5) +
      " |" + String(m.ce).padStart(5) +
      " |" + (m.instabilidade === null ? "    -" : m.instabilidade.toFixed(2).padStart(5)) +
      " |" + String(m.cognitiva).padStart(5) +
      " |" + String(m.risco).padStart(6),
  );
}
console.log(`\ngravado: ${SAIDA}`);
