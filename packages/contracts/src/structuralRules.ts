// ---------------------------------------------------------------------------
// Regras ESTRUTURAIS — o nível acima da regex por linha.
//
// A regex vê texto. Estas regras veem a ÁRVORE: distinguem `eval(userInput)`
// de `eval("literal")`, sabem que um `catch` está vazio ainda que o `{` e o
// `}` estejam em linhas diferentes, e sabem se uma chamada está dentro de um
// laço. Nenhuma dessas três coisas é expressável por padrão textual.
//
// Continuam DETERMINÍSTICAS: mesma entrada, mesma saída, sem modelo no
// caminho do scan. O que muda é o poder de expressão, não a natureza.
//
// A abstração central é `NodeKind`: um tipo LÓGICO ("chamada de função") que
// mapeia para os nomes reais de cada gramática (`call_expression` em JS,
// `method_invocation` em Java, `invocation_expression` em C#). É o que faz
// UMA regra valer para as 6 linguagens em vez de exigir 6 regras.
// ---------------------------------------------------------------------------

export type NodeKind =
  | "call"
  | "catch"
  | "function"
  | "if"
  | "loop"
  | "try"
  | "string"
  | "assignment"
  | "return"
  | "class";

/**
 * Nomes de nó por gramática, unidos por tipo lógico.
 *
 * Um nome que não exista numa gramática simplesmente nunca casa — não é erro.
 * Por isso a lista é a UNIÃO, e não um mapa por linguagem: mais simples de
 * manter e o custo é uma comparação de string a mais.
 */
export const NODE_KINDS: Record<NodeKind, string[]> = {
  call: [
    "call_expression", // JS, TS, Go, C (e Python usa `call`)
    "call",
    "method_invocation", // Java
    "invocation_expression", // C#
    "object_creation_expression", // C# `new X(...)`
    "new_expression", // JS `new X(...)`
  ],
  catch: ["catch_clause", "except_clause"],
  function: [
    "function_declaration",
    "function_definition",
    "method_definition",
    "method_declaration",
    "constructor_declaration",
    "local_function_statement",
    "arrow_function",
    "function_expression",
    "func_literal",
    "lambda",
  ],
  if: ["if_statement", "elif_clause"],
  loop: [
    "for_statement",
    "for_in_statement",
    "for_of_statement",
    "for_range_loop",
    "enhanced_for_statement",
    "while_statement",
    "do_statement",
  ],
  try: ["try_statement"],
  string: [
    "string",
    "string_literal",
    "interpreted_string_literal", // Go
    "raw_string_literal",
    "template_string",
    "verbatim_string_literal", // C#
    "concatenated_string", // Python "a" "b"
  ],
  assignment: ["assignment_expression", "assignment", "variable_declarator", "local_declaration_statement"],
  return: ["return_statement"],
  class: ["class_declaration", "class_definition", "class_body"],
};

/** Restrição sobre um argumento da chamada. */
export interface ArgumentConstraint {
  /** Índice do argumento (0-based), ou `any` para "algum satisfaz". */
  index?: number | "any" | "last";
  /**
   * `literal` = valor constante em tempo de compilação (string/número).
   * `non-literal` = variável, chamada, concatenação — ou seja, pode carregar
   * dado de fora. É a distinção que separa `eval("x")` de `eval(entrada)`.
   *
   * `assembled` = string MONTADA em tempo de execução: concatenação com
   * literal, template/f-string com interpolação, `Sprintf`/`.format()`.
   * Mais estreito que `non-literal` e mais fiel ao que é SQL Injection — a
   * vulnerabilidade não é "o argumento é variável", é "a query foi remendada
   * com valor de fora". Sem isso a regra pegava `query(collection(), where())`
   * do Firestore: 4 falsos positivos, zero verdadeiros, e ela é CRITICAL.
   */
  is?: "literal" | "non-literal" | "assembled";
  /** Regex sobre o texto do argumento. */
  matches?: string;
}

export interface StructuralSpec {
  /** Tipo lógico do nó onde a regra ancora. */
  match: NodeKind;
  /**
   * Regex sobre o nome do callee (só faz sentido com `match: "call"`).
   *
   * Por padrão casa contra o texto INTEIRO e contra o último segmento, porque
   * em código real quase toda chamada é qualificada (`db.query(...)`).
   */
  callee?: string;
  /**
   * Exige que o callee seja NÃO qualificado — só o nome, sem receptor.
   *
   * Existe por um caso concreto: `exec` é builtin perigoso em Python quando
   * chamado nu (`exec(codigo)`), mas em JS `algo.exec(str)` é
   * RegExp.prototype.exec, inofensivo e onipresente. Sem esta distinção a
   * regra deu 11 falsos positivos e ZERO verdadeiros no próprio repo.
   */
  calleeUnqualified?: boolean;
  /** Restrição sobre argumento (idem). */
  argument?: ArgumentConstraint;
  /**
   * Corpo sem nenhum nó nomeado. Pega `catch {}` e `catch { /* nada * / }`
   * mesmo com chaves em linhas separadas — o que regex por linha não vê.
   */
  empty?: boolean;
  /** Só dispara se estiver dentro de um destes (em qualquer profundidade). */
  inside?: NodeKind[];
  /** Não dispara se estiver dentro de um destes. */
  notInside?: NodeKind[];
  /** Regex sobre o texto INTEIRO do nó — escape para casos difíceis. */
  textMatches?: string;
}

/** Um nome de nó pertence a este tipo lógico? */
export function isKind(nodeType: string, kind: NodeKind): boolean {
  return NODE_KINDS[kind].includes(nodeType);
}

/** Tipos lógicos aos quais um nome de nó pertence (pode ser mais de um). */
export function kindsOf(nodeType: string): NodeKind[] {
  return (Object.keys(NODE_KINDS) as NodeKind[]).filter((k) => isKind(nodeType, k));
}
