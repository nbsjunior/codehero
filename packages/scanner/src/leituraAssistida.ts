// ---------------------------------------------------------------------------
// Leitura assistida por modelo: o RECORTE e o ORÇAMENTO.
//
// O que este arquivo NÃO faz, e é o mais importante
// ---------------------------------------------------------------------------
// Não chama modelo nenhum e não participa do gate. Ele decide QUE PEDAÇO de
// código valeria a pena mandar para leitura e quanto isso custaria, e para
// aí. O veredito do merge continua saindo só do caminho determinístico: mesmo
// código entra, mesmo resultado sai, seis meses depois igual.
//
// Isso não é preciosismo. É o que permite defender uma reprovação numa
// auditoria, e é a única propriedade que o CodeHero tem e as suítes caras não
// têm de graça.
//
// De onde vem o desenho
// ---------------------------------------------------------------------------
// Do `open-code-review` da Alibaba, que resolve o custo por três decisões, e
// nenhuma delas é a escolha do modelo:
//
//   ESCOPO DE DIFF     revisa o que mudou, não o repositório;
//   TETO DE TOKENS     corta o despacho ANTES de estourar, não depois;
//   TAREFA POR ARQUIVO cada arquivo é uma unidade fechada e barata.
//
// Aqui entra uma quarta, que é o que muda a conta de verdade:
//
//   SÓ ONDE A REGRA NÃO ALCANÇA. Mandar para o modelo uma linha que uma regra
//   já apontou é pagar duas vezes pela mesma informação. O valor está no vão:
//   o trecho que mudou e sobre o qual o motor determinístico não teve nada a
//   dizer. Num repositório com catálogo maduro esse vão é pequeno, e é
//   exatamente por isso que fica barato.
// ---------------------------------------------------------------------------

/** Um trecho candidato a ser lido por modelo. */
export interface TrechoParaLeitura {
  arquivo: string;
  /** 1-based, inclusivo. */
  linhaInicial: number;
  linhaFinal: number;
  codigo: string;
  /** Custo estimado em tokens, para caber no orçamento antes de despachar. */
  tokensEstimados: number;
  /** Por que este trecho foi escolhido, para o relatório poder explicar. */
  motivo: string;
}

export interface OrcamentoLeitura {
  /** Teto de tokens da execução inteira. Zero desliga a leitura assistida. */
  tetoDeTokens: number;
  /** Máximo de trechos, para não fatiar demais um arquivo grande. */
  maxTrechos?: number;
  /** Linhas de contexto ao redor do trecho alterado. */
  contexto?: number;
}

export interface SelecaoDeLeitura {
  trechos: TrechoParaLeitura[];
  tokensEstimados: number;
  /** Trechos que ficaram de fora por estourar o orçamento. */
  descartadosPorOrcamento: number;
  /** Trechos ignorados porque uma regra determinística já cobriu a linha. */
  jaCobertosPorRegra: number;
}

/**
 * Estimativa de tokens.
 *
 * Quatro caracteres por token é a aproximação usual para código em alfabeto
 * latino. É estimativa mesmo, e o ponto é ser CONSERVADORA: errar para mais
 * faz a execução caber no orçamento; errar para menos faz estourar a conta,
 * que é o defeito que o orçamento existe para evitar.
 */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 4) + 8; // 8 de folga por trecho
}

export interface HunkAlterado {
  arquivo: string;
  /** 1-based, inclusivo. */
  linhaInicial: number;
  linhaFinal: number;
}

export interface LinhaJaApontada {
  arquivo: string;
  linha: number;
}

/**
 * Escolhe o que mandar para leitura, dentro do orçamento.
 *
 * A ordem de prioridade não é arbitrária: trecho maior tende a render mais por
 * token gasto, mas trecho gigante come o orçamento inteiro e deixa o resto sem
 * cobertura. Então a ordenação é por tamanho CRESCENTE, o que maximiza quantos
 * trechos distintos cabem. É a mesma lógica de encher uma mochila com os itens
 * pequenos primeiro quando o objetivo é cobrir variedade.
 */
