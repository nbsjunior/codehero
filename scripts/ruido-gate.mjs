#!/usr/bin/env node
/**
 * Mede o RUÍDO em código real e bem mantido, e reprova quando piora.
 *
 * Por que este portão precisa existir ao lado do OWASP
 * ---------------------------------------------------------------------------
 * O portão do OWASP mede se a regra reconhece o defeito que alguém plantou.
 * É útil e é insuficiente: um acervo sintético não tem o idioma do código de
 * verdade, então uma regra que casa o ASSUNTO em vez do DEFEITO passa por ele
 * sem deixar rastro.
 *
 * Foi exatamente o que aconteceu. Com precisão de 75.6% no OWASP, uma varredura
 * em quatro projetos reais devolveu:
 *
 *     axios   15.7 BLOCKER/CRITICAL por mil linhas
 *     gson    66.6 achados por mil linhas
 *
 * e 73% dos graves vinham de UMA regra — `SONAR-js-S2083`, BLOCKER, cujo regex
 * casa `../` cru, ou seja, todo import relativo em JavaScript. Nenhuma delas
 * tem caso no corpus, então nada as pegava.
 *
 * O sinal que denuncia a regra doente
 * ---------------------------------------------------------------------------
 * Não é o total de achados — projeto grande tem mais achado, e tudo bem. É a
 * FRAÇÃO DE ARQUIVOS TOCADOS na própria linguagem.
 *
 * Defeito de verdade é raro e concentrado: aparece em alguns arquivos. Regra
 * que casa o assunto aparece em quase todos, porque o assunto está em toda
 * parte. `S1128` casa `^import` e tocou 100% dos arquivos Java do gson; nenhum
 * projeto tem import desnecessário em cada arquivo.
 *
 * Uso:
 *   node scripts/ruido-gate.mjs            compara com a linha de base
 *   node scripts/ruido-gate.mjs --gravar   regrava (ato deliberado)
 *   node scripts/ruido-gate.mjs --exige-acervo   reprova se faltar o acervo
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { analyzeSource } from "../packages/scanner/dist/engine.js";
import { RULES } from "../packages/contracts/dist/index.js";

const ACERVO = ".tmp/real";
const LINHA_BASE = "benchmarks/ruido-baseline.json";
const GRAVAR = process.argv.includes("--gravar");
const EXIGE = process.argv.includes("--exige-acervo");

/**
 * Os projetos do acervo. Escolhidos por serem MADUROS e MUITO revisados: se o
 * CodeHero grita num deles, o problema é do CodeHero. Repositório abandonado
 * não serve — ali achado demais pode ser verdade.
 */
export const PROJETOS = [
  { nome: "express", url: "https://github.com/expressjs/express.git" },
  { nome: "axios", url: "https://github.com/axios/axios.git" },
  { nome: "flask", url: "https://github.com/pallets/flask.git" },
  { nome: "gson", url: "https://github.com/google/gson.git" },
];

const EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".cs"]);
const PULAR = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", "vendor", "target",
  // Teste e exemplo têm código propositalmente estranho — medir ruído neles
  // culparia a ferramenta por ler um arquivo escrito para ser esquisito.
  "test", "tests", "__tests__", "spec", "examples", "docs", "benchmark", "benchmarks",
]);

const LINGUAGEM = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".py": "python", ".java": "java",
  ".go": "go", ".cs": "csharp",
};

// --- limiares ---------------------------------------------------------------
//
// `TOCA_DEMAIS` é o número que denuncia regra doente. Um quarto dos arquivos
// da linguagem é generoso: mesmo um smell comum (import não usado, variável
// morta) não aparece em um a cada quatro arquivos de um projeto revisado.
const TOCA_DEMAIS = 0.25;
/** Grave é mais estreito: BLOCKER reprova build, e não pode ser rotina. */
const TOCA_DEMAIS_GRAVE = 0.05;
/**
 * Minimo de arquivos tocados para a acusacao valer.
 *
 * Sem isto, projeto com poucos arquivos numa linguagem gera fracao alta por
 * acidente aritmetico. Cinco arquivos e o piso para a fracao significar algo.
 */
const MIN_ARQUIVOS_PARA_ACUSAR = 5;

/** Piora tolerada de graves por mil linhas, contra a linha de base. */
const TOL_GRAVES_KLOC = 0.3;

const GRAVE = new Set(["BLOCKER", "CRITICAL"]);
const sevDe = new Map(RULES.map((r) => [r.id, r.severity]));

