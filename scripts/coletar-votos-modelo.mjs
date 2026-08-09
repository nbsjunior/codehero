#!/usr/bin/env node
/**
 * Coleta o voto de um modelo sobre os candidatos EM DÚVIDA, e grava.
 *
 * Este passo existe separado do que decide, e essa separação é o ponto
 * ---------------------------------------------------------------------------
 * Chamada de rede não pode entrar no caminho que rotula. Se entrasse, o corpus
 * passaria a depender de qual modelo estava no ar naquele dia e deixaria de
 * ser reproduzível — que é a única coisa que faz um corpus valer alguma coisa.
 *
 * Aqui o modelo é consultado UMA vez, o voto vira arquivo, e a rotulagem lê o
 * arquivo. Seis meses depois, com o modelo daquela semana fora do ar, o mesmo
 * corpus se reconstrói igual.
 *
 * O recorte que faz o custo caber
 * ---------------------------------------------------------------------------
 * Não se pergunta sobre todo candidato. Roda-se a indução só com os votantes
 * baratos, e pergunta-se apenas onde eles ficaram EMPATADOS — que é onde a
 * resposta muda alguma coisa. Dos ~34 mil candidatos, a zona de dúvida é uma
 * fração pequena, e é a diferença entre uma conta de centavos e uma conta que
 * ninguém aprova.
 *
 * Uso:
 *   GEMINI_API_KEY=... node scripts/coletar-votos-modelo.mjs --orcamento 300
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeSource } from "../packages/scanner/dist/engine.js";
import { RULES } from "../packages/contracts/dist/index.js";
import {
  induzirCorpus,
  estadoVazio,
  coletarVotosDeModelo,
  interpretarResposta,
  interpretarOrigem,
  votoDeOrigem,
  INSTRUCAO_DE_VOTO,
  INSTRUCAO_DE_ORIGEM,
} from "../packages/ruleforge/dist/index.js";
import { ehFonteDeEntrada } from "../packages/engine/dist/index.js";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const ORCAMENTO = Number(arg("--orcamento", "300"));
const MODELO = arg("--modelo", "gemini-2.5-flash");
const SAIDA = arg("--saida", "packages/ruleforge/corpus/votos-modelo.json");
const BENCH = ".tmp/benchmark-java/src/main/java/org/owasp/benchmark/testcode";
// Pergunta VERIFICAVEL por padrao. `--modo-veredito` volta a pergunta de
// opiniao, que ficou so para reproduzir a medicao que a reprovou (53.1% de
// acuracia balanceada, moeda).
const MODO_ORIGEM = !process.argv.includes("--modo-veredito");

const chave = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENAI_API_KEY;
if (!chave) {
  console.error("sem GEMINI_API_KEY no ambiente. Este passo nao inventa credencial.");
  process.exit(1);
}
process.env.GOOGLE_GENAI_API_KEY = chave; // o plugin le deste nome

const { genkit } = await import("genkit");
const { googleAI } = await import("@genkit-ai/google-genai");
const ai = genkit({ plugins: [googleAI()] });

// --- corpo de código --------------------------------------------------------
if (!existsSync(BENCH)) {
  console.error("acervo do OWASP ausente em .tmp/benchmark-java");
  process.exit(1);
}
const caminhos = readdirSync(BENCH)
  .filter((f) => f.endsWith(".java"))
  .map((f) => join(BENCH, f));

const fontes = new Map();
const arquivos = [];
for (const p of caminhos) {
  const fonte = readFileSync(p, "utf8");
  fontes.set(p, fonte);
  const linhas = fonte.split(/\r?\n/);
  const achados = [];
  for (const f of analyzeSource(p, fonte)) {
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
console.log(`arquivos com apontamento: ${arquivos.length}`);

// --- primeira passada: onde estao as duvidas? ------------------------------
const base = induzirCorpus(arquivos, RULES, { estadoAnterior: estadoVazio() });
console.log(`candidatos: ${base.candidatosTotais}`);

// Reconstrói os candidatos e as probabilidades da primeira passada.
const candidatos = [];
for (const a of arquivos) {
  for (const ac of a.achados) {
    candidatos.push({
      id: `${a.caminho}:${ac.linha}:${ac.ruleId}`,
      ruleId: ac.ruleId,
      arquivo: a.caminho,
      linha: ac.linha,
      colunaInicio: ac.colunaInicio,
      colunaFim: ac.colunaFim,
      trecho: ac.trecho,
      motor: ac.motor,
      temCaminhoDeTaint: ac.temCaminhoDeTaint,
    });
  }
}
// A indução não devolve a probabilidade de cada candidato, só os casos que
// passaram do limiar. Quem NÃO virou caso é, por definição, a zona de dúvida.
const decididos = new Set();
for (const c of base.casos) {
  const m = /— (.+):(\d+)$/.exec(c.note ?? "");
  if (m) decididos.add(`${m[1]}:${m[2]}:${c.ruleId}`);
}
const probabilidades = new Map(candidatos.map((c) => [c.id, decididos.has(c.id) ? 0.95 : 0.5]));
console.log(`em duvida: ${candidatos.length - decididos.size}`);

// --- onde gastar o orçamento -----------------------------------------------
//
// Espalhar 600 perguntas por 33 mil candidatos dá 2% de cobertura, e um
// votante que opina em 2% dos casos não move estimativa nenhuma: o EM mede a
// confiabilidade dele pelo acordo, e com essa densidade quase não há acordo
// para medir.
//
// Concentrar nas regras de fluxo de segurança é o gasto certo por dois
// motivos que coincidem: são as regras de severidade mais alta do catálogo, e
// são as únicas cujo veredito o gabarito do OWASP consegue conferir. Ou seja,
// é onde a resposta vale mais E onde dá para saber se ela prestou.
const SO_REGRAS = (arg("--so-regras", "HERO-SEC-0089,HERO-SEC-0079,HERO-SEC-0022,HERO-SEC-0078,HERO-SEC-0090,HERO-SEC-0643,HERO-SEC-0501") ?? "")
  .split(",")
  .filter(Boolean);
const alvo = SO_REGRAS.length
  ? candidatos.filter((c) => SO_REGRAS.some((p) => c.ruleId.startsWith(p)))
  : candidatos;
console.log(`no alvo das regras escolhidas: ${alvo.length}`);

// --- cache: nunca pagar duas vezes pela mesma pergunta ---------------------
const cache = existsSync(SAIDA)
  ? new Map(Object.entries(JSON.parse(readFileSync(SAIDA, "utf8"))))
  : new Map();
console.log(`votos ja em cache: ${cache.size}`);

const regras = new Map(RULES.map((r) => [r.id, r]));
let erros = 0;
let vistas = 0;

const conferencia = { confirmada: 0, refutada: 0, "sem-afirmacao": 0 };

const chamar = async (p) => {
  const linhasTrecho = p.trecho.split("\n");
  const numerado = linhasTrecho
    .map((l, i) => `${String(i + 1).padStart(3)} | ${l}`)
    .join("\n");
  const prompt = MODO_ORIGEM
    ? [
        INSTRUCAO_DE_ORIGEM,
        "",
        `LINHA ALVO: ${p.linhaNoTrecho}`,
        "",
        "TRECHO NUMERADO:",
        "```java",
        numerado,
        "```",
        "",
        "Responda APENAS: LINHA <n>, NENHUMA ou INCERTO.",
      ].join("\n")
    : [
        INSTRUCAO_DE_VOTO,
        "",
        `DEFEITO APONTADO: ${p.mensagemDaRegra}`,
        "",
        "TRECHO:",
        "```java",
        p.trecho,
        "```",
        "",
        "Responda com UMA palavra: PRESENTE, AUSENTE ou INCERTO.",
      ].join("\n");
  try {
    const res = await ai.generate({
      model: googleAI.model(MODELO),
      prompt,
      // `maxOutputTokens` folgado E raciocínio desligado, os dois de propósito.
      //
      // Com 8 tokens e o pensamento ligado, o Gemini 2.5 gasta o orçamento
      // inteiro raciocinando e devolve texto VAZIO. A primeira execução deu 20
      // de 20 "INCERTO", que não era o modelo se abstendo: era resposta em
      // branco caindo no ramo de abstenção do interpretador.
      //
      // A pergunta é fechada e de uma palavra. Raciocínio longo aqui não
      // melhora a resposta e multiplica o custo por dez.
      config: {
        temperature: 0,
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const txt = res.text ?? "";
    if (process.env.HERO_DEBUG_VOTO && vistas++ < 5) {
      console.error(`  [cru] ${JSON.stringify(txt).slice(0, 120)}`);
    }
    if (!MODO_ORIGEM) return interpretarResposta(txt);

    // A resposta é CONFERIDA antes de virar voto. O modelo afirma uma linha;
    // o motor diz se aquela linha é mesmo uma fonte de entrada. Quando ele
    // erra, isso é detectado e vira abstenção — o erro não entra na urna com
    // o mesmo peso do acerto, que era o vício da pergunta de opinião.
    const r = votoDeOrigem(interpretarOrigem(txt), linhasTrecho, (l) =>
      ehFonteDeEntrada(l, "java"),
    );
    conferencia[r.conferido]++;
    return r.voto;
  } catch (e) {
    erros++;
    if (erros <= 3) console.error(`  erro do modelo: ${String(e.message ?? e).slice(0, 120)}`);
    return null;
  }
};

const inicio = Date.now();
const r = await coletarVotosDeModelo(
  alvo,
  regras,
  probabilidades,
  (p) => fontes.get(p),
  chamar,
  { orcamento: ORCAMENTO, cache },
);

console.log(`\nperguntados: ${r.perguntados}`);
console.log(`reaproveitados do cache: ${r.reaproveitados}`);
console.log(`abstidos por orcamento: ${r.abstidosPorOrcamento}`);
console.log(`erros de chamada: ${erros}`);
console.log(`tempo: ${((Date.now() - inicio) / 1000).toFixed(0)}s`);

if (MODO_ORIGEM) {
  const total = conferencia.confirmada + conferencia.refutada + conferencia["sem-afirmacao"];
  console.log(
    "\nconferencia da afirmacao: confirmada=" +
      conferencia.confirmada +
      " refutada=" +
      conferencia.refutada +
      " sem-afirmacao=" +
      conferencia["sem-afirmacao"] +
      (total ? "  (" + ((conferencia.refutada * 100) / total).toFixed(0) + "% do que ele afirmou nao se sustentou)" : ""),
  );
}

const dist = { match: 0, no_match: 0, abstencao: 0 };
for (const v of r.votos.values()) dist[v ?? "abstencao"]++;
console.log(`\nvotos: PRESENTE=${dist.match} AUSENTE=${dist.no_match} INCERTO/abstencao=${dist.abstencao}`);

writeFileSync(SAIDA, JSON.stringify(Object.fromEntries(r.votos), null, 2) + "\n");
console.log(`gravado: ${SAIDA} (${r.votos.size} votos)`);
