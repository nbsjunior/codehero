import { analisarArquitetura } from "../dist/arquitetura.js";

// ---------------------------------------------------------------------------
// O nucleo da leitura arquitetural nao tinha teste nenhum.
//
// Tarjan, Ca/Ce e instabilidade estavam sem guarda, e sao exatamente o tipo de
// codigo que quebra em silencio: um ciclo que deixa de ser detectado nao
// aparece como erro, aparece como "este repositorio nao tem ciclo nenhum", que
// e a resposta que todo mundo quer ouvir.
//
// Grafo sintetico de proposito. Com um grafo real eu estaria testando contra
// numeros que eu mesmo produzi; aqui a resposta certa e conhecida antes de
// rodar.
// ---------------------------------------------------------------------------

let falhas = 0;
const check = (ok, msg, detalhe = "") => {
  if (!ok) {
    falhas++;
    console.log("  FALHA: " + msg + (detalhe ? "  " + detalhe : ""));
  }
};

const arquivoNo = (f) => ({ id: `file:${f}`, kind: "file", file: f, name: f });
const importa = (de, para, interno = true) => ({
  from: `file:${de}`,
  to: interno ? `file:${para}` : `module:${para}`,
  kind: "imports",
  resolved: interno ? "user" : "unknown",
});

function grafo(arquivos, arestas, entradas = []) {
  const nodes = arquivos.map(arquivoNo);
  for (const e of arestas) {
    if (e.resolved === "unknown" && !nodes.some((n) => n.id === e.to)) {
      nodes.push({ id: e.to, kind: "file", file: "", name: e.to.replace("module:", "") });
    }
  }
  for (const n of nodes) if (entradas.includes(n.file)) n.entry = true;
  return {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    root: "/x",
    nodes,
    edges: arestas,
    indexes: { fanIn: {}, fanOut: {}, entries: [], byFile: {} },
  };
}

const met = (over = {}) => ({
  linhasDeCodigo: 100,
  ciclomatica: 10,
  cognitiva: 20,
  funcoes: 5,
  maiorFuncao: 4,
  ...over,
});

// --- 1. acoplamento nas duas direcoes --------------------------------------
// a <- b, a <- c, a -> d. Entao a tem Ca=2 (b e c dependem) e Ce=1 (usa d).
console.log("=== acoplamento aferente e eferente");
{
  const g = grafo(
    ["a.ts", "b.ts", "c.ts", "d.ts"],
    [importa("b.ts", "a.ts"), importa("c.ts", "a.ts"), importa("a.ts", "d.ts")],
  );
  const m = new Map(["a.ts", "b.ts", "c.ts", "d.ts"].map((f) => [f, met()]));
  const r = analisarArquitetura(g, m);
  const a = r.modulos.find((x) => x.arquivo === "a.ts");
  const d = r.modulos.find((x) => x.arquivo === "d.ts");
  check(a.ca === 2, "a.ca deveria ser 2", `veio ${a.ca}`);
  check(a.ce === 1, "a.ce deveria ser 1", `veio ${a.ce}`);
  // I = Ce/(Ca+Ce) = 1/3. `a` e mais rocha que folha.
  check(Math.abs(a.instabilidade - 1 / 3) < 0.01, "a.instabilidade deveria ser ~0.333", `veio ${a.instabilidade}`);
  // `d` e usado por a e nao usa ninguem: rocha pura.
  check(d.instabilidade === 0, "d.instabilidade deveria ser 0 (rocha)", `veio ${d.instabilidade}`);
}

// --- 2. folha e isolado ------------------------------------------------------
console.log("=== folha tem I=1 e isolado tem I=null");
{
  const g = grafo(["folha.ts", "base.ts", "sozinho.ts"], [importa("folha.ts", "base.ts")]);
  const m = new Map(["folha.ts", "base.ts", "sozinho.ts"].map((f) => [f, met()]));
  const r = analisarArquitetura(g, m);
  const folha = r.modulos.find((x) => x.arquivo === "folha.ts");
  const so = r.modulos.find((x) => x.arquivo === "sozinho.ts");
  check(folha.instabilidade === 1, "folha deveria ter I=1", `veio ${folha.instabilidade}`);
  // Sem nenhuma aresta interna nao ha razao para calcular: zero seria mentira,
  // porque zero significa "rocha" e ele nao e rocha, e desconhecido.
  check(so.instabilidade === null, "isolado deveria ter I=null", `veio ${so.instabilidade}`);
}

// --- 3. ciclo ---------------------------------------------------------------
console.log("=== ciclo de importacao e detectado");
{
  const g = grafo(
    ["x.ts", "y.ts", "z.ts", "fora.ts"],
    [importa("x.ts", "y.ts"), importa("y.ts", "z.ts"), importa("z.ts", "x.ts"), importa("fora.ts", "x.ts")],
  );
  const m = new Map(["x.ts", "y.ts", "z.ts", "fora.ts"].map((f) => [f, met()]));
  const r = analisarArquitetura(g, m);
  check(r.ciclos.length === 1, "deveria achar 1 ciclo", `achou ${r.ciclos.length}`);
  check(r.ciclos[0]?.modulos.length === 3, "o ciclo deveria ter 3 modulos", `${r.ciclos[0]?.modulos}`);
  check(r.totais.modulosEmCiclo === 3, "totais.modulosEmCiclo deveria ser 3", `veio ${r.totais.modulosEmCiclo}`);
  const fora = r.modulos.find((x) => x.arquivo === "fora.ts");
  check(fora.ciclo === null, "quem so aponta para o ciclo NAO esta nele", `veio ${fora.ciclo}`);
}

