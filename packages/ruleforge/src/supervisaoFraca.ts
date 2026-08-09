// ---------------------------------------------------------------------------
// Rotulagem NÃO SUPERVISIONADA por acordo entre votantes (Dawid–Skene).
//
// O problema
// ---------------------------------------------------------------------------
// O corpus dourado tem 436 casos escritos à mão, e 310 das 514 regras ativas
// não têm nenhum. Escrever caso à mão não escala: cada regra nova precisa de
// alguém que conheça a linguagem, o defeito e o idioma do time.
//
// A saída óbvia é errada. "Perguntar para um modelo se este apontamento é
// verdadeiro" troca um rótulo humano por um palpite caro e não reprodutível,
// e não dá para defender numa auditoria seis meses depois.
//
// A saída certa é mais velha que os modelos: quando ninguém sabe a verdade,
// ela se estima pelo ACORDO entre observadores independentes. Dawid e Skene
// publicaram isso em 1979 para conciliar diagnósticos de médicos que
// discordavam, sem nunca saber quem estava certo.
//
// Como funciona aqui
// ---------------------------------------------------------------------------
// Vários votantes baratos e independentes opinam sobre o mesmo candidato:
// a máscara léxica, o acordo entre regras da mesma CWE, o motor de fluxo de
// dados, o agrupamento por forma. Nenhum é confiável sozinho. O EM estima, ao
// mesmo tempo:
//
//   - a QUALIDADE de cada votante (com que frequência ele acerta em cada
//     classe), sem gabarito nenhum;
//   - a probabilidade de cada candidato ser um acerto de verdade.
//
// O truque é que os dois se sustentam: votante que concorda com a maioria nos
// casos fáceis ganha peso, e o peso dele passa a valer nos casos difíceis. Um
// votante ruim é DESCOBERTO e afundado sozinho, sem ninguém rotular nada.
//
// Por que continua determinístico
// ---------------------------------------------------------------------------
// A inicialização é voto de maioria, não sorteio. As iterações são fixas e a
// tolerância também. Mesmos votos entram, mesmos rótulos saem — inclusive
// quando um dos votantes é um modelo de linguagem, porque o voto dele é
// gravado e vira dado, não é consultado de novo na hora de decidir.
//
// E o mais importante: isto rotula CANDIDATO, nunca aprova REGRA. Quem aprova
// regra é o avaliador determinístico de sempre (evaluate.ts), rodando sobre
// os casos que saíram daqui.
// ---------------------------------------------------------------------------

/** Voto de um votante sobre um candidato. `null` é abstenção declarada. */
export type Voto = "match" | "no_match" | null;

export interface CandidatoVotado {
  id: string;
  /** votante -> voto. Ausente e `null` valem a mesma coisa: não opinou. */
  votos: Record<string, Voto>;
}

/**
 * Confusão de um votante, em contagens SUAVES (fracionárias).
 *
 * `conf[a][b]` = massa de votos `b` quando a verdade estimada é `a`, com
 * 0 = no_match e 1 = match. Guardar a matriz inteira, e não uma "acurácia",
 * é o que permite representar o votante torto de um jeito só: a máscara
 * léxica quase nunca erra ao dizer no_match e erra bastante ao dizer match,
 * e uma acurácia única jogaria as duas coisas na mesma média.
 */
export interface Confusao {
  conf: [[number, number], [number, number]];
  abstencoes: number;
  /** O votante vota com o sinal trocado. Ver a restricao no passo M. */
  invertido?: boolean;
}

export interface EstadoSupervisao {
  versao: 1;
  /** P(verdade = match) no fluxo visto até agora. */
  prior: number;
  votantes: Record<string, Confusao>;
  candidatosVistos: number;
  /** Quantas rodadas de ingestão já entraram neste estado. */
  rodadas: number;
}

export interface Rotulo {
  id: string;
  /** P(verdade = match | votos). */
  probabilidade: number;
  /** Quantos votantes efetivamente opinaram. */
  votantesQueOpinaram: number;
}

export interface ResultadoRotulagem {
  rotulos: Rotulo[];
  estado: EstadoSupervisao;
  /** Iterações que o EM levou para estabilizar. Alto = votantes discordantes. */
  iteracoes: number;
}

// Suavização de Laplace. Sem ela um votante que acertou tudo nas primeiras
// dez amostras recebe probabilidade 1 e passa a VETAR os outros para sempre,
// porque um único fator zero zera o produto inteiro.
const SUAVIZACAO = 1;
const MAX_ITER = 50;
const TOLERANCIA = 1e-6;