export function selecionarParaLeitura(
  hunks: HunkAlterado[],
  jaApontadas: LinhaJaApontada[],
  fonteDoArquivo: (arquivo: string) => string | null,
  orcamento: OrcamentoLeitura,
): SelecaoDeLeitura {
  const vazio: SelecaoDeLeitura = {
    trechos: [],
    tokensEstimados: 0,
    descartadosPorOrcamento: 0,
    jaCobertosPorRegra: 0,
  };
  if (!orcamento.tetoDeTokens || orcamento.tetoDeTokens <= 0) return vazio;

  const contexto = orcamento.contexto ?? 3;
  const maxTrechos = orcamento.maxTrechos ?? 40;

  // Índice das linhas que uma regra já apontou, por arquivo.
  const cobertas = new Map<string, Set<number>>();
  for (const a of jaApontadas) {
    let s = cobertas.get(a.arquivo);
    if (!s) {
      s = new Set();
      cobertas.set(a.arquivo, s);
    }
    s.add(a.linha);
  }

  let jaCobertos = 0;
  const candidatos: TrechoParaLeitura[] = [];

  for (const h of hunks) {
    const cob = cobertas.get(h.arquivo);
    if (cob) {
      let temApontamento = false;
      for (let l = h.linhaInicial; l <= h.linhaFinal; l++) {
        if (cob.has(l)) {
          temApontamento = true;
          break;
        }
      }
      // Já há apontamento determinístico aqui: a informação existe e é
      // reproduzível. Pagar por leitura de novo é gastar duas vezes.
      if (temApontamento) {
        jaCobertos++;
        continue;
      }
    }

    const fonte = fonteDoArquivo(h.arquivo);
    if (!fonte) continue;
    const linhas = fonte.split(/\r?\n/);

    const ini = Math.max(1, h.linhaInicial - contexto);
    const fim = Math.min(linhas.length, h.linhaFinal + contexto);
    const codigo = linhas.slice(ini - 1, fim).join("\n");
    if (!codigo.trim()) continue;

    candidatos.push({
      arquivo: h.arquivo,
      linhaInicial: ini,
      linhaFinal: fim,
      codigo,
      tokensEstimados: estimarTokens(codigo),
      motivo: "linha alterada sem apontamento determinístico",
    });
  }

  // Menores primeiro: cabe mais gente no mesmo orçamento.
  candidatos.sort((a, b) => a.tokensEstimados - b.tokensEstimados);

  const escolhidos: TrechoParaLeitura[] = [];
  let gasto = 0;
  let descartados = 0;

  for (const c of candidatos) {
    if (escolhidos.length >= maxTrechos) {
      descartados++;
      continue;
    }
    // O corte acontece ANTES de despachar. Estourar e cobrar depois é
    // exatamente o que o orçamento existe para impedir.
    if (gasto + c.tokensEstimados > orcamento.tetoDeTokens) {
      descartados++;
      continue;
    }
    escolhidos.push(c);
    gasto += c.tokensEstimados;
  }

  return {
    trechos: escolhidos,
    tokensEstimados: gasto,
    descartadosPorOrcamento: descartados,
    jaCobertosPorRegra: jaCobertos,
  };
}

/**
 * Observação devolvida por um modelo sobre um trecho.
 *
 * Chama-se OBSERVAÇÃO e não apontamento de propósito: ela não entra no gate,
 * não tem severidade que reprove build e não conta no débito técnico. O
 * caminho dela é virar candidata a regra, ser avaliada contra o corpus pelo
 * mesmo avaliador determinístico de sempre, e só então virar apontamento de
 * verdade — para todo mundo, de forma reproduzível.
 */
export interface ObservacaoDeLeitura {
  arquivo: string;
  linha: number;
  texto: string;
  /** Identificação do modelo, para o relatório poder dizer de onde veio. */
  modelo: string;
}

/**
 * Separa o que o modelo devolveu do que entra no gate.
 *
 * Existe como função, e não como convenção escrita na documentação, porque
 * convenção se esquece. Quem quiser somar observação ao veredito precisa
 * apagar isto aqui, e aí é uma decisão consciente e visível no diff.
 */
export function observacoesNaoEntramNoGate<T extends { severity?: string }>(
  achadosDoGate: T[],
  observacoes: ObservacaoDeLeitura[],
): { gate: T[]; foraDoGate: ObservacaoDeLeitura[] } {
  return { gate: achadosDoGate, foraDoGate: observacoes };
}
