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