function coletar(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (PULAR.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) coletar(p, out);
    else if (EXTS.has(extname(e.name).toLowerCase())) {
      try {
        if (statSync(p).size < 400_000) out.push(p);
      } catch {
        /* arquivo sumiu entre listar e medir: ignora */
      }
    }
  }
  return out;
}

/** Minificado não é código de ninguém e conta como se fosse. */
function pareceGerado(fonte) {
  const linhas = fonte.split(/\r?\n/);
  return fonte.length / Math.max(linhas.length, 1) > 200;
}

function medir() {
  const porRegra = new Map(); // id -> { hits, arquivos:Set, projetos:Set }
  const arquivosPorLinguagem = new Map();
  let loc = 0;
  let total = 0;
  let graves = 0;
  const porProjeto = [];

  for (const p of PROJETOS) {
    const base = join(ACERVO, p.nome);
    if (!existsSync(base)) continue;
    const arquivos = coletar(base);
    let locP = 0;
    let totalP = 0;
    let gravesP = 0;

    for (const f of arquivos) {
      let src;
      try {
        src = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (pareceGerado(src)) continue;
      const linhas = src.split(/\r?\n/);
      locP += linhas.filter((l) => l.trim()).length;

      const lang = LINGUAGEM[extname(f).toLowerCase()] ?? "outra";
      arquivosPorLinguagem.set(lang, (arquivosPorLinguagem.get(lang) ?? 0) + 1);

      const rel = relative(base, f).split("\\").join("/");
      const vistasNoArquivo = new Set();
      for (const a of analyzeSource(rel, src)) {
        totalP++;
        const sev = sevDe.get(a.rule.id) ?? a.rule.severity;
        if (GRAVE.has(sev)) gravesP++;
        const r =
          porRegra.get(a.rule.id) ??
          porRegra.set(a.rule.id, { hits: 0, arquivos: new Set(), lang, sev }).get(a.rule.id);
        r.hits++;
        if (!vistasNoArquivo.has(a.rule.id)) {
          r.arquivos.add(`${p.nome}/${rel}`);
          vistasNoArquivo.add(a.rule.id);
        }
      }
    }

    loc += locP;
    total += totalP;
    graves += gravesP;
    porProjeto.push({
      nome: p.nome,
      arquivos: arquivos.length,
      loc: locP,
      achados: totalP,
      graves: gravesP,
      porKloc: locP ? Number(((totalP / locP) * 1000).toFixed(1)) : 0,
      gravesPorKloc: locP ? Number(((gravesP / locP) * 1000).toFixed(1)) : 0,
    });
  }

  // --- regras que tocam arquivos demais ------------------------------------
  const suspeitas = [];
  for (const [id, r] of porRegra) {
    const totalDaLinguagem = arquivosPorLinguagem.get(r.lang) ?? 0;
    if (totalDaLinguagem < 10) continue; // amostra pequena não acusa ninguém
    const fracao = r.arquivos.size / totalDaLinguagem;
    const limite = GRAVE.has(r.sev) ? TOCA_DEMAIS_GRAVE : TOCA_DEMAIS;
    // Fração alta com POUCOS arquivos é ruído da estatística, não da regra.
    //
    // A primeira execução acusou duas regras honestas por isso: o Flask tem 24
    // arquivos Python, e `eval(compile(f.read(), ...))` em dois deles dá 8% —
    // acima do limiar de grave. Só que os dois achados estão CERTOS, é
    // execução de código lido de arquivo. Um portão que acusa regra boa é pior
    // que portão nenhum: ensina o time a ignorar o vermelho.
    if (r.arquivos.size >= MIN_ARQUIVOS_PARA_ACUSAR && fracao > limite) {
      suspeitas.push({
        id,
        sev: r.sev,
        lang: r.lang,
        hits: r.hits,
        arquivos: r.arquivos.size,
        deArquivos: totalDaLinguagem,
        fracao: Number(fracao.toFixed(3)),
        limite,
      });
    }
  }
  suspeitas.sort((a, b) => b.fracao - a.fracao);

  return {
    loc,
    total,
    graves,
    porKloc: loc ? Number(((total / loc) * 1000).toFixed(1)) : 0,
    gravesPorKloc: loc ? Number(((graves / loc) * 1000).toFixed(1)) : 0,
    porProjeto,
    suspeitas,
  };
}

// --- acervo presente? -------------------------------------------------------
const presentes = PROJETOS.filter((p) => existsSync(join(ACERVO, p.nome)));
if (presentes.length === 0) {
  const recado =
    `acervo de código real ausente em ${ACERVO}\n` +
    "  para medir localmente:\n" +
    PROJETOS.map((p) => `    git clone --depth 1 ${p.url} ${ACERVO}/${p.nome}`).join("\n");
  if (EXIGE) {
    console.error(`reprovado: ${recado}`);
    process.exit(1);
  }
  console.log(`pulando: ${recado}`);
  process.exit(0);
}

const inicio = Date.now();
const atual = medir();

console.log("projeto    | arquivos |    LOC | achados | /KLOC | graves | graves/KLOC");
console.log("-----------+----------+--------+---------+-------+--------+------------");
for (const p of atual.porProjeto) {
  console.log(
    p.nome.padEnd(10) +
      " |" + String(p.arquivos).padStart(9) +
      " |" + String(p.loc).padStart(7) +
      " |" + String(p.achados).padStart(8) +
      " |" + String(p.porKloc).padStart(6) +
      " |" + String(p.graves).padStart(7) +
      " |" + String(p.gravesPorKloc).padStart(12),
  );
}
console.log("-----------+----------+--------+---------+-------+--------+------------");
console.log(
  "TOTAL".padEnd(10) +
    " |" + "".padStart(9) +
    " |" + String(atual.loc).padStart(7) +
    " |" + String(atual.total).padStart(8) +
    " |" + String(atual.porKloc).padStart(6) +
    " |" + String(atual.graves).padStart(7) +
    " |" + String(atual.gravesPorKloc).padStart(12),
);
console.log(`\n${atual.porProjeto.length} projeto(s) em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

if (atual.suspeitas.length) {
  console.log("\n=== regras que tocam arquivos DEMAIS (casam o assunto, não o defeito) ===");
  console.log("regra                          | sev      | arquivos       | limite");
  for (const s of atual.suspeitas.slice(0, 20)) {
    console.log(
      "  " + s.id.slice(0, 28).padEnd(28) +
        " | " + s.sev.padEnd(8) +
        " | " + `${s.arquivos}/${s.deArquivos} (${(s.fracao * 100).toFixed(0)}%)`.padEnd(14) +
        " | " + `${(s.limite * 100).toFixed(0)}%`,
    );
  }
}

// --- grava --------------------------------------------------------------------
if (GRAVAR) {
  mkdirSync("benchmarks", { recursive: true });
  writeFileSync(
    LINHA_BASE,
    JSON.stringify(
      {
        _porque:
          "Ruido em codigo real e bem mantido. Regravar e ato deliberado: so faca " +
          "depois de conferir que a mudanca de numero e melhoria, e diga no commit por que.",
        _medidoEm: new Date().toISOString().slice(0, 10),
        projetos: PROJETOS.map((p) => p.nome),
        ...atual,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nlinha de base gravada: ${LINHA_BASE}`);
  process.exit(0);
}

