import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { parseStructural, matchStructural, buildSemanticIndex } from "../dist/index.js";
import { STRUCTURAL_RULES_BY_ID } from "../../contracts/dist/index.js";

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("  FALHA: " + msg); } };

// Projeto de mentira em disco: o Program do tsc precisa de arquivos reais.
const DIR = "./test/.tmp-semantic";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const FONTE = `export class Repo {
  async get(id: string): Promise<object> { return {}; }
}
const repo = new Repo();
const cache = new Map<string, number>();
const arr: number[] = [1, 2, 3];
export async function processa(ids: string[]) {
  for (const id of ids) {
    cache.get(id);
    arr.find((x) => x === 1);
    await repo.get(id);
  }
}
`;
const arquivo = DIR + "/alvo.ts";
writeFileSync(arquivo, FONTE);

console.log("=== alinhamento de posição tree-sitter <-> tsc ===");
const idx = await buildSemanticIndex([arquivo], { cwd: process.cwd() });
console.log(`  Program: ${idx.stats.files} arquivo(s), ${idx.stats.calls} chamada(s), ${idx.stats.ms}ms`);
check(idx.stats.calls > 0, "o Program tem de ver chamadas");

const rel = arquivo.replace(/^\.\//, "");
check(idx.covers(rel), `arquivo ${rel} deveria estar coberto`);

// Percorre as chamadas com o tree-sitter e cruza cada uma com o índice.
const parsed = await parseStructural(arquivo, FONTE);
const spec = { match: "call" };
const hits = matchStructural(parsed, spec);
console.log(`  tree-sitter encontrou ${hits.length} chamada(s)`);

let casados = 0;
for (const h of hits) {
  const fato = idx.at(rel, h.startLine, h.startColumn);
  if (fato) casados++;
  const marca = fato ? "ok  " : "SEM ";
  console.log(
    `  ${marca} ${String(h.startLine).padStart(2)}:${String(h.startColumn).padStart(2)} ` +
      `${h.snippet.slice(0, 26).padEnd(28)} ` +
      (fato
        ? `origem=${fato.origin.padEnd(10)} receptor=${String(fato.receiverType).padEnd(20)} async=${fato.awaitable}`
        : ""),
  );
}
check(casados >= 3, `as posições têm de casar; casaram ${casados} de ${hits.length}`);

console.log("\n=== o sinal que dispensa lista de nomes ===");
const porOrigem = {};
for (const h of hits) {
  const f = idx.at(rel, h.startLine, h.startColumn);
  if (!f) continue;
  const nome = h.snippet.split("(")[0];
  porOrigem[nome] = f.origin;
}
console.log("  " + JSON.stringify(porOrigem));
check(porOrigem["cache.get"] === "stdlib", `cache.get deveria ser stdlib, veio ${porOrigem["cache.get"]}`);
check(porOrigem["arr.find"] === "stdlib", `arr.find deveria ser stdlib, veio ${porOrigem["arr.find"]}`);
check(porOrigem["repo.get"] === "user", `repo.get deveria ser user, veio ${porOrigem["repo.get"]}`);


console.log("\n=== a regra que NAO tem lista de nomes ===");
const regra = STRUCTURAL_RULES_BY_ID["HERO-ST-0400-io-assincrono-em-laco"];
const comTipo = matchStructural(parsed, regra.spec, { semantic: idx, file: rel });
console.log(`  com tipo   -> ${comTipo.length} achado(s): ${comTipo.map((m) => m.snippet).join(", ")}`);
check(comTipo.length === 1, `so repo.get e I/O; vieram ${comTipo.length}`);
check(comTipo[0]?.snippet.includes("repo.get"), "o achado tem de ser repo.get");

// TRAVA: sem tipo a regra CALA. Sem isto ela e a versao que deu 103 achados.
const semTipo = matchStructural(parsed, regra.spec);
console.log(`  sem tipo   -> ${semTipo.length} achado(s) (deve ser 0: silencio honesto)`);
check(semTipo.length === 0, `sem semantica a regra tem de calar, vieram ${semTipo.length}`);

// A regra irma continua valendo sem tipo nenhum, nas 6 linguagens.
const irma = STRUCTURAL_RULES_BY_ID["HERO-ST-0489-call-em-laco"];
const sync = matchStructural(parsed, irma.spec);
console.log(`  regra irma (sem semantica) -> ${sync.length} achado(s)`);
check(sync.length === 0, `nenhum I/O sincrono nesta fixture, vieram ${sync.length}`);


console.log("\n=== eval global vs funcao do projeto chamada exec ===");
// A regra CRITICAL de code injection mira o `eval` GLOBAL. Uma funcao do
// proprio projeto chamada `exec()` (runner de teste, wrapper de CLI) nao e
// execucao dinamica — e so o tipo separa as duas, o texto e identico.
const FONTE2 = `export function exec(cmd: string) { return cmd; }
export function usa(x: string) {
  exec(x);
  return eval(x);
}
`;
const arq2 = DIR + "/evalvs.ts";
writeFileSync(arq2, FONTE2);
const rel2 = arq2.replace(/^\.\//, "");
const idx2 = await buildSemanticIndex([arq2], { cwd: process.cwd() });
const parsed2 = await parseStructural(arq2, FONTE2);
const specEval = STRUCTURAL_RULES_BY_ID["HERO-ST-0095-eval-non-literal"].spec;
const hits2 = matchStructural(parsed2, specEval, { semantic: idx2, file: rel2 });
console.log(`  achados -> ${hits2.length}: ${hits2.map((h) => h.snippet).join(", ")}`);
check(hits2.length === 1, `so o eval global conta, vieram ${hits2.length}`);
check(hits2[0]?.snippet.includes("eval"), "o achado tem de ser o eval global");

// Sem tipo (origin unknown) a regra NAO pode calar: e o caso do Python.
const semTipo2 = matchStructural(parsed2, specEval);
console.log(`  sem indice -> ${semTipo2.length} (os dois, por precaucao)`);
check(semTipo2.length === 2, `sem tipo mantem os dois, vieram ${semTipo2.length}`);

console.log("\n=== degradação sem typescript / arquivo não coberto ===");
const vazio = await buildSemanticIndex([], { cwd: process.cwd() });
check(vazio.at("x.ts", 1, 1) === null, "índice vazio devolve null, não lança");
check(vazio.covers("x.ts") === false, "índice vazio não cobre nada");
const gigante = await buildSemanticIndex(["a.ts"], { cwd: process.cwd(), maxFiles: 0 });
check(gigante.stats.calls === 0, "acima do teto, devolve índice vazio");
console.log("  ok — ausência de semântica degrada para 'sem informação'");

rmSync(DIR, { recursive: true, force: true });
console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
