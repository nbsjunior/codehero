#!/usr/bin/env node
/**
 * Indução de corpus por acordo entre votantes, sobre código real.
 *
 * Dois modos:
 *
 *   --validar   roda no OWASP BenchmarkJava, onde EXISTE gabarito, e mede se a
 *               rotulagem não supervisionada concorda com a verdade que ela
 *               nunca viu. É a única forma honesta de saber se o método vale:
 *               um rotulador sem gabarito que ninguém conferiu contra gabarito
 *               nenhum é fé, não engenharia.
 *
 *   --dir <p>   roda numa base de código e emite os vereditos por regra.
 *
 * Bandeiras: --estado <arq> memória online; --gravar-casos <arq>;
 *            --regra <id> filtra; --limite <n> teto de arquivos.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { analyzeSource } from "../packages/scanner/dist/engine.js";
import { RULES } from "../packages/contracts/dist/index.js";
import { induzirCorpus, estadoVazio, votanteDeVotosGravados } from "../packages/ruleforge/dist/index.js";

const arg = (n, padrao) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const tem = (n) => process.argv.includes(n);

const EXTS = new Set([".java", ".js", ".ts", ".tsx", ".py", ".cs", ".go", ".cbl", ".cpy", ".sql"]);

function varrer(dir, limite, out = []) {
  if (out.length >= limite) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= limite) break;
    if (["node_modules", ".git", "dist", ".tmp", "out", "bundled", ".next"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) varrer(p, limite, out);
    else if (EXTS.has(extname(e.name).toLowerCase()) && statSync(p).size < 400_000) out.push(p);
  }
  return out;
}

function analisar(caminhos, filtroRegra) {
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
      if (filtroRegra && f.rule.id !== filtroRegra) continue;
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
  return arquivos;
}

// --- memória online ---------------------------------------------------------
const ARQ_ESTADO = arg("--estado", "packages/ruleforge/corpus/estado-votantes.json");
const estadoAnterior =
  existsSync(ARQ_ESTADO) && !tem("--zerar")
    ? JSON.parse(readFileSync(ARQ_ESTADO, "utf8"))
    : estadoVazio();

const filtro = arg("--regra", null);
const limite = Number(arg("--limite", "4000"));

// ===========================================================================
// MODO VALIDAR — mede a rotulagem contra o gabarito do OWASP
// ===========================================================================
if (tem("--validar")) {
  const BENCH = ".tmp/benchmark-java";
  const TESTCODE = join(BENCH, "src/main/java/org/owasp/benchmark/testcode");
  if (!existsSync(TESTCODE)) {
    console.error("acervo do OWASP ausente. clone em .tmp/benchmark-java");
    process.exit(1);
  }
  const csv = readFileSync(join(BENCH, "expectedresults-1.2.csv"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"));
  const gab = new Map();
  for (const l of csv) {
    const [n, , r, w] = l.split(",");
    gab.set(n.trim(), { real: r.trim() === "true", cwe: w.trim() });
  }

  const caminhos = readdirSync(TESTCODE)
    .filter((f) => f.endsWith(".java"))
    .slice(0, limite)
    .map((f) => join(TESTCODE, f));
  const arquivos = analisar(caminhos, filtro);

  console.log(`arquivos com apontamento: ${arquivos.length}`);

  // --- votante de leitura SIMULADO ---------------------------------------
  //
  // NÃO é um resultado do produto. É um experimento para responder uma
  // pergunta de custo antes de gastar: de que acurácia o votante de modelo
  // precisa para a indução passar a discriminar?
  //
  // Usa o gabarito para FABRICAR um leitor com acurácia dada, e só o voto
  // fabricado entra na indução — o gabarito não é visto por mais ninguém.
  // Se com um leitor de 80% a indução ganha do carimbo, vale contratar a
  // leitura; se nem com 95% ganha, o problema é dos outros votantes e gastar
  // com modelo seria dinheiro fora.
  // --- votos REAIS de modelo, gravados por coletar-votos-modelo.mjs -------
  const arqVotos = arg("--votos", null);
  let votantesExtras = [];
  if (arqVotos && existsSync(arqVotos)) {
    const mapa = new Map(Object.entries(JSON.parse(readFileSync(arqVotos, "utf8"))));
    votantesExtras = [votanteDeVotosGravados("leitura-de-modelo", mapa)];
    const d = { match: 0, no_match: 0, abst: 0 };
    for (const v of mapa.values()) d[v ?? "abst"]++;
    console.log(
      `\n[MODELO] ${mapa.size} votos gravados: PRESENTE=${d.match} AUSENTE=${d.no_match} INCERTO=${d.abst}`,
    );
  }

  const simular = arg("--simular-leitor", null);
  if (simular) {
    const acc = Number(simular);
    let s = 987654321;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
    const votos = new Map();
    for (const a of arquivos) {
      const nome = a.caminho.split(/[\\/]/).pop().replace(/\.java$/, "");
      const g = gab.get(nome);
      if (!g) continue;
      for (const ac of a.achados) {
        const cwes = (RULES.find((x) => x.id === ac.ruleId)?.cwe ?? []).map((c) => c.replace(/^CWE-/, ""));
        if (!cwes.includes(g.cwe)) continue; // fora da CWE o gabarito não fala
        const certo = rnd() < acc;
        const verdade = g.real;
        const v = certo ? verdade : !verdade;
        votos.set(`${a.caminho}:${ac.linha}:${ac.ruleId}`, v ? "match" : "no_match");
      }
    }
    votantesExtras = [votanteDeVotosGravados("leitura-simulada", votos)];
    console.log(`\n[SIMULACAO] leitor fabricado com ${(acc * 100).toFixed(0)}% de acurácia, ${votos.size} votos`);
  }

  const r = induzirCorpus(arquivos, RULES, { estadoAnterior, votantesExtras });

  console.log(`\ncandidatos: ${r.candidatosTotais} | EM convergiu em ${r.iteracoes} iterações`);
  console.log("\n=== qualidade estimada dos votantes (sem gabarito) ===");
  console.log("votante            | acurácia | viés                    | massa");
  console.log("-------------------+----------+-------------------------+------");
  for (const v of r.votantes) {
    console.log(
      v.votante.padEnd(19) +
        "|" +
        ((v.acuracia * 100).toFixed(1) + "%").padStart(9) +
        " | " +
        v.vieses.padEnd(24) +
        "|" +
        v.massa.toFixed(0).padStart(6),
    );
  }

  // --- a prova: o rótulo induzido bate com o gabarito? --------------------
  // O gabarito é por ARQUIVO e por CWE. Um caso induzido `match` num arquivo
  // que o OWASP diz não ser vulnerável naquela CWE é um rótulo errado.
  const cweDaRegra = new Map(RULES.map((x) => [x.id, (x.cwe ?? []).map((c) => c.replace(/^CWE-/, ""))]));
  let certo = 0;
  let errado = 0;
  const errosPorRegra = new Map();
  for (const caso of r.casos) {
    const m = /— (.+):(\d+)$/.exec(caso.note ?? "");
    if (!m) continue;
    const nome = m[1].split(/[\\/]/).pop().replace(/\.java$/, "");
    const g = gab.get(nome);
    if (!g) continue;
    const cwes = cweDaRegra.get(caso.ruleId) ?? [];
    if (!cwes.includes(g.cwe)) continue; // regra de outra CWE: gabarito não fala dela
    const induzido = caso.expected === "match";
    if (induzido === g.real) certo++;
    else {
      errado++;
      errosPorRegra.set(caso.ruleId, (errosPorRegra.get(caso.ruleId) ?? 0) + 1);
    }
  }
  // --- a comparação que impede autoengano --------------------------------
  // Rotulador que responde "match" para tudo acerta exatamente a PRECISÃO do
  // scanner. Se a indução não ganhar disso, ela não está rotulando nada: está
  // carimbando. Este número tem que aparecer ao lado, sempre, senão é fácil
  // ler 74% como sucesso.
  let trivialCerto = 0;
  let trivialTotal = 0;
  for (const c of candidatosComparaveis(r, gab, cweDaRegra)) {
    trivialTotal++;
    if (c.real) trivialCerto++;
  }

  const total = certo + errado;
  console.log("\n=== O TESTE DE VERDADE: rótulo induzido contra o gabarito do OWASP ===");
  console.log(`  casos induzidos comparáveis: ${total}`);
  if (total > 0) {
    console.log(`  concordam com o gabarito:    ${certo}  (${((certo * 100) / total).toFixed(1)}%)`);
    console.log(`  discordam:                   ${errado}`);
    if (trivialTotal > 0) {
      const triv = (trivialCerto * 100) / trivialTotal;
      console.log(`\n  LINHA DE COMPARAÇÃO — carimbar "match" em tudo: ${triv.toFixed(1)}%`);
      const ganho = (certo * 100) / total - triv;
      console.log(
        `  ganho da indução sobre o carimbo:  ${ganho >= 0 ? "+" : ""}${ganho.toFixed(1)} ponto(s)` +
          (ganho < 2 ? "   <= sem ganho: a indução não está discriminando" : ""),
      );
    }
    if (errosPorRegra.size) {
      console.log("  regras onde mais erra:");
      for (const [k, v] of [...errosPorRegra.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5))
        console.log(`     ${String(v).padStart(4)}x  ${k}`);
    }
  }
  console.log(`\n  casos induzidos no total:    ${r.casos.length}`);
  console.log(`     match:    ${r.casos.filter((c) => c.expected === "match").length}`);
  console.log(`     no_match: ${r.casos.filter((c) => c.expected === "no_match").length}`);

  gravar(r);
  process.exit(0);
}

/** Casos induzidos que dá para conferir contra o gabarito, com a verdade junto. */
function candidatosComparaveis(res, gab, cweDaRegra) {
  const out = [];
  for (const caso of res.casos) {
    const m = /— (.+):(\d+)$/.exec(caso.note ?? "");
    if (!m) continue;
    const nome = m[1].split(/[\\/]/).pop().replace(/\.java$/, "");
    const g = gab.get(nome);
    if (!g) continue;
    if (!(cweDaRegra.get(caso.ruleId) ?? []).includes(g.cwe)) continue;
    out.push({ ruleId: caso.ruleId, induzido: caso.expected === "match", real: g.real });
  }
  return out;
}

