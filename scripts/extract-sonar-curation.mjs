#!/usr/bin/env node
/**
 * Extrai a CURADORIA do conjunto Sonar Way para um arquivo explícito.
 *
 * O problema que isto resolve:
 *
 *   `sonarWayRules.json` é gerado (2668 regras, o catálogo Sonar Way inteiro).
 *   `sonarWayLiveRules.json` é o que realmente roda (431 regras) — e NÃO é uma
 *   cópia: 164 têm `pattern` afinado à mão e 70 têm `type` reclassificado.
 *
 * Ou seja, havia trabalho humano guardado num arquivo que nenhum script
 * produzia. Rodar o gerador o apagaria, em silêncio, e ninguém notaria até um
 * detector afinado voltar a ser o bruto.
 *
 * A saída torna a curadoria um DADO versionado:
 *
 *   selecao   quais regras do catálogo entram em produção
 *   ajustes   o delta de cada uma sobre o que o gerador produz
 *
 * Com isso o arquivo `live` deixa de ser fonte de verdade e passa a ser
 * DERIVADO: gerado + curadoria. Reconstruível, e a divergência vira erro de
 * teste em vez de descoberta arqueológica.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(RAIZ, "packages", "contracts", "src", "data");

const gerado = JSON.parse(readFileSync(join(DIR, "sonarWayRules.json"), "utf8"));
const live = JSON.parse(readFileSync(join(DIR, "sonarWayLiveRules.json"), "utf8"));

const porId = new Map(gerado.map((r) => [r.id, r]));

/** Campos que a curadoria pode sobrescrever. Qualquer outro é divergência. */
const AJUSTAVEIS = new Set(["pattern", "type", "severity", "message", "languages"]);

const selecao = [];
const ajustes = {};
const orfas = [];
const inesperados = [];

for (const l of live) {
  const g = porId.get(l.id);
  if (!g) {
    // Regra que não existe no catálogo gerado: entra inteira na curadoria,
    // senão some na reconstrução.
    orfas.push(l);
    continue;
  }
  selecao.push(l.id);
  const delta = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(g)])) {
    if (JSON.stringify(l[k]) === JSON.stringify(g[k])) continue;
    if (!AJUSTAVEIS.has(k)) {
      inesperados.push(`${l.id}.${k}`);
      continue;
    }
    delta[k] = l[k];
  }
  if (Object.keys(delta).length) ajustes[l.id] = delta;
}

console.log(`catálogo gerado : ${gerado.length}`);
console.log(`em produção     : ${live.length}`);
console.log(`  selecionadas do catálogo: ${selecao.length}`);
console.log(`  só em produção (órfãs)  : ${orfas.length}`);
console.log(`  com ajuste de curadoria : ${Object.keys(ajustes).length}`);

const porCampo = {};
for (const d of Object.values(ajustes)) for (const k of Object.keys(d)) porCampo[k] = (porCampo[k] ?? 0) + 1;
console.log(`  ajustes por campo: ${JSON.stringify(porCampo)}`);

if (inesperados.length) {
  console.error(`\ndivergência em campo NÃO ajustável (${inesperados.length}):`);
  for (const x of inesperados.slice(0, 10)) console.error(`  ${x}`);
  console.error("adicione o campo a AJUSTAVEIS ou corrija o gerador — reconstruir perderia isto.");
  process.exit(1);
}

const saida = join(DIR, "sonarWayCuration.json");
writeFileSync(
  saida,
  JSON.stringify(
    {
      _porque:
        "Curadoria humana sobre o catálogo Sonar Way gerado. `sonarWayLiveRules.json` " +
        "é DERIVADO deste arquivo mais `sonarWayRules.json` — não edite o live à mão: " +
        "rode `node scripts/build-sonar-live.mjs`.",
      selecao,
      orfas,
      ajustes,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\ngravado: ${saida}`);
