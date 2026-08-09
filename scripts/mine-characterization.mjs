#!/usr/bin/env node
/**
 * Extrai casos de CARACTERIZAÇÃO a partir de código real.
 *
 * O PORQUÊ, e a distinção que não pode ser perdida
 * ---------------------------------------------------------------------------
 * O corpus dourado (`corpus/golden.json`) diz o que a regra DEVERIA fazer.
 * Cada caso ali foi escrito por uma pessoa que decidiu, para aquele trecho, se
 * o apontamento é certo ou errado. São 84 casos cobrindo 28 das 501 regras.
 *
 * Este arquivo produz outra coisa, e é importante não confundir: ele pega um
 * trecho REAL que a regra casa hoje e congela esse comportamento. Não afirma
 * que o apontamento está correto. Afirma que ele existe.
 *
 * Isso pega uma classe inteira de defeito que hoje passa em silêncio: a regra
 * que PARA de achar o que achava. Não pega a regra que acha errado, e chamar
 * isso de "cobertura de teste" seria inflar o número.
 *
 * Por isso mora em arquivo separado, com carregador separado, e o relatório
 * conta os dois em linhas diferentes.
 *
 * ORÇAMENTO DE VOLUME
 * ---------------------------------------------------------------------------
 * Junto de cada caso vai quantas vezes a regra dispara no acervo. Foi assim
 * que 650 falsos positivos entraram de uma vez neste projeto: uma regex de
 * cripto sem `\b` passou a casar dentro de "MODES" e "candidates". O número de
 * acertos explodiu e ninguém viu. Com o orçamento gravado, uma explosão dessas
 * vira falha de teste.
 *
 * SEGREDO NÃO É CAPTURADO
 * ---------------------------------------------------------------------------
 * Regras de credencial casam justamente a linha que contém a credencial.
 * Gravar esse trecho num arquivo versionado publicaria o segredo. As famílias
 * de segredo são puladas, e nenhuma exceção vale a pena aqui.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import {
  RULES,
  matchPattern,
  buildLexicalMask,
  lexicalProfileFor,
} from "../packages/contracts/dist/index.js";

/** Famílias cujo trecho casado É o segredo. Nunca capturar. */
const NAO_CAPTURAR = /secret|password|passwd|credential|token|api[_-]?key|private[_-]?key|0798|S2068|S2053|gitleaks/i;

/**
 * Segundo guarda, e o que realmente importa: o CONTEÚDO da linha.
 *
 * A primeira versão filtrava só pelo id da regra, e vazou. Uma linha com
 * credencial e apontada por vinte regras diferentes entra pelas dezenove que
 * não têm "secret" no nome. Aqui era chave falsa de arquivo de exemplo; num
 * repositório de cliente seria um segredo real indo para arquivo versionado.
 *
 * O filtro tem de ser sobre o texto, porque é o texto que vaza.
 */
const PARECE_CREDENCIAL =
  /(?:secret|passwd|password|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret|aws_[a-z_]*key|bearer)\s*[:=]\s*['"][^'"]{6,}/i;

/** Formatos de chave que se reconhecem sozinhos, sem precisar do nome ao lado. */
const FORMATO_DE_CHAVE = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
];

function contemSegredo(texto) {
  if (PARECE_CREDENCIAL.test(texto)) return true;
  return FORMATO_DE_CHAVE.some((re) => re.test(texto));
}

const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".go", ".cs", ".vb",
  ".cbl", ".cob", ".cpy", ".sql", ".db2",
]);
const IGNORA = new Set([
  "node_modules", ".git", "dist", "out", "build", ".next", ".firebase",
  "_next", "coverage", "vendor", "reports", ".codehero-cache",
  // Rascunho de trabalho: acervo baixado para medicao (OWASP Benchmark e
  // afins). Medir o orcamento sobre ele faria o numero variar conforme o que
  // esta baixado no momento, e o orcamento so serve se for estavel.
  ".tmp",
]);

function varre(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const nome of entradas) {
    if (IGNORA.has(nome)) continue;
    const p = join(dir, nome);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) varre(p, acc);
    else if (EXTS.has(extname(nome)) && st.size < 400_000) acc.push(p);
  }
  return acc;
}