// ===========================================================================
// MODO PADRÃO — vereditos sobre uma base de código
// ===========================================================================
const dir = arg("--dir", ".");
const caminhos = varrer(dir, limite);
console.log(`varridos ${caminhos.length} arquivos em ${dir}`);
const arquivos = analisar(caminhos, filtro);
console.log(`com apontamento: ${arquivos.length}`);

const r = induzirCorpus(arquivos, RULES, { estadoAnterior });
console.log(`candidatos: ${r.candidatosTotais} | EM em ${r.iteracoes} iterações`);

console.log("\n=== qualidade estimada dos votantes ===");
for (const v of r.votantes)
  console.log(
    "  " + v.votante.padEnd(19) + ((v.acuracia * 100).toFixed(1) + "%").padStart(7) + "  " + v.vieses,
  );

const porVeredito = new Map();
for (const v of r.vereditos) porVeredito.set(v.veredito, (porVeredito.get(v.veredito) ?? 0) + 1);
console.log("\n=== vereditos ===");
for (const [k, v] of porVeredito) console.log("  " + k.padEnd(16) + String(v).padStart(5));

console.log("\n=== regras com mais evidência ===");
console.log("regra                                        | cand | conf | refu | precisão | veredito");
for (const v of r.vereditos.slice(0, 20)) {
  console.log(
    v.ruleId.slice(0, 44).padEnd(45) +
      "|" +
      String(v.candidatos).padStart(5) +
      " |" +
      String(v.confirmados).padStart(5) +
      " |" +
      String(v.refutados).padStart(5) +
      " |" +
      (v.precisaoInduzida === null ? "     -   " : ((v.precisaoInduzida * 100).toFixed(0) + "%").padStart(9)) +
      " | " +
      v.veredito,
  );
}

gravar(r);

function gravar(res) {
  mkdirSync(dirname(ARQ_ESTADO), { recursive: true });
  writeFileSync(ARQ_ESTADO, JSON.stringify(res.estado, null, 2) + "\n");
  console.log(`\nmemória online gravada: ${ARQ_ESTADO} (${res.estado.rodadas} rodada(s), ${res.estado.candidatosVistos} candidatos)`);
  const saida = arg("--gravar-casos", null);
  if (saida) {
    writeFileSync(saida, JSON.stringify(res.casos, null, 2) + "\n");
    console.log(`casos induzidos: ${saida} (${res.casos.length})`);
  }
}