/**
 * Prior com a DIAGONAL pesada, e isto conserta um defeito que quase passou.
 *
 * A verossimilhança do Dawid–Skene é simétrica: trocar todo rótulo por seu
 * oposto E inverter a matriz de todo votante dá exatamente o mesmo valor. São
 * dois máximos, um certo e um espelhado, e o modelo não tem como preferir.
 *
 * Com suavização `[[1,1],[1,1]]` a semente não desempata nada, e foi o que
 * aconteceu na primeira medição contra o OWASP: o EM caiu no máximo espelhado,
 * rotulou 4405 candidatos como falso positivo e ZERO como acerto, e concordou
 * com o gabarito em 25.9% — pior que jogar moeda. O votante de fluxo de dados
 * apareceu com 15% de acurácia, que era o modelo dizendo "este aqui vota ao
 * contrário", quando na verdade era ele que estava lendo tudo de cabeça para
 * baixo.
 *
 * `[[3,1],[1,3]]` diz só uma coisa, e é uma coisa fraca: votante tende a
 * acertar mais que errar. Não afirma quanto. Basta para escolher entre os dois
 * máximos, e com algumas centenas de candidatos os dados dominam o prior de
 * qualquer forma.
 */
const PRIOR_DIAGONAL = 3;
const PRIOR_FORA = 1;

/**
 * Peso do passado a cada rodada de ingestão online.
 *
 * 0.95 dá meia-vida de ~14 rodadas: o estado acompanha mudança de base de
 * código sem esquecer o que aprendeu na semana passada. Com 1.0 o sistema
 * congela depois de alguns milhares de candidatos e para de aprender; com
 * 0.5 ele esquece a cada dois scans e vira ruído.
 */
export const DECAIMENTO_PADRAO = 0.95;

export function estadoVazio(): EstadoSupervisao {
  return { versao: 1, prior: 0.5, votantes: {}, candidatosVistos: 0, rodadas: 0 };
}

function confusaoVazia(): Confusao {
  return {
    conf: [
      [PRIOR_DIAGONAL, PRIOR_FORA],
      [PRIOR_FORA, PRIOR_DIAGONAL],
    ],
    abstencoes: 0,
  };
}

/**
 * Vira a solução inteira quando o EM assentou no máximo espelhado.
 *
 * O prior diagonal escolhe o lado certo quando os votantes são razoáveis. Não
 * basta quando um votante tagarela e enviesado domina a massa: ele arrasta a
 * semente da maioria, e o prior de 3 não segura contra dezenas de milhares de
 * votos.
 *
 * A âncora resolve com o único bit que os dados não têm: a DIREÇÃO de um
 * votante. E ela precisa de DUAS propriedades, não uma — foi o que custou
 * duas medições para aparecer.
 *
 * A primeira tentativa ancorou no fluxo de dados, achando que bastava a
 * polaridade ser conhecida. No acervo do OWASP quase todo apontamento vem do
 * motor de taint, então aquele votante diz "match" para quase tudo: ele não
 * DISCRIMINA. Ancorar nele não orientava, FIXAVA a solução degenerada "tudo é
 * verdadeiro", e um votante de leitura com 90% de acurácia real era ajustado a
 * 35% para caber nela.
 *
 * A máscara léxica serve porque as duas propriedades valem: um casamento
 * dentro de comentário é falso positivo por definição, e ela só abre a boca
 * nesse caso. Polaridade conhecida E poder de separar.
 *
 * Também não adianta exigir que todo votante fique acima do acaso: inverter a
 * verdade E todos os votantes junto satisfaz essa exigência igualmente bem. A
 * restrição não toca na simetria, e tentar por ali só trocou um espelho pelo
 * outro.
 *
 * Isto não é o mesmo que rotular à mão: continua ninguém dizendo se ESTE
 * apontamento é verdadeiro. Só se diz para que lado aponta o polegar de um
 * votante, e o resto o acordo resolve.
 */
