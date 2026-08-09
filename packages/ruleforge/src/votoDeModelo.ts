import type { HeroRule } from "@codehero/contracts";
import type { Voto } from "./supervisaoFraca.ts";
import type { Candidato } from "./votantes.ts";

// ---------------------------------------------------------------------------
// Coleta do voto de um modelo — um passo separado, orçado e cacheado.
//
// Por que fica aqui e não dentro da votação
// ---------------------------------------------------------------------------
// Porque chamada de rede não pode entrar no caminho que decide. Se entrasse, a
// rotulagem passaria a depender de qual modelo estava no ar naquele dia, e o
// corpus deixaria de ser reproduzível — que é a única coisa que faz um corpus
// valer alguma coisa.
//
// Aqui a consulta acontece uma vez, o resultado é gravado, e a decisão lê o
// arquivo. Se o orçamento acabar, os candidatos restantes ficam sem voto deste
// votante e o EM segue com os outros: abstenção é comportamento previsto, não
// falha.
//
// O recorte que faz o custo caber, herdado do open-code-review
// ---------------------------------------------------------------------------
// Não se pergunta ao modelo sobre TODO candidato. Pergunta-se só onde os
// votantes baratos ficaram EMPATADOS, que é onde a resposta muda alguma coisa.
// Num corpus com dezenas de milhares de candidatos, a zona de dúvida é uns
// poucos por cento — e é a diferença entre uma conta de centavos e uma conta
// que ninguém aprova.
// ---------------------------------------------------------------------------

/** O que o coletor precisa saber para perguntar. Sem acoplamento com Genkit. */
export interface PerguntaAoModelo {
  candidatoId: string;
  ruleId: string;
  mensagemDaRegra: string;
  arquivo: string;
  linha: number;
  /** A linha do apontamento, com algumas de contexto em volta. */
  trecho: string;
  /** Posicao da linha alvo DENTRO de `trecho`, base 1. O modelo numera a partir dai. */
  linhaNoTrecho: number;
}

/**
 * Função injetada que fala com o modelo. Devolve `null` para abster.
 *
 * É injetada, e não importada, porque `ruleforge` não deve depender de
 * provedor de modelo: quem tem Genkit configurado (apps/functions) passa a
 * implementação, e os testes passam uma função de mentira.
 */
export type ChamadaDeModelo = (p: PerguntaAoModelo) => Promise<Voto>;

export interface OpcoesColeta {
  /** Teto de perguntas. Passou disso, o resto abstém. */
  orcamento?: number;
  /** Faixa de probabilidade considerada "em dúvida". */
  faixaDuvida?: [number, number];
  /** Votos já coletados antes, para não pagar duas vezes. */
  cache?: Map<string, Voto>;
  /**
   * Linhas de contexto ANTES do apontamento. Muito maior que o depois, e a
   * assimetria é o ponto.
   *
   * A entrada perigosa está ACIMA do uso: é ali que `request.getParameter`
   * aparece, e é a distância entre os dois que o modelo precisa enxergar para
   * responder qualquer coisa.
   *
   * Medido: com 4 linhas antes, o voto do modelo deu 50.3% de acurácia
   * balanceada contra o gabarito do OWASP — moeda. E errava para o lado caro,
   * dizendo AUSENTE em 35 casos realmente vulneráveis. Não era o modelo sendo
   * ruim, era eu perguntando sobre um trecho onde a resposta não estava: ele
   * via uma variável sem origem visível e concluía, razoavelmente, que não
   * dava para afirmar defeito.
   */
  contextoAntes?: number;
  /** Linhas depois. Poucas: o que vem depois do uso raramente muda o veredito. */
  contexto?: number;
}

export interface ResultadoColeta {
  votos: Map<string, Voto>;
  perguntados: number;
  reaproveitados: number;
  abstidosPorOrcamento: number;
}

const ORCAMENTO_PADRAO = 200;
const FAIXA_DUVIDA: [number, number] = [0.15, 0.85];

/**
 * Pergunta ao modelo só sobre os candidatos em dúvida, respeitando orçamento.
 *
 * `probabilidades` vem de uma primeira passada do EM só com os votantes
 * baratos. Sem ela não dá para saber onde está a dúvida, e o passo perderia a
 * economia inteira.
 */
