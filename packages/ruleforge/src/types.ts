import type { HeroRule } from "@codehero/contracts";

export interface CorpusCase {
  id: string;
  ruleId: string;
  code: string;
  expected: "match" | "no_match";
  note?: string;
  /**
   * Perfil léxico do trecho (`clike`, `python`, `sql`, `cobol`, `vbnet`).
   *
   * Passou a importar quando o motor ganhou máscara de comentário/string: um
   * `# TODO` só é comentário sob o perfil do Python. Sem isto o corpus avalia
   * todo caso como C-like e reprova regra que funciona em produção — onde o
   * scanner conhece a extensão do arquivo.
   */
  profile?: string;
  /**
   * `lexico` (padrão) avalia o trecho com o casador de padrão, uma linha.
   * `fluxo` roda o motor de fluxo de dados sobre o trecho inteiro.
   *
   * Sem isto as regras de taint — as mais graves do catálogo — não podiam ter
   * caso nenhum: o apontamento delas nasce de o valor ter viajado por várias
   * linhas, e a linha do uso final, sozinha, não casa com padrão algum.
   */
  avaliacao?: "lexico" | "fluxo";
  /**
   * Família de linguagem para o motor de fluxo (`java`, `python`, `csharp`).
   * O perfil léxico não serve aqui: ele diz como comentar e citar, não de onde
   * vem entrada de usuário.
   */
  language?: string;
}

export interface EvalFailure {
  caseId: string;
  expected: CorpusCase["expected"];
  actual: CorpusCase["expected"];
  code: string;
  note?: string;
}

export interface EvalResult {
  ruleId: string;
  cases: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number;
  recall: number;
  f1: number;
  failures: EvalFailure[];
}

/**
 * A mutation is a pure, named transformation of a rule's pattern. Mutations
 * are hand-curated (or, in V1+, proposed offline by an LLM from CWE/CVE
 * descriptions — see llmGenerator.ts) but ALWAYS scored by the same
 * deterministic corpus evaluator before they can be promoted. The LLM (or a
 * human) proposes; the corpus decides.
 */
export interface Mutation {
  id: string;
  description: string;
  apply: (pattern: HeroRule["pattern"]) => HeroRule["pattern"];
}

export interface Individual {
  /** Bitmask over the rule's mutation pool — which mutations are active. */
  mask: number;
  pattern: HeroRule["pattern"];
  fitness: EvalResult;
}