// --- compara ------------------------------------------------------------------
if (!existsSync(LINHA_BASE)) {
  console.error(`\nsem linha de base. Grave a primeira com:  node ${process.argv[1]} --gravar`);
  process.exit(1);
}
const base = JSON.parse(readFileSync(LINHA_BASE, "utf8"));

const quedas = [];
const dGraves = atual.gravesPorKloc - base.gravesPorKloc;
if (dGraves > TOL_GRAVES_KLOC) {
  quedas.push(
    `graves por mil linhas subiu ${dGraves.toFixed(1)}: ${base.gravesPorKloc} -> ${atual.gravesPorKloc}. ` +
      "É o número que decide se o time deixa o gate ligado.",
  );
}
const novas = atual.suspeitas.filter((s) => !(base.suspeitas ?? []).some((b) => b.id === s.id));
if (novas.length) {
  quedas.push(
    `regra(s) nova(s) tocando arquivos demais: ${novas.map((s) => `${s.id} (${(s.fracao * 100).toFixed(0)}%)`).join(", ")}`,
  );
}

console.log("\n--- contra a linha de base ---");
console.log(`  achados/KLOC   ${base.porKloc} -> ${atual.porKloc}`);
console.log(`  graves/KLOC    ${base.gravesPorKloc} -> ${atual.gravesPorKloc}  (${dGraves >= 0 ? "+" : ""}${dGraves.toFixed(1)})`);
console.log(`  regras ruidosas ${(base.suspeitas ?? []).length} -> ${atual.suspeitas.length}`);

if (quedas.length) {
  console.error("\nREPROVADO:");
  for (const q of quedas) console.error(`  - ${q}`);
  console.error("\nSe a piora for troca consciente, regrave com --gravar e explique no commit.");
  process.exit(1);
}
console.log("\nok: sem regressão de ruído");