export async function coletarVotosDeModelo(
  candidatos: Candidato[],
  regras: Map<string, HeroRule>,
  probabilidades: Map<string, number>,
  fonteDoArquivo: (caminho: string) => string | undefined,
  chamar: ChamadaDeModelo,
  opts: OpcoesColeta = {},
): Promise<ResultadoColeta> {
  const orcamento = opts.orcamento ?? ORCAMENTO_PADRAO;
  const [baixo, alto] = opts.faixaDuvida ?? FAIXA_DUVIDA;
  const contexto = opts.contexto ?? 3;
  const antes = opts.contextoAntes ?? 35;
  const votos = new Map<string, Voto>(opts.cache ?? []);
  let perguntados = 0;
  let reaproveitados = 0;
  let abstidosPorOrcamento = 0;

  // Em dúvida primeiro, e dentro da dúvida os mais indecisos antes: se o
  // orçamento acabar no meio, ele foi gasto onde rendia mais.
  const emDuvida = candidatos
    .filter((c) => {
      const p = probabilidades.get(c.id);
      return p !== undefined && p > baixo && p < alto;
    })
    .sort((a, b) => {
      const da = Math.abs((probabilidades.get(a.id) ?? 0.5) - 0.5);
      const db = Math.abs((probabilidades.get(b.id) ?? 0.5) - 0.5);
      return da - db;
    });

  for (const c of emDuvida) {
    if (votos.has(c.id)) {
      reaproveitados++;
      continue;
    }
    if (perguntados >= orcamento) {
      abstidosPorOrcamento++;
      continue;
    }
    const regra = regras.get(c.ruleId);
    const fonte = fonteDoArquivo(c.arquivo);
    if (!regra || fonte === undefined) continue;

    const linhas = fonte.split(/\r?\n/);
    const ini = Math.max(0, c.linha - 1 - antes);
    const fim = Math.min(linhas.length, c.linha + contexto);

    try {
      const v = await chamar({
        candidatoId: c.id,
        ruleId: c.ruleId,
        mensagemDaRegra: regra.message,
        arquivo: c.arquivo,
        linha: c.linha,
        trecho: linhas.slice(ini, fim).join("\n"),
        linhaNoTrecho: c.linha - ini,
      });
      votos.set(c.id, v);
      perguntados++;
    } catch {
      // Rede caiu, cota estourou, modelo mudou de formato: abstém e segue.
      // Nenhum desses é motivo para derrubar a indução do corpus.
      votos.set(c.id, null);
    }
  }

  return { votos, perguntados, reaproveitados, abstidosPorOrcamento };
}

/**
 * Instrução para o modelo. Fica aqui, versionada, e não espalhada em string
 * solta: quando o voto do modelo piorar, é a primeira coisa que se olha, e ela
 * precisa estar num arquivo com histórico.
 *
 * O pedido é deliberadamente estreito. Não se pergunta "isto é um bug?", que
 * convida a opinião; pergunta-se se AQUELE defeito específico está presente
 * naquele trecho, que é uma pergunta fechada e barata.
 */
export const INSTRUCAO_DE_VOTO = `Você recebe um trecho de código e a descrição de um defeito que uma regra
estática apontou nele. Responda APENAS uma palavra:

  PRESENTE  — o defeito descrito realmente está no trecho
  AUSENTE   — a regra se enganou, o defeito descrito não está ali
  INCERTO   — o trecho não dá para decidir

Regras para responder:
- julgue SÓ o defeito descrito, não a qualidade geral do código;
- se o trecho mostrar que o valor é constante, validado ou vem de fonte
  confiável, isso é AUSENTE;
- se faltar contexto para saber de onde vem o dado, responda INCERTO;
- INCERTO é uma resposta boa. Chutar é pior que abster.`;

/** Converte a resposta em voto. Qualquer coisa fora do combinado é abstenção. */
export function interpretarResposta(texto: string): Voto {
  const t = texto.trim().toUpperCase();
  if (t.startsWith("PRESENTE")) return "match";
  if (t.startsWith("AUSENTE")) return "no_match";
  return null;
}