const raiz = process.argv[2] ?? ".";
const arquivos = varre(raiz).sort(); // ordenado: a extração precisa ser reproduzível

const fontes = [];
for (const f of arquivos) {
  try {
    const src = readFileSync(f, "utf8");
    fontes.push({
      arquivo: relative(raiz, f).replace(/\\/g, "/"),
      linhas: src.split("\n").map((l) => l.replace(/\r$/, "")),
      src,
      perfil: lexicalProfileFor(f),
      mask: buildLexicalMask(src, lexicalProfileFor(f)),
    });
  } catch {
    /* arquivo ilegível não invalida a extração */
  }
}

console.log(`acervo: ${fontes.length} arquivo(s) sob ${raiz}\n`);

const casos = [];
const orcamentos = [];
let pulados = 0;
let semAcerto = 0;
let comSegredo = 0;

for (const regra of RULES) {
  if (!regra.pattern?.regex) continue;

  let total = 0;
  let primeiro = null;

  for (const f of fontes) {
    let ms;
    try {
      ms = matchPattern(regra.pattern, f.src, { mask: f.mask });
    } catch {
      continue;
    }
    total += ms.length;
    if (!primeiro && ms.length) {
      const linha = f.linhas[ms[0].line - 1] ?? "";
      primeiro = { arquivo: f.arquivo, linha: ms[0].line, texto: linha.trim(), perfil: f.perfil };
    }
  }

  if (total === 0) {
    semAcerto++;
    continue;
  }

  // Orçamento vale para toda regra que dispara, inclusive as de segredo:
  // o número não revela o segredo.
  orcamentos.push({ ruleId: regra.id, acertos: total, severidade: regra.severity });

  if (NAO_CAPTURAR.test(regra.id)) {
    pulados++;
    continue;
  }
  // Linha vazia ou curta demais não caracteriza nada.
  if (!primeiro || primeiro.texto.length < 8) continue;
  // Guarda de conteúdo: vale para QUALQUER regra, não só as de segredo.
  if (contemSegredo(primeiro.texto)) {
    comSegredo++;
    continue;
  }

  casos.push({
    id: `car-${regra.id}`,
    ruleId: regra.id,
    expected: "match",
    code: primeiro.texto.slice(0, 400),
    profile: primeiro.perfil,
    note: `caracterizacao: extraido de ${primeiro.arquivo}:${primeiro.linha}. Congela o comportamento atual, nao afirma que o apontamento esta correto.`,
  });
}

// Confere que cada caso extraído realmente casa isoladamente. Uma linha pode
// casar no arquivo inteiro e não casar sozinha, quando a regra depende de
// contexto de várias linhas. Esses casos não servem e saem fora.
const validos = [];
let descartados = 0;
for (const c of casos) {
  const regra = RULES.find((r) => r.id === c.ruleId);
  let casa = false;
  try {
    casa = matchPattern(regra.pattern, c.code, { profile: c.profile }).length > 0;
  } catch {
    /* regex inválida cai fora */
  }
  if (casa) validos.push(c);
  else descartados++;
}

const regrasComRegex = RULES.filter((r) => r.pattern?.regex).length;
console.log(`regras com detector          : ${regrasComRegex}`);
console.log(`  disparam no acervo         : ${regrasComRegex - semAcerto}`);
console.log(`  nunca disparam aqui        : ${semAcerto}`);
console.log(`  puladas (familia de segredo): ${pulados}`);
console.log(`  puladas (linha com credencial): ${comSegredo}`);
console.log(`\ncasos de caracterizacao      : ${validos.length}`);
console.log(`  descartados (nao casam sozinhos): ${descartados}`);
console.log(`orcamentos de volume         : ${orcamentos.length}`);

const saida = {
  _porque:
    "Casos de CARACTERIZACAO, nao dourados. Cada um congela um apontamento que a regra " +
    "produz hoje sobre codigo real. Serve para detectar a regra que PARA de achar o que " +
    "achava. NAO afirma que o apontamento esta correto: para isso existe golden.json, " +
    "onde uma pessoa decidiu caso a caso. Nunca some os dois numeros como se fossem a " +
    "mesma coisa.",
  _geradoPor: "node scripts/mine-characterization.mjs",
  _acervo: { raiz, arquivos: fontes.length },
  casos: validos,
  orcamentos: orcamentos.sort((a, b) => b.acertos - a.acertos),
};

