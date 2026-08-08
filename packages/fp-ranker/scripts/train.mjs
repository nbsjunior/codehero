import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractFeatures,
  trainRanker,
  accuracy,
  precisionAtK,
  scoreFeatures,
  analisarRotulos,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Treina o ranqueador a partir de rótulos REAIS e grava o artefato versionado.
//
// Até aqui o modelo em produção tinha `trainSize: 0` — eram priors escritos à
// mão. Isto o substitui por algo ajustado a dados, e o artefato é um arquivo
// versionado: mesma entrada, mesma saída, sem inferência em tempo de scan.
//
// A HONESTIDADE DO NÚMERO IMPORTA MAIS QUE O NÚMERO. O conjunto tem 33 rótulos
// de UM repositório. Medir acurácia no mesmo conjunto usado para treinar daria
// um número alto e inútil, então há validação por deixar-um-de-fora
// (leave-one-out): cada exemplo é previsto por um modelo treinado sem ele.
// ---------------------------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const rotulosPath = join(raiz, "labels", "audit-2026-08.json");
// NÃO grava sobre `assertiveness.json`, que é o modelo carregado por padrão.
//
// Decisão de produto: um modelo ajustado a 33 apontamentos de UM repositório —
// um analisador estático em TypeScript — provavelmente piora o resultado em
// outros acervos, enquanto os priors escritos à mão são genéricos. O valor do
// ranqueador é personalização POR repositório, não um modelo global tirado da
// amostra que estava à mão.
//
// Cada instalação roda este script sobre os PRÓPRIOS rótulos e aponta
// `HERO_RANKER_MODEL` para o artefato resultante.
const saida = join(raiz, "models", "codehero-repo.json");

const bruto = JSON.parse(fs.readFileSync(rotulosPath, "utf8"));
const exemplos = bruto.rotulos.map((r, i) => ({
  id: `l${i}`,
  ruleId: r.ruleId,
  label: r.label,
  features: extractFeatures({
    ruleId: r.ruleId,
    file: r.file,
    severity: r.severity,
    findingSource: r.ruleId.startsWith("EXT:") ? "imported" : "native",
  }),
}));

console.log(`rotulos: ${exemplos.length}`);
const positivos = exemplos.filter((e) => e.label === 1).length;
console.log(`  verdadeiros: ${positivos} | falsos: ${exemplos.length - positivos}`);

// --- validação leave-one-out: o unico jeito honesto com conjunto deste tamanho
//
// De quebra, a predicao de cada exemplo por um modelo que NAO o viu e
// exatamente a predicao fora da amostra que a analise de qualidade de rotulo
// exige. Guardar isso aqui evita treinar tudo de novo depois.
let acertos = 0;
const probForaDaAmostra = [];
for (let i = 0; i < exemplos.length; i++) {
  const treino = exemplos.filter((_, j) => j !== i);
  const m = trainRanker(treino, { rounds: 30, version: "loo" });
  probForaDaAmostra.push(scoreFeatures(m, exemplos[i].features).assertiveness);
  const previsto = accuracy(m, [exemplos[i]]) === 1 ? exemplos[i].label : 1 - exemplos[i].label;
  if (previsto === exemplos[i].label) acertos++;
}
const loo = acertos / exemplos.length;
console.log(`\nacuracia leave-one-out: ${(loo * 100).toFixed(1)}%`);

// Linha de base: chutar sempre a classe majoritaria.
const base = Math.max(positivos, exemplos.length - positivos) / exemplos.length;
console.log(`linha de base (classe majoritaria): ${(base * 100).toFixed(1)}%`);
console.log(loo > base ? "  o modelo aprende algo alem da frequencia" : "  NAO supera a linha de base");

// --- qualidade dos ROTULOS, antes de treinar em cima deles
//
// Metodo do cleanlab (aprendizado confiante): um modelo que nao viu o exemplo
// discorda dos rotulos errados com mais confianca do que discorda dos certos.
// Nao prova que o rotulo esta errado; produz uma fila de revisao ordenada por
// suspeita, e quem decide continua sendo gente.
const qualidade = analisarRotulos(exemplos, probForaDaAmostra);
console.log(`
qualidade dos rotulos`);
console.log(
  `  limiar por classe: falso ${qualidade.limiar.falso.toFixed(2)} | verdadeiro ${qualidade.limiar.verdadeiro.toFixed(2)}`,
);
const cj = qualidade.conjuntoConfiante;
console.log(`  conjunto confiante  rotulado falso     -> [falso ${cj.rotuladoFalso[0]}, verdadeiro ${cj.rotuladoFalso[1]}]`);
console.log(`                      rotulado verdadeiro-> [falso ${cj.rotuladoVerdadeiro[0]}, verdadeiro ${cj.rotuladoVerdadeiro[1]}]`);
console.log(`  taxa de ruido estimada: ${(qualidade.taxaDeRuido * 100).toFixed(1)}%`);
console.log(`  rotulos a revisar: ${qualidade.suspeitos.length} de ${exemplos.length}`);
for (const s of qualidade.suspeitos.slice(0, 8)) {
  console.log(
    `    ${s.discordanciaConfiante ? "DISCORDA " : "confianca"} ${s.ruleId.padEnd(34)} rotulo=${s.rotulo} ${s.porque}`,
  );
}
if (qualidade.suspeitos.length > 8) {
  console.log(`    ... e mais ${qualidade.suspeitos.length - 8}`);
}

// --- modelo final, treinado em tudo
const modelo = trainRanker(exemplos, {
  rounds: 40,
  version: `audit-${new Date().toISOString().slice(0, 7)}`,
  notes:
    `Treinado em ${exemplos.length} apontamentos rotulados a mao no repositorio CodeHero ` +
    `(agosto/2026). Acuracia leave-one-out ${(loo * 100).toFixed(1)}%, linha de base ` +
    `${(base * 100).toFixed(1)}%. Conjunto pequeno e de um unico acervo — serve como ` +
    `ponto de partida medido, nao como modelo geral.`,
});

console.log(`\nmodelo final: ${modelo.stumps.length} stumps | trainSize ${modelo.trainSize}`);
console.log(`  acuracia no proprio conjunto: ${(accuracy(modelo, exemplos) * 100).toFixed(1)}% (nao usar como prova)`);
console.log(`  precision@10 (falsos no topo): ${(precisionAtK(modelo, exemplos, 10) * 100).toFixed(1)}%`);

if (process.argv[2] === "--write") {
  fs.writeFileSync(saida, JSON.stringify(modelo, null, 2) + "\n");
  console.log(`\ngravado: ${saida}`);
  console.log(`  para usar:  HERO_RANKER_MODEL=${saida}  hero-scan .`);
  console.log("  o padrão continua sendo os priors genéricos (models/assertiveness.json)");
} else {
  console.log("\n(dry-run; use --write para gravar o artefato)");
}