// ---------------------------------------------------------------------------
// A pergunta VERIFICÁVEL, que substitui a pergunta de opinião.
//
// Por que a primeira formulação não servia
// ---------------------------------------------------------------------------
// "Este defeito está presente?" pede um veredito, e veredito não se confere.
// Medido no BenchmarkJava: 53.1% de acurácia balanceada, moeda. E o pior não é
// o número, é que uma resposta errada entra na urna com o mesmo peso de uma
// certa, porque nada distingue as duas.
//
// "Em qual linha este dado entra no programa?" é outra coisa. É uma afirmação
// sobre o texto, e o motor de fluxo confere se a linha apontada é mesmo uma
// fonte de entrada. Três consequências:
//
//   - resposta errada vira ABSTENÇÃO DETECTADA, não voto. O modelo só
//     consegue votar quando acerta algo que dá para checar;
//   - a tarefa é mais fácil para o modelo. Localizar `request.getParameter`
//     num trecho é leitura, não julgamento de segurança;
//   - o erro que sobra é o silencioso — apontar uma fonte que existe mas não
//     alimenta AQUELA linha.
//
// E foi exatamente esse erro que sobrou. O resultado, medido
// ---------------------------------------------------------------------------
// Três formulações, todas conferidas contra o gabarito do OWASP:
//
//   veredito, 4 linhas de contexto    50.3% balanceada,  35 erros caros
//   veredito, 35 linhas de contexto   53.1% balanceada,   2 erros caros
//   origem verificável                50.0% balanceada,   0 erros caros
//
// Todas em cima da moeda. Na última, 236 respostas "PRESENTE" contra 5
// "AUSENTE" e ZERO acertos em caso seguro: o modelo nunca reconhece um trecho
// que a regra apontou por engano. Os 89.9% de acerto BRUTO são só a taxa-base
// do acervo, e é por isso que a acurácia balanceada é o único número que se
// pode olhar aqui.
//
// A razão de fundo, e ela não se resolve com prompt
// ---------------------------------------------------------------------------
// O que separa acerto de erro neste acervo é a LAVAGEM entre a entrada e o
// uso: o ramo constante, a troca de chave no mapa, a aritmética de índice na
// lista. Descobrir isso é precisamente o trabalho do motor de fluxo. Perguntar
// ao modelo é pedir que ele refaça esse trabalho com menos informação, e ele
// não tem como acrescentar sinal que o motor já não tenha.
//
// O que FICA de valor, porque o mecanismo funcionou
// ---------------------------------------------------------------------------
// 22% do que o modelo afirmou não se sustentou na conferência e foi
// descartado. Na pergunta de opinião, essas 70 respostas teriam entrado na
// urna com o mesmo peso das corretas. A verificação vale mesmo quando o sinal
// verificado não presta — e vale mais ainda no dia em que prestar.
// ---------------------------------------------------------------------------

export const INSTRUCAO_DE_ORIGEM = `Você recebe um trecho de código numerado e a LINHA ALVO onde uma regra
estática apontou algo. Sua tarefa é localizar de onde vem o dado usado na
linha alvo. NÃO julgue se há vulnerabilidade.

Responda APENAS com uma destas formas, nada mais:

  LINHA <n>   o número da linha em que o dado usado na linha alvo entra no
              programa vindo DE FORA (parâmetro de requisição, cabeçalho,
              cookie, arquivo, rede, variável de ambiente, entrada padrão)
  NENHUMA     o dado usado na linha alvo é constante, literal, ou nasce
              inteiro dentro do trecho, sem vir de fora
  INCERTO     o trecho não mostra a origem

Regras:
- responda com o número da linha COMO ESTÁ NUMERADO no trecho;
- se o dado passa por várias variáveis, aponte a linha da ENTRADA original,
  não as intermediárias;
- INCERTO é uma resposta boa. Chutar é pior que abster.`;

/** O que o modelo afirmou sobre a origem, antes de ser conferido. */
export interface AfirmacaoDeOrigem {
  tipo: "linha" | "nenhuma" | "incerto";
  linha?: number;
}

export function interpretarOrigem(texto: string): AfirmacaoDeOrigem {
  const t = texto.trim().toUpperCase();
  const m = /LINHA\s+(\d+)/.exec(t);
  if (m) return { tipo: "linha", linha: Number(m[1]) };
  if (t.startsWith("NENHUMA")) return { tipo: "nenhuma" };
  return { tipo: "incerto" };
}

/**
 * Confere a afirmação contra o texto e devolve o voto.
 *
 * `verificaFonte` é injetada (na prática, `ehFonteDeEntrada` do motor) para
 * que a checagem use os MESMOS padrões do rastreio. Uma segunda lista
 * derivaria da primeira e passaria a validar contra algo que o motor não usa.
 */
export function votoDeOrigem(
  af: AfirmacaoDeOrigem,
  linhasDoTrecho: string[],
  verificaFonte: (linha: string) => boolean,
): { voto: Voto; conferido: "confirmada" | "refutada" | "sem-afirmacao" } {
  if (af.tipo === "incerto") return { voto: null, conferido: "sem-afirmacao" };
  if (af.tipo === "nenhuma") {
    // Afirmação forte e conferível pelo outro lado: se o trecho NÃO tem
    // nenhuma fonte, ele tem razão e isso é evidência de falso positivo.
    const temAlguma = linhasDoTrecho.some((l) => verificaFonte(l));
    return temAlguma
      ? { voto: null, conferido: "refutada" }
      : { voto: "no_match", conferido: "confirmada" };
  }
  const idx = (af.linha ?? 0) - 1;
  const alvo = linhasDoTrecho[idx];
  if (alvo === undefined) return { voto: null, conferido: "refutada" };
  return verificaFonte(alvo)
    ? { voto: "match", conferido: "confirmada" }
    : { voto: null, conferido: "refutada" };
}