function orientar(
  p: number[],
  votantes: Record<string, Confusao>,
  ancora: string | undefined,
): { p: number[]; votantes: Record<string, Confusao>; virou: boolean } {
  const c = ancora ? votantes[ancora] : undefined;
  if (!c) return { p, votantes, virou: false };
  const acc = (verossimilhanca(c, 0, 0) + verossimilhanca(c, 1, 1)) / 2;
  if (acc >= 0.5) return { p, votantes, virou: false };
  // Inverter a VERDADE troca as LINHAS da matriz, não as colunas. `conf[a][b]`
  // é massa do voto `b` quando a verdade é `a`; se toda verdade vira seu
  // oposto, `conf'[a][b] = conf[1-a][b]` e o voto não se mexe — quem votou
  // "match" continua tendo votado "match".
  //
  // A primeira versão trocava linha E coluna, que é a inversão aplicada duas
  // vezes e volta ao ponto de partida. O sintoma foi um votante-âncora
  // aparecendo com 14% de acurácia DEPOIS de ter sido usado para corrigir a
  // orientação, que é uma contradição: se ele orientou, ele tem que estar do
  // lado certo no fim.
  const invertidos: Record<string, Confusao> = {};
  for (const [nome, v] of Object.entries(votantes)) {
    invertidos[nome] = {
      conf: [
        [v.conf[1][0], v.conf[1][1]],
        [v.conf[0][0], v.conf[0][1]],
      ],
      abstencoes: v.abstencoes,
    };
  }
  return { p: p.map((x) => 1 - x), votantes: invertidos, virou: true };
}

/** P(voto | verdade), com a linha da matriz normalizada. */
function verossimilhanca(c: Confusao, verdade: 0 | 1, voto: 0 | 1): number {
  const linha = c.conf[verdade];
  const soma = linha[0] + linha[1];
  return soma > 0 ? linha[voto] / soma : 0.5;
}

const comoNumero = (v: Voto): 0 | 1 | null => (v === "match" ? 1 : v === "no_match" ? 0 : null);

/**
 * Voto de maioria — a semente do EM.
 *
 * Determinística de propósito: EM converge para ótimo LOCAL, então a semente
 * decide o resultado. Sorteio aqui significaria rótulo diferente a cada
 * execução sobre o mesmo código, que é exatamente o que este projeto não
 * aceita.
 */
function maioria(cand: CandidatoVotado): number {
  let sim = 0;
  let nao = 0;
  for (const v of Object.values(cand.votos)) {
    const n = comoNumero(v);
    if (n === 1) sim++;
    else if (n === 0) nao++;
  }
  if (sim + nao === 0) return 0.5;
  return sim / (sim + nao);
}

/**
 * Roda o EM sobre um lote de candidatos, partindo de um estado anterior.
 *
 * `estadoAnterior` é o que torna isto ONLINE: a confiabilidade aprendida em
 * scans passados entra como contagem inicial (depreciada por `decaimento`),
 * em vez de recomeçar do zero a cada execução. Um votante que se mostrou bom
 * ao longo de mil arquivos já chega pesando mais no primeiro candidato do
 * arquivo mil e um.
 */
/**
 * Votante cuja DIREÇÃO é conhecida por construção, usado para desempatar o
 * espelhamento. Caminho de fluxo de dados fechado é evidência a favor: isso
 * decorre de como o motor funciona, não de estatística.
 */
export const ANCORA_PADRAO = "mascara-lexica";

