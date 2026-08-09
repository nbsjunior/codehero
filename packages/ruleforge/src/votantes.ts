import { buildLexicalMask, lexicalProfileFor, type HeroRule, type LexicalMask } from "@codehero/contracts";
import type { Voto } from "./supervisaoFraca.ts";

// ---------------------------------------------------------------------------
// Votantes: sinais baratos e INDEPENDENTES sobre um apontamento.
//
// A independência é a condição do método, não um detalhe
// ---------------------------------------------------------------------------
// Dawid–Skene estima a confiabilidade de cada votante pelo quanto ele concorda
// com os outros. Dois votantes que olham a MESMA evidência concordam sempre,
// e o modelo lê essa concordância como competência: os dois sobem juntos e
// passam a mandar no resultado. É assim que se constrói um sistema confiante e
// errado.
//
// Por isso cada votante aqui olha uma coisa diferente:
//
//   mascara-lexica     onde o texto caiu (comentário, string, código)
//   acordo-cwe         se outras regras da mesma família concordam
//   fluxo-de-dados     se existe caminho da entrada até o uso
//   densidade          quanto a regra fala neste arquivo
//   raridade           se o trecho é idiomático no projeto ou é exceção
//   leitura-de-modelo  o que um modelo barato entendeu do trecho
//
// ABSTENÇÃO É PRIMEIRA CLASSE. Um votante que não tem evidência devolve
// `null` e não entra na conta. É melhor que chutar: chute vira ruído
// correlacionado com nada e o EM demora a descobrir.
// ---------------------------------------------------------------------------

export interface Candidato {
  id: string;
  ruleId: string;
  arquivo: string;
  linha: number;
  colunaInicio: number;
  colunaFim: number;
  trecho: string;
  motor: "pattern" | "ast" | "taint";
  temCaminhoDeTaint: boolean;
}

export interface ContextoArquivo {
  caminho: string;
  fonte: string;
  linhas: string[];
  mascara: LexicalMask;
  perfil: string;
  /** Deslocamento do início de cada linha no texto, para casar com a máscara. */
  offsets: number[];
  linhasUteis: number;
  /** Todos os apontamentos do arquivo, para o acordo entre regras. */
  achados: Array<{ ruleId: string; linha: number; cwe: string[] }>;
  /** Trecho normalizado -> quantas vezes aparece no projeto inteiro. */
  frequencia: Map<string, number>;
}

export interface Votante {
  nome: string;
  votar(c: Candidato, ctx: ContextoArquivo, regra: HeroRule): Voto;
}

export function montarContexto(
  caminho: string,
  fonte: string,
  achados: ContextoArquivo["achados"],
  frequencia: Map<string, number>,
): ContextoArquivo {
  const linhas = fonte.split(/\r?\n/);
  const offsets: number[] = [];
  let acc = 0;
  for (const l of linhas) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  const perfil = lexicalProfileFor(caminho);
  return {
    caminho,
    fonte,
    linhas,
    mascara: buildLexicalMask(fonte, perfil),
    perfil,
    offsets,
    linhasUteis: linhas.filter((l) => l.trim()).length,
    achados,
    frequencia,
  };
}

