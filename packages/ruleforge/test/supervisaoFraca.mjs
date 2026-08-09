import {
  rotularPorAcordo,
  estadoVazio,
  qualidadeDosVotantes,
} from "../dist/supervisaoFraca.js";

// ---------------------------------------------------------------------------
// Como se testa um rotulador NAO supervisionado
//
// Simulando um mundo onde a verdade existe e o algoritmo NAO a recebe. Se ele
// reconstroi a confiabilidade de cada votante e os rotulos so pelo acordo,
// funciona. Se so devolve o voto de maioria, nao serve para nada: maioria e
// uma linha de codigo e nao precisa de EM.
//
// O caso que decide e o votante RUIM em minoria. Maioria simples ja resolve
// votante ruim isolado; o que exige estimar confiabilidade e quando um
// votante ruim vota junto com outro ruim e afunda o bom.
// ---------------------------------------------------------------------------

let falhas = 0;
const check = (ok, msg) => {
  if (!ok) {
    falhas++;
    console.log("  FALHA: " + msg);
  }
};

// Gerador deterministico: teste que pisca nao serve de guarda.
let semente = 12345;
const rnd = () => {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff;
  return semente / 0x7fffffff;
};

/** Monta candidatos com verdade conhecida e votantes de acuracia definida. */
function mundo(n, acuracias) {
  const verdade = [];
  const candidatos = [];
  for (let i = 0; i < n; i++) {
    const z = rnd() < 0.4 ? 1 : 0;
    verdade.push(z);
    const votos = {};
    for (const [nome, acc] of Object.entries(acuracias)) {
      const certo = rnd() < acc;
      const v = certo ? z : 1 - z;
      votos[nome] = v === 1 ? "match" : "no_match";
    }
    candidatos.push({ id: "c" + i, votos });
  }
  return { verdade, candidatos };
}

console.log("=== descobre quem e bom e quem e ruim, sem gabarito");
const acuracias = { bom: 0.95, medio: 0.75, ruim: 0.35, outroRuim: 0.35 };
const { verdade, candidatos } = mundo(600, acuracias);
const r = rotularPorAcordo(candidatos, estadoVazio());
const q = qualidadeDosVotantes(r.estado);
const posicao = Object.fromEntries(q.map((x, i) => [x.votante, i]));
console.log("   ordem estimada: " + q.map((x) => `${x.votante} ${(x.acuracia * 100).toFixed(0)}%`).join(", "));
check(posicao.bom < posicao.medio, "deveria ranquear 'bom' acima de 'medio'");
check(posicao.medio < posicao.ruim, "deveria ranquear 'medio' acima de 'ruim'");
check(
  q.find((x) => x.votante === "bom").acuracia > 0.85,
  "acuracia estimada de 'bom' deveria passar de 85%",
);

console.log("=== os rotulos batem com a verdade que ele nunca viu");
const acertos = r.rotulos.filter((l, i) => (l.probabilidade > 0.5 ? 1 : 0) === verdade[i]).length;
const taxa = acertos / verdade.length;
console.log("   acerto dos rotulos: " + (taxa * 100).toFixed(1) + "%");
check(taxa > 0.9, "rotulagem deveria passar de 90% de acerto");

console.log("=== bate o voto de maioria (senao o EM nao esta pagando o custo)");
// Dois votantes ruins contra um bom: a maioria erra, o EM tem que salvar.
const maioriaAcertos = candidatos.filter((c, i) => {
  let sim = 0;
  let nao = 0;
  for (const v of Object.values(c.votos)) v === "match" ? sim++ : nao++;
  return (sim > nao ? 1 : 0) === verdade[i];
}).length;
const taxaMaioria = maioriaAcertos / verdade.length;
console.log("   maioria simples:    " + (taxaMaioria * 100).toFixed(1) + "%");
check(taxa > taxaMaioria + 0.05, "EM deveria ganhar da maioria por mais de 5 pontos");

console.log("=== abstencao nao conta como voto");
// Votante que so abstem nao pode mover rotulo nenhum.
const semAbst = rotularPorAcordo(
  [
    { id: "a", votos: { x: "match", y: "match" } },
    { id: "b", votos: { x: "no_match", y: "no_match" } },
  ],
  estadoVazio(),
);
const comAbst = rotularPorAcordo(
  [
    { id: "a", votos: { x: "match", y: "match", mudo: null } },
    { id: "b", votos: { x: "no_match", y: "no_match", mudo: null } },
  ],
  estadoVazio(),
);
check(
  Math.abs(semAbst.rotulos[0].probabilidade - comAbst.rotulos[0].probabilidade) < 1e-9,
  "votante que so abstem nao deveria mudar o rotulo",
);

console.log("=== determinismo: mesma entrada, mesmo rotulo");
const a1 = rotularPorAcordo(candidatos, estadoVazio());
const a2 = rotularPorAcordo(candidatos, estadoVazio());
check(
  a1.rotulos.every((l, i) => l.probabilidade === a2.rotulos[i].probabilidade),
  "duas execucoes deveriam dar exatamente o mesmo numero",
);

console.log("=== online: o estado anterior faz o votante bom ja chegar pesando");
// Primeiro aprende em 600 candidatos; depois recebe UM lote pequeno em que a
// maioria erra. Sem memoria o lote pequeno erraria junto.
const treino = rotularPorAcordo(candidatos, estadoVazio());
const dificil = [{ id: "d1", votos: { bom: "match", ruim: "no_match", outroRuim: "no_match" } }];
const comMemoria = rotularPorAcordo(dificil, treino.estado);
const semMemoria = rotularPorAcordo(dificil, estadoVazio());
console.log(
  "   com memoria: " +
    comMemoria.rotulos[0].probabilidade.toFixed(3) +
    " | sem memoria: " +
    semMemoria.rotulos[0].probabilidade.toFixed(3),
);
check(
  comMemoria.rotulos[0].probabilidade > 0.5,
  "com memoria deveria seguir o votante bom contra os dois ruins",
);
check(
  semMemoria.rotulos[0].probabilidade < 0.5,
  "sem memoria deveria seguir a maioria (e errar) — se nao, o teste nao prova nada",
);

console.log("=== decaimento: estado nao cresce sem limite");
let est = estadoVazio();
for (let i = 0; i < 200; i++) est = rotularPorAcordo(candidatos.slice(0, 20), est).estado;
const massa = Math.max(...qualidadeDosVotantes(est).map((x) => x.massa));
console.log("   massa maxima apos 200 rodadas: " + massa.toFixed(0));
check(massa < 2000, "com decaimento 0.95 a massa deveria estabilizar, nao crescer sem fim");

console.log(falhas ? `\n${falhas} falha(s)` : "\nok: supervisao fraca");
process.exit(falhas ? 1 : 0);