export function rotularPorAcordo(
  candidatos: CandidatoVotado[],
  estadoAnterior: EstadoSupervisao = estadoVazio(),
  decaimento = DECAIMENTO_PADRAO,
  ancora: string | undefined = ANCORA_PADRAO,
): ResultadoRotulagem {
  // --- memória: o que já se sabia, depreciado ----------------------------
  //
  // `base` é IMUTÁVEL durante o EM, e isso não é detalhe de estilo.
  //
  // A primeira versão reconstruía a confusão a partir do resultado da
  // iteração anterior, então o lote entrava de novo a cada passo do M: com 50
  // iterações, cada candidato era contado 50 vezes. A massa foi a 19999 em vez
  // de estabilizar em ~800, e o efeito colateral era pior que o vazamento —
  // as acurácias estimadas achatavam todas para perto de 70%, e o votante bom
  // deixava de ser distinguível do medíocre. O EM parava de fazer a única
  // coisa que justifica seu custo.
  const base: Record<string, Confusao> = {};
  for (const [nome, c] of Object.entries(estadoAnterior.votantes)) {
    base[nome] = {
      conf: [
        [c.conf[0][0] * decaimento, c.conf[0][1] * decaimento],
        [c.conf[1][0] * decaimento, c.conf[1][1] * decaimento],
      ],
      abstencoes: c.abstencoes * decaimento,
    };
  }
  for (const cand of candidatos) {
    for (const nome of Object.keys(cand.votos)) base[nome] ??= confusaoVazia();
  }
  let votantes: Record<string, Confusao> = base;

  let prior = estadoAnterior.prior;
  let p = candidatos.map(maioria);
  let iteracoes = 0;

  if (candidatos.length === 0) {
    return { rotulos: [], estado: { ...estadoAnterior, votantes }, iteracoes: 0 };
  }

  for (let it = 0; it < MAX_ITER; it++) {
    iteracoes = it + 1;

    // --- M: confusão e prior a partir das responsabilidades atuais -------
    // Sempre a partir de `base`, NUNCA do resultado da iteração anterior.
    const novo: Record<string, Confusao> = {};
    for (const [nome, c] of Object.entries(base)) {
      novo[nome] = {
        // A massa herdada continua valendo: é a memória das rodadas anteriores.
        conf: [
          [c.conf[0][0], c.conf[0][1]],
          [c.conf[1][0], c.conf[1][1]],
        ],
        abstencoes: c.abstencoes,
      };
    }
    for (let i = 0; i < candidatos.length; i++) {
      for (const [nome, voto] of Object.entries(candidatos[i]!.votos)) {
        const b = comoNumero(voto);
        const alvo = novo[nome]!;
        if (b === null) {
          alvo.abstencoes += 1;
          continue;
        }
        alvo.conf[0][b] += 1 - p[i]!;
        alvo.conf[1][b] += p[i]!;
      }
    }
    const somaP = p.reduce((a, b) => a + b, 0);
    const priorNovo = (somaP + SUAVIZACAO) / (candidatos.length + 2 * SUAVIZACAO);

    // --- E: posterior de cada candidato ----------------------------------
    // Em log, porque com dez votantes o produto direto chega em 1e-30 e o
    // ponto flutuante zera os dois lados antes de normalizar.
    const pNovo = candidatos.map((cand) => {
      let l0 = Math.log(1 - priorNovo);
      let l1 = Math.log(priorNovo);
      for (const [nome, voto] of Object.entries(cand.votos)) {
        const b = comoNumero(voto);
        if (b === null) continue;
        const c = novo[nome]!;
        l0 += Math.log(Math.max(verossimilhanca(c, 0, b), 1e-12));
        l1 += Math.log(Math.max(verossimilhanca(c, 1, b), 1e-12));
      }
      const m = Math.max(l0, l1);
      const e0 = Math.exp(l0 - m);
      const e1 = Math.exp(l1 - m);
      return e1 / (e0 + e1);
    });

    const delta = pNovo.reduce((a, v, i) => a + Math.abs(v - p[i]!), 0) / candidatos.length;
    p = pNovo;
    prior = priorNovo;
    votantes = novo;
    if (delta < TOLERANCIA) break;
  }

  // Desempate do espelhamento, DEPOIS de convergir: virar no meio do EM so
  // faria o passo seguinte voltar para onde estava.
  const orientado = orientar(p, votantes, ancora);
  p = orientado.p;
  votantes = orientado.votantes;
  if (orientado.virou) prior = 1 - prior;

  const rotulos = candidatos.map((c, i) => ({
    id: c.id,
    probabilidade: p[i]!,
    votantesQueOpinaram: Object.values(c.votos).filter((v) => v !== null).length,
  }));

  return {
    rotulos,
    estado: {
      versao: 1,
      prior,
      votantes,
      candidatosVistos: estadoAnterior.candidatosVistos + candidatos.length,
      rodadas: estadoAnterior.rodadas + 1,
    },
    iteracoes,
  };
}

/**
 * Qualidade estimada de cada votante, para o painel e para o diagnóstico.
 *
 * `acuracia` é balanceada entre as classes de propósito. Num fluxo onde 90%
 * dos candidatos são no_match, um votante que responde sempre "no_match"
 * tiraria 90% na média simples e pareceria excelente sendo inútil.
 */
export function qualidadeDosVotantes(
  estado: EstadoSupervisao,
): Array<{ votante: string; acuracia: number; vieses: string; massa: number }> {
  return Object.entries(estado.votantes)
    .map(([votante, c]) => {
      const accNao = verossimilhanca(c, 0, 0);
      const accSim = verossimilhanca(c, 1, 1);
      const massa = c.conf[0][0] + c.conf[0][1] + c.conf[1][0] + c.conf[1][1];
      return {
        votante,
        acuracia: (accNao + accSim) / 2,
        vieses: c.invertido
          ? "vota com o sinal TROCADO"
          : accSim - accNao > 0.15
            ? "confia demais no match"
            : accNao - accSim > 0.15
              ? "confia demais no no_match"
              : "equilibrado",
        massa,
      };
    })
    .sort((a, b) => b.acuracia - a.acuracia);
}