/** Texto sem literais, número nem espaço: dois trechos "iguais na forma" colidem. */
export function normalizarTrecho(s: string): string {
  return s
    .replace(/["'`][^"'`]*["'`]/g, "S")
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// --- 1. onde o texto caiu ---------------------------------------------------

/**
 * Regra com `scope: "any"` enxerga comentário e string junto com o código, e
 * isso é proposital: nome de algoritmo de criptografia quase sempre é literal.
 * O preço é apontar a linha que só FALA do defeito.
 *
 * Este votante separa os dois casos olhando a máscara na posição exata do
 * casamento. Para regra com `scope: "code"` ele se abstém, porque o matcher já
 * garantiu a mesma coisa e opinar de novo seria contar a evidência duas vezes.
 */
export const votanteMascara: Votante = {
  nome: "mascara-lexica",
  votar(c, ctx, regra) {
    if ((regra.pattern?.scope ?? "code") !== "any") return null;
    const base = ctx.offsets[c.linha - 1];
    if (base === undefined) return null;
    const ini = base + Math.max(0, c.colunaInicio);
    const fim = Math.min(base + Math.max(c.colunaFim, c.colunaInicio + 1), ctx.mascara.code.length);
    if (fim <= ini) return null;
    const emCodigo = ctx.mascara.code.slice(ini, fim).trim();
    const emComentario = ctx.mascara.comments.slice(ini, fim).trim();
    // UM LADO SÓ, e isso é deliberado.
    //
    // Casamento dentro de comentário é falso positivo por definição: código
    // comentado não executa. Já estar em código executável não prova nada — a
    // esmagadora maioria das linhas de qualquer programa está em código e nem
    // por isso tem defeito.
    //
    // Votar "match" nesse caso era transformar uma quase-tautologia em
    // evidência, e ainda entregava a este votante a massa necessária para
    // arrastar o EM. Calar é a leitura honesta do que ele sabe, e é o que o
    // torna utilizável como âncora de orientação.
    if (emComentario && !emCodigo) return "no_match";
    return null;
  },
};

// --- 2. acordo entre regras da mesma família --------------------------------

/**
 * Duas regras diferentes, escritas por caminhos diferentes, apontando a MESMA
 * linha pela mesma CWE é evidência de verdade. É o sinal mais barato que
 * existe e não custa nada além de um cruzamento.
 *
 * O cuidado é não deixar isto virar eco: só conta regra com id diferente E
 * detector diferente. Duas regras clonadas apontariam sempre juntas e
 * inflariam a confiança uma da outra.
 */
export const votanteAcordoCwe: Votante = {
  nome: "acordo-cwe",
  votar(c, ctx, regra) {
    const meu = new Set(regra.cwe ?? []);
    if (meu.size === 0) return null;
    let concorda = 0;
    let discorda = 0;
    for (const a of ctx.achados) {
      if (a.ruleId === c.ruleId) continue;
      const perto = Math.abs(a.linha - c.linha) <= 1;
      const comum = a.cwe.some((x) => meu.has(x));
      if (perto && comum) concorda++;
      else if (perto && a.cwe.length > 0 && !comum) discorda++;
    }
    if (concorda > 0) return "match";
    // Ninguém mais falou desta linha. Isso não é prova de erro: regra
    // especialista costuma ser a única a ver o que ela vê.
    if (discorda > 1) return "no_match";
    return null;
  },
};

// --- 3. existe caminho da entrada até o uso? --------------------------------

/**
 * Para regra que declara `taint`, o motor de fluxo de dados é um segundo
 * observador de verdade: ele responde se o valor perigoso CHEGA ali.
 *
 * Quando a regra tem `taint` e o apontamento veio só do padrão léxico, é
 * porque o fluxo NÃO fechou — e o motor teve a chance de olhar. Isso é
 * evidência contra, não ausência de evidência.
 */
export const votanteFluxo: Votante = {
  nome: "fluxo-de-dados",
  votar(c, _ctx, regra) {
    if (!regra.taint) return null;
    if (c.motor === "taint" && c.temCaminhoDeTaint) return "match";
    if (c.motor === "pattern") return "no_match";
    return null;
  },
};

// --- 4. quanto a regra fala neste arquivo -----------------------------------

/**
 * Regra que aponta um quinto das linhas de um arquivo não está achando
 * defeito, está descrevendo o estilo da casa. Foi assim que o dado morto do
 * COBOL virou 92% da saída e afogou as análises que valiam.
 *
 * O outro lado também informa: apontar duas linhas de um arquivo de oitocentas
 * é o formato de um defeito de verdade.
 */
export const votanteDensidade: Votante = {
  nome: "densidade",
  votar(c, ctx) {
    if (ctx.linhasUteis < 40) return null; // arquivo curto não tem estatística
    const meus = ctx.achados.filter((a) => a.ruleId === c.ruleId).length;
    const taxa = meus / ctx.linhasUteis;
    if (taxa > 0.2) return "no_match";
    if (meus <= 2 && ctx.linhasUteis > 120) return "match";
    return null;
  },
};

// --- 5. o trecho é idiomático ou é exceção? --------------------------------

/**
 * Se a MESMA forma de linha aparece cem vezes no projeto e ninguém corrigiu,
 * ou é o jeito que o time escreve, ou é um defeito sistêmico que a regra vai
 * reportar cem vezes de qualquer jeito. Nos dois casos o apontamento
 * individual vale pouco.
 *
 * A forma é normalizada sem literal nem número de propósito: `new File(a, "x")`
 * e `new File(b, "y")` são a mesma forma, e é a forma que revela o idioma.
 */
/**
 * LIMITE MEDIDO, e ele é sério: este votante não vale em base gerada por
 * molde. No OWASP BenchmarkJava, onde 2740 arquivos saem do mesmo gabarito,
 * quase toda linha "se repete" e ele opinou sobre 33 mil candidatos com viés
 * de no_match — massa dez vezes maior que a de qualquer outro votante. Deixou
 * de ser evidência e virou um prior disfarçado, arrastando a solução inteira.
 *
 * Por isso os limiares aqui são frouxos nas pontas e a abstenção é larga: ele
 * só abre a boca no muito raro e no muito repetido, e cala no meio, que é onde
 * ele não sabe de nada. Num repositório de verdade a distribuição é outra e
 * ele volta a informar.
 */
export const votanteRaridade: Votante = {
  nome: "raridade",
  votar(c, ctx) {
    const n = ctx.frequencia.get(normalizarTrecho(c.trecho)) ?? 1;
    if (n >= 100) return "no_match";
    if (n === 1) return "match";
    return null;
  },
};

// --- 6. voto gravado (é assim que um modelo entra sem quebrar nada) --------

/**
 * Votante que só lê votos já GRAVADOS, indexados pelo id do candidato.
 *
 * É por aqui que um modelo de linguagem participa. A consulta acontece antes,
 * uma vez, num passo separado e orçado (ver `votoDeModelo.ts`); o resultado
 * vira arquivo. Na hora de decidir, ninguém chama modelo nenhum: o EM lê uma
 * coluna de votos como lê a dos outros votantes.
 *
 * Três coisas caem no lugar por causa disso:
 *
 *   - a rotulagem continua reproduzível, inclusive daqui a seis meses, quando
 *     o modelo daquela semana não existir mais;
 *   - o modelo NÃO ganha autoridade: ele vira um votante entre outros e o EM
 *     mede a confiabilidade dele como mede a de qualquer um. Se responder mal,
 *     afunda sozinho, sem ninguém precisar decidir isso;
 *   - o custo é conhecido antes de gastar, porque a coleta é um passo com
 *     orçamento próprio.
 */
export function votanteDeVotosGravados(nome: string, votos: Map<string, Voto>): Votante {
  return {
    nome,
    votar(c) {
      return votos.get(c.id) ?? null;
    },
  };
}

export const VOTANTES_DETERMINISTICOS: Votante[] = [
  votanteMascara,
  votanteAcordoCwe,
  votanteFluxo,
  votanteDensidade,
  votanteRaridade,
];
