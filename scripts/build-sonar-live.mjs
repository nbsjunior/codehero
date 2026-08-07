#!/usr/bin/env node
/**
 * Reconstrói `sonarWayLiveRules.json` — o conjunto que o motor carrega.
 *
 *   live = selecionar(catálogo gerado, curadoria.selecao) + curadoria.ajustes
 *
 * Antes disto o `live` era editado à mão e o gerador escrevia OUTRO arquivo,
 * então havia dois lugares dizendo a mesma coisa e nenhum mandava. Agora o
 * `live` é DERIVADO: quem quiser mudar uma regra em produção mexe no gerador
 * (se o defeito é do catálogo) ou na curadoria (se é decisão nossa) — e roda
 * este script.
 *
 * `--check` não escreve: compara e falha se o arquivo em disco divergir do que
 * seria reconstruído. É o que impede a divergência de voltar sem ninguém ver.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(RAIZ, "packages", "contracts", "src", "data");
const ALVO = join(DIR, "sonarWayLiveRules.json");

const gerado = JSON.parse(readFileSync(join(DIR, "sonarWayRules.json"), "utf8"));
const curadoria = JSON.parse(readFileSync(join(DIR, "sonarWayCuration.json"), "utf8"));

const porId = new Map(gerado.map((r) => [r.id, r]));

const faltando = curadoria.selecao.filter((id) => !porId.has(id));
if (faltando.length) {
  console.error(`${faltando.length} regra(s) selecionada(s) não existem mais no catálogo gerado:`);
  for (const id of faltando.slice(0, 10)) console.error(`  ${id}`);
  console.error("o catálogo mudou: revise a seleção em sonarWayCuration.json.");
  process.exit(1);
}

const live = [
  ...curadoria.selecao.map((id) => ({ ...porId.get(id), ...(curadoria.ajustes[id] ?? {}) })),
  ...(curadoria.orfas ?? []),
];

// Mesma serialização compacta que o arquivo em produção já usava — o objetivo
// é reconstruir o mesmo dado, não reformatá-lo.
const texto = JSON.stringify(live);

if (process.argv.includes("--check")) {
  const atual = readFileSync(ALVO, "utf8");
  if (normaliza(atual) === normaliza(texto)) {
    console.log(`ok: ${ALVO} confere com gerado + curadoria (${live.length} regras)`);
    process.exit(0);
  }
  console.error("DIVERGÊNCIA: sonarWayLiveRules.json não corresponde a gerado + curadoria.");
  console.error(diagnostico(JSON.parse(atual), live));
  console.error("\nrode: node scripts/build-sonar-live.mjs");
  process.exit(1);
}

writeFileSync(ALVO, texto);
console.log(`gravado: ${ALVO} (${live.length} regras)`);

/** Compara CONTEÚDO, não formatação. */
function normaliza(s) {
  return JSON.stringify(JSON.parse(s));
}

/** Diz o que mudou, para o erro ser acionável em vez de só vermelho. */
function diagnostico(atual, esperado) {
  const a = new Map(atual.map((r) => [r.id, r]));
  const e = new Map(esperado.map((r) => [r.id, r]));
  const linhas = [];
  for (const id of a.keys()) if (!e.has(id)) linhas.push(`  só no arquivo: ${id}`);
  for (const id of e.keys()) if (!a.has(id)) linhas.push(`  só em gerado+curadoria: ${id}`);
  for (const [id, ra] of a) {
    const re = e.get(id);
    if (!re) continue;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(re)])) {
      if (JSON.stringify(ra[k]) !== JSON.stringify(re[k])) {
        linhas.push(`  ${id}.${k} difere`);
        break;
      }
    }
  }
  return linhas.slice(0, 15).join("\n") + (linhas.length > 15 ? `\n  … e mais ${linhas.length - 15}` : "");
}