const destino = "packages/ruleforge/corpus/characterization.json";

// --- modo conferencia ------------------------------------------------------
//
// Reconta e compara com o arquivo gravado em vez de sobrescrever. E aqui que o
// orcamento de volume vira guarda de verdade: se uma regra passou a achar
// muito mais do que achava, isso reprova.
//
// A margem existe porque o acervo muda a cada commit, e exigir o numero exato
// faria o teste falhar por qualquer arquivo novo. O que precisa soar alarme e
// a EXPLOSAO, do tipo que trouxe 650 falsos positivos de uma vez, e nao a
// variacao normal.
if (process.argv.includes("--check")) {
  const gravado = JSON.parse(readFileSync(destino, "utf8"));
  const antes = new Map(gravado.orcamentos.map((o) => [o.ruleId, o.acertos]));
  // Dois criterios, porque um so nao cobre os dois formatos de regressao.
  //
  //   RAZAO    pega a regra que salta de pouco para muito. Foi o caso dos 650
  //            falsos positivos: uma regra que quase nao disparava passou a
  //            disparar em todo lugar.
  //   ABSOLUTO pega a regra ja volumosa que ganha dezenas de acertos novos.
  //            So a razao nao pegaria: 376 para 420 e 1,1x e passaria batido.
  //
  // O QUE ISTO NAO PEGA, e precisa ser dito: alargamento pequeno em regra
  // volumosa. Uma que vai de 376 para 380 fica abaixo dos dois criterios, e
  // baixar os limiares a esse ponto faria o guarda gritar a cada arquivo novo.
  // Esse caso e coberto por `scripts/audit-detectors.mjs`, que olha se o
  // casamento caiu no meio de um identificador em vez de olhar o volume.
  const FATOR = 3;
  const PISO = 5;
  const DELTA_ABSOLUTO = 25;
  const RAZAO_MINIMA = 1.25;

  const estouros = [];
  for (const o of orcamentos) {
    const anterior = antes.get(o.ruleId);
    if (anterior === undefined) continue; // regra nova, sem base de comparacao
    const delta = o.acertos - anterior;
    const razao = anterior > 0 ? o.acertos / anterior : Infinity;

    const saltoRelativo = o.acertos >= PISO && o.acertos > anterior * FATOR;
    const saltoAbsoluto = delta >= DELTA_ABSOLUTO && razao >= RAZAO_MINIMA;

    if (saltoRelativo || saltoAbsoluto) {
      estouros.push({
        ruleId: o.ruleId,
        antes: anterior,
        agora: o.acertos,
        sev: o.severidade,
        motivo: saltoRelativo ? `${razao.toFixed(1)}x` : `+${delta} acertos`,
      });
    }
  }

  const idsAgora = new Set(orcamentos.map((o) => o.ruleId));
  const pararam = [...antes.keys()].filter((id) => !idsAgora.has(id));

  console.log("\n--- conferencia ---");
  console.log(`regras que disparavam: ${antes.size} | disparam agora: ${orcamentos.length}`);
  console.log(`explosoes de volume (mais de ${FATOR}x): ${estouros.length}`);
  for (const e of estouros) {
    console.log(`  [${e.sev}] ${e.ruleId}: ${e.antes} -> ${e.agora} acertos`);
  }
  if (pararam.length) {
    console.log(`regras que PARARAM de disparar: ${pararam.length}`);
    for (const id of pararam.slice(0, 10)) console.log(`  ${id}`);
  }

  if (estouros.length) {
    console.error(
      `\nreprovado: ${estouros.length} regra(s) passaram a apontar muito mais que antes. ` +
        "Confirme se o detector abriu demais. Se o aumento for legitimo, regrave o " +
        "orcamento rodando o script sem --check.",
    );
    process.exit(1);
  }
  console.log("\nok: nenhuma explosao de volume");
  process.exit(0);
}

writeFileSync(destino, JSON.stringify(saida, null, 2) + "\n");
console.log(`\ngravado: ${destino}`);