console.log("=== sem ciclo, nao inventa ciclo");
{
  // Cadeia linear: a -> b -> c. Nenhum componente forte com mais de um no.
  const g = grafo(["a.ts", "b.ts", "c.ts"], [importa("a.ts", "b.ts"), importa("b.ts", "c.ts")]);
  const m = new Map(["a.ts", "b.ts", "c.ts"].map((f) => [f, met()]));
  const r = analisarArquitetura(g, m);
  check(r.ciclos.length === 0, "cadeia linear nao tem ciclo", `achou ${r.ciclos.length}`);
}

// --- 4. risco: complexidade CRUZADA com alcance ------------------------------
console.log("=== risco ordena por complexidade x alcance, nao por complexidade");
{
  // `orfa` e mais complexa, mas ninguem depende dela.
  // `usada` e menos complexa e tem 3 dependentes.
  const g = grafo(
    ["orfa.ts", "usada.ts", "p.ts", "q.ts", "r.ts"],
    [importa("p.ts", "usada.ts"), importa("q.ts", "usada.ts"), importa("r.ts", "usada.ts")],
  );
  const m = new Map([
    ["orfa.ts", met({ cognitiva: 100 })],
    ["usada.ts", met({ cognitiva: 40 })],
    ["p.ts", met({ cognitiva: 1 })],
    ["q.ts", met({ cognitiva: 1 })],
    ["r.ts", met({ cognitiva: 1 })],
  ]);
  const r = analisarArquitetura(g, m);
  const orfa = r.modulos.find((x) => x.arquivo === "orfa.ts");
  const usada = r.modulos.find((x) => x.arquivo === "usada.ts");
  // 40 * (1+3) = 160 contra 100 * (1+0) = 100.
  check(usada.risco > orfa.risco, "modulo menos complexo mas MUITO usado deveria vir na frente", `${usada.risco} vs ${orfa.risco}`);
  check(r.modulos[0].arquivo === "usada.ts", "o topo da lista deveria ser usada.ts", `veio ${r.modulos[0].arquivo}`);
}

// --- 5. externas e orfaos ----------------------------------------------------
console.log("=== dependencia externa nao conta como acoplamento interno");
{
  const g = grafo(
    ["app.ts", "util.ts"],
    [importa("app.ts", "util.ts"), importa("app.ts", "react", false), importa("app.ts", "lodash", false)],
    ["app.ts"],
  );
  const m = new Map([["app.ts", met()], ["util.ts", met()]]);
  const r = analisarArquitetura(g, m);
  const app = r.modulos.find((x) => x.arquivo === "app.ts");
  check(app.ce === 1, "so o import interno conta em Ce", `veio ${app.ce}`);
  check(app.externas === 2, "as duas externas contam separado", `veio ${app.externas}`);
  check(r.totais.dependenciasExternas === 2, "totais de externas", `veio ${r.totais.dependenciasExternas}`);
  // `app` e entrada declarada, entao nao e orfao mesmo com Ca=0.
  check(r.totais.modulosOrfaos === 0, "entrada com Ca=0 nao e orfa", `veio ${r.totais.modulosOrfaos}`);
}

// --- 6. o contrato que o ingest le -------------------------------------------
console.log("=== os campos que o ingest e a tela leem existem");
{
  const g = grafo(["a.ts", "b.ts"], [importa("b.ts", "a.ts")]);
  const r = analisarArquitetura(g, new Map([["a.ts", met()], ["b.ts", met()]]));
  // Espelha `arquiteturaFromSarif` em apps/functions. Quando alguem renomear
  // um campo aqui, este teste quebra ANTES de o painel mostrar zero em
  // producao sem ninguem entender por que.
  for (const k of ["modulos", "linhasDeCodigo", "funcoes", "ciclomaticaMedia", "cognitivaMedia", "arestasInternas", "dependenciasExternas", "modulosEmCiclo", "modulosOrfaos"]) {
    check(k in r.totais, `totais.${k} ausente`);
  }
  for (const k of ["arquivo", "ca", "ce", "instabilidade", "cognitiva", "maiorFuncao", "linhasDeCodigo", "risco", "ciclo"]) {
    check(k in r.modulos[0], `modulo.${k} ausente`);
  }
}

// --- 7. deterministico --------------------------------------------------------
console.log("=== mesma entrada, mesmo relatorio");
{
  const g = grafo(["a.ts", "b.ts", "c.ts"], [importa("a.ts", "b.ts"), importa("b.ts", "c.ts"), importa("c.ts", "a.ts")]);
  const m = new Map([["a.ts", met()], ["b.ts", met()], ["c.ts", met()]]);
  const um = analisarArquitetura(g, m);
  const dois = analisarArquitetura(g, m);
  const semData = (x) => JSON.stringify({ ...x, geradoEm: null });
  check(semData(um) === semData(dois), "duas execucoes deveriam dar o mesmo relatorio");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nok: leitura arquitetural");
process.exit(falhas ? 1 : 0);
