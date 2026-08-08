// ---------------------------------------------------------------------------
// Complexidade COBERTA vs NÃO COBERTA (JaCoCo).
//
// A peça mais valiosa do JaCoCo não é o contador de cobertura — é a
// SEPARAÇÃO:
//
//   complexidade coberta  = soma da ciclomática das funções que o teste exerceu
//   complexidade não coberta = soma das que ficaram de fora
//
// Duas suítes com o mesmo % de cobertura de linha podem esconder perfis de
// risco opostos: uma cobre o caminho feliz e deixa o tratamento de erro fora;
// a outra cobre justamente os cantos. Só a soma de linhas não distingue os
// dois casos — a complexidade SIM, porque cada `if`/`else` é uma aresta do
// grafo de controle.
//
// O CodeHero já TEM as duas metades:
//   - ciclomática por função (tree-sitter, --metrics)
//   - cobertura por linha (JaCoCo/JCov/lcov/Cobertura)
//
// O que faltava era o cruzamento. Aqui está, puro: sem parser, sem I/O.
// ---------------------------------------------------------------------------

import type { CoverageReport, CoverageCounter } from "@codehero/contracts";

/** Função com localização e custo, suficiente para cruzar com cobertura. */
export interface FuncaoParaCruzamento {
  startLine: number;
  endLine: number;
  cyclomatic: number;
}

/** Resultado por arquivo + total. */
export interface ComplexidadeCoberta {
  /** Soma da ciclomática das funções com ALGUMA linha coberta. */
  coberta: number;
  /** Soma das funções sem nenhuma linha coberta. */
  naoCoberta: number;
  /** 0–100. Denominador zero (sem função) → 100. */
  percentual: number;
  /** Por arquivo, para o relatório apontar onde a dívida está. */
  porArquivo: Array<{
    file: string;
    coberta: number;
    naoCoberta: number;
    percentual: number;
  }>;
}

/**
 * Decide se a função conta como COBERTA.
 *
 * Critério conservador: basta UMA linha executável coberta dentro do intervalo
 * [startLine, endLine]. Função que o teste entrou pelo menos uma vez teve o
 * caminho principal exercitado — a complexidade dela não é mais "desconhecida"
 * para a suíte. Função nunca tocada é risco puro.
 */
function funcaoCoberta(
  fn: FuncaoParaCruzamento,
  covered: Set<number>,
): boolean {
  for (let l = fn.startLine; l <= fn.endLine; l++) {
    if (covered.has(l)) return true;
  }
  return false;
}

/**
 * Cruza a complexidade por função com a cobertura por linha.
 *
 * `estrutura` é o que sai de `computeFileMetrics` (tree-sitter): por arquivo,
 * a lista de funções com startLine/endLine/cyclomatic. `cobertura` é o que o
 * parser de JaCoCo/JCov/lcov produziu: por arquivo, as linhas cobertas.
 *
 * O cruzamento é por ARQUIVO: função e linha precisam estar no mesmo path
 * (POSIX) para casar. Sem isso, `src/a.ts` coberto e `src/b.ts` com função
 * nas mesmas linhas dariam falso positivo.
 */
export function cruzarComplexidadeComCobertura(
  estrutura: Array<{ file: string; functions: FuncaoParaCruzamento[] }>,
  cobertura: CoverageReport,
): ComplexidadeCoberta {
  const porArquivo: ComplexidadeCoberta["porArquivo"] = [];
  let cobertaTotal = 0;
  let naoCobertaTotal = 0;

  // Índice de linhas cobertas por arquivo, para lookup O(1) por função.
  const cobertasPorArquivo = new Map<string, Set<number>>();
  for (const f of cobertura.files) {
    cobertasPorArquivo.set(f.path, new Set(f.coveredLines));
  }

  for (const arq of estrutura) {
    const covered = cobertasPorArquivo.get(arq.file);
    let coberta = 0;
    let naoCoberta = 0;

    for (const fn of arq.functions) {
      // Função sem intervalo válido (parse parcial) entra como não coberta —
      // é o lado seguro: subestimar cobertura, nunca superestimar.
      const fim = fn.endLine > 0 ? fn.endLine : fn.startLine;
      const cob = covered ? funcaoCoberta({ ...fn, endLine: fim }, covered) : false;
      if (cob) coberta += fn.cyclomatic;
      else naoCoberta += fn.cyclomatic;
    }

    const total = coberta + naoCoberta;
    const percentual = total <= 0 ? 100 : Math.round((coberta / total) * 1000) / 10;
    porArquivo.push({ file: arq.file, coberta, naoCoberta, percentual });
    cobertaTotal += coberta;
    naoCobertaTotal += naoCoberta;
  }

  const totalGeral = cobertaTotal + naoCobertaTotal;
  return {
    coberta: cobertaTotal,
    naoCoberta: naoCobertaTotal,
    percentual: totalGeral <= 0 ? 100 : Math.round((cobertaTotal / totalGeral) * 1000) / 10,
    porArquivo: porArquivo.sort((a, b) => b.naoCoberta - a.naoCoberta),
  };
}

/**
 * Agrega o resultado no contador de BRANCHES do relatório de cobertura.
 *
 * A complexidade não coberta é, na prática, o mesmo risco que o branch
 * coverage mede: cada `if` é um caminho que pode estar errado. Por isso o
 * resultado alimenta o mesmo slot — quem já lê `branches` no gate passa a
 * ver a complexidade não coberta como denominador equivalente.
 */
export function comoContadorDeBranches(c: ComplexidadeCoberta): CoverageCounter {
  return { covered: c.coberta, total: c.coberta + c.naoCoberta };
}
