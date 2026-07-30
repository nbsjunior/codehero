import { walk, type ParsedFile, type StructuralLanguage, type SyntaxNode } from "./parser.ts";

// ---------------------------------------------------------------------------
// Métricas estruturais: ciclomática, cognitiva, aninhamento, tamanho e
// parâmetros — por função e agregadas por arquivo.
//
// Estas são as métricas que a regex por linha NÃO alcança, e por isso o eixo
// de manutenibilidade do CodeHero vivia só do débito de smells de superfície.
//
// Os nomes de nó variam por gramática (`elif_clause` em Python, `catch_clause`
// em Java, `switch_section` em C#), então cada conjunto é a UNIÃO dos nomes das
// 6 gramáticas. Um nome que não exista numa gramática simplesmente nunca casa.
// ---------------------------------------------------------------------------

/** Nós que somam +1 na complexidade ciclomática (um ponto de decisão cada). */
const DECISAO = new Set([
  "if_statement",
  "elif_clause",
  "else_if_clause",
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "for_range_loop",
  "enhanced_for_statement",
  "while_statement",
  "do_statement",
  "catch_clause",
  "except_clause",
  "conditional_expression",
  "ternary_expression",
  "case_clause",
  "switch_case",
  "switch_section",
  "expression_case",
  "default_case",
  "expression_switch_statement",
  "type_switch_statement",
  "communication_case",
]);

/** Operadores booleanos: cada um adiciona um caminho. */
const LOGICOS = new Set(["&&", "||", "and", "or", "??"]);

/** Estruturas que AUMENTAM o nível de aninhamento na complexidade cognitiva. */
const ANINHA = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "for_range_loop",
  "enhanced_for_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "expression_switch_statement",
  "type_switch_statement",
  "try_statement",
  "catch_clause",
  "except_clause",
]);

/** Declarações de função/método por gramática. */
const FUNCOES = new Set([
  "function_declaration",
  "function_definition",
  "function_item",
  "method_definition",
  "method_declaration",
  "constructor_declaration",
  "local_function_statement",
  "arrow_function",
  "function_expression",
  "generator_function_declaration",
  "func_literal",
  "lambda",
]);

const PARAMETROS = new Set([
  "formal_parameters",
  "parameters",
  "parameter_list",
  "formal_parameter_list",
]);

export interface FunctionMetrics {
  name: string | null;
  startLine: number;
  endLine: number;
  lines: number;
  cyclomatic: number;
  cognitive: number;
  maxNesting: number;
  params: number;
}

export interface FileMetrics {
  file: string;
  language: StructuralLanguage;
  /** Árvore teve erro de sintaxe — números podem estar subestimados. */
  parseError: boolean;
  linesOfCode: number;
  commentLines: number;
  /** Soma da ciclomática das funções (mínimo 1 por arquivo com código). */
  cyclomatic: number;
  cognitive: number;
  maxNesting: number;
  functions: FunctionMetrics[];
}

function nodeName(n: SyntaxNode): string | null {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && (c.type === "identifier" || c.type === "property_identifier" || c.type === "field_identifier")) {
      return null; // sem acesso ao texto na interface mínima; nome é opcional
    }
  }
  return null;
}

function contaOperadoresLogicos(n: SyntaxNode): number {
  let extra = 0;
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && LOGICOS.has(c.type)) extra++;
  }
  return extra;
}

/**
 * Complexidade cognitiva (modelo do SonarSource, aproximado).
 *
 * Difere da ciclomática em duas coisas que importam: `else if` encadeado conta
 * menos que aninhamento real, e cada nível de aninhamento aplica uma
 * penalidade incremental. É por isso que ela reflete melhor "dificuldade de
 * entender" do que "número de caminhos".
 */
function calcula(root: SyntaxNode): {
  cyclomatic: number;
  cognitive: number;
  maxNesting: number;
} {
  let cyclomatic = 1;
  let cognitive = 0;
  let maxNesting = 0;

  // O nível de aninhamento é carregado NA PILHA, não guardado num Map por nó:
  // o web-tree-sitter devolve um wrapper novo a cada `child()`, então a
  // identidade do objeto não é estável e um Map jamais acertaria a chave.
  // (Custou duas asserções vermelhas para aparecer.)
  const stack: Array<{ n: SyntaxNode; nivel: number }> = [{ n: root, nivel: 0 }];

  while (stack.length) {
    const { n, nivel } = stack.pop()!;

    // Um nó que aninha eleva o nível para os seus descendentes.
    const nivelFilhos = ANINHA.has(n.type) ? nivel + 1 : nivel;
    if (nivelFilhos > maxNesting) maxNesting = nivelFilhos;

    if (DECISAO.has(n.type)) {
      cyclomatic++;
      // Incremento cognitivo = 1 + o nível em que a decisão ESTÁ (não o dos
      // filhos): é isso que faz `if` aninhado custar mais que `if` sequencial.
      cognitive += 1 + nivel;
    }
    const logicos = contaOperadoresLogicos(n);
    cyclomatic += logicos;
    cognitive += logicos; // operador booleano não sofre penalidade de nível

    // Cadeia `else if` NÃO é aninhamento — é a distinção que define
    // complexidade cognitiva. Um `parseArgs` com 15 `else if` é fácil de ler;
    // 15 `if` aninhados não são. A forma da árvore difere por gramática:
    //   JS/TS      if_statement -> else_clause -> if_statement
    //   Java/C#/Go if_statement -> token `else` -> if_statement (irmão direto)
    //   Python     elif_clause (irmão plano; já não aninha)
    // Por isso o discriminante é a POSIÇÃO: filho que vem depois do `else`.
    // Uma regra ingênua ("if dentro de if") classificaria errado o
    // `if (a) if (b) x()`, que é aninhamento de verdade.
    const ehIf = n.type === "if_statement";
    let depoisDoElse = false;
    const filhos: Array<{ n: SyntaxNode; nivel: number }> = [];

    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (!c) continue;

      const ehElse = ehIf && (c.type === "else" || c.type === "else_clause");
      let nivelFilho = nivelFilhos;
      if (ehIf && (c.type === "else_clause" || c.type === "elif_clause")) {
        // JS/TS: `else_clause`. Python: `elif_clause`, irmão do `if`. Nos dois
        // casos a continuação da cadeia fica no nível do próprio `if` — sem
        // isto, Python dava cognitiva 11 onde as outras 5 linguagens davam 6
        // para exatamente a mesma cadeia.
        nivelFilho = nivel;
      } else if (ehIf && depoisDoElse && c.type === "if_statement") {
        nivelFilho = nivel; // Java/C#/Go: `else if` é continuação, não aninhamento
      }
      if (ehElse) depoisDoElse = true;

      filhos.push({ n: c, nivel: nivelFilho });
    }

    for (let i = filhos.length - 1; i >= 0; i--) stack.push(filhos[i]!);
  }

  return { cyclomatic, cognitive, maxNesting };
}

function contaParametros(fn: SyntaxNode): number {
  for (let i = 0; i < fn.childCount; i++) {
    const c = fn.child(i);
    if (!c || !PARAMETROS.has(c.type)) continue;
    let n = 0;
    for (let j = 0; j < c.childCount; j++) {
      const p = c.child(j);
      // Vírgulas e parênteses são filhos também; só contam nós nomeados.
      if (p && p.type !== "," && p.type !== "(" && p.type !== ")" && p.type !== "[" && p.type !== "]") n++;
    }
    return n;
  }
  return 0;
}

const COMENTARIO = /comment/;

export function computeFileMetrics(file: string, source: string, parsed: ParsedFile): FileMetrics {
  const doArquivo = calcula(parsed.root);

  const functions: FunctionMetrics[] = [];
  let commentLines = 0;

  walk(parsed.root, (n) => {
    if (COMENTARIO.test(n.type)) {
      commentLines += n.endPosition.row - n.startPosition.row + 1;
      return;
    }
    if (!FUNCOES.has(n.type)) return;
    const m = calcula(n);
    functions.push({
      name: nodeName(n),
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      lines: n.endPosition.row - n.startPosition.row + 1,
      cyclomatic: m.cyclomatic,
      cognitive: m.cognitive,
      maxNesting: m.maxNesting,
      params: contaParametros(n),
    });
  });

  return {
    // POSIX sempre: os findings do SARIF normalizam, e caminho divergente faria
    // o ingest tratar o mesmo arquivo como dois.
    file: file.split("\\").join("/"),
    language: parsed.language,
    parseError: parsed.hasError,
    linesOfCode: source.length ? source.split("\n").length : 0,
    commentLines,
    cyclomatic: doArquivo.cyclomatic,
    cognitive: doArquivo.cognitive,
    maxNesting: doArquivo.maxNesting,
    functions: functions.sort((a, b) => a.startLine - b.startLine),
  };
}

// ---------------------------------------------------------------------------
// Limiares → apontamentos. São as regras de smell ESTRUTURAL que a regex nunca
// alcançou; os valores default seguem os do mercado.
// ---------------------------------------------------------------------------

export interface StructuralThresholds {
  maxCyclomatic: number;
  maxCognitive: number;
  maxNesting: number;
  maxFunctionLines: number;
  maxParams: number;
}

export const DEFAULT_STRUCTURAL_THRESHOLDS: StructuralThresholds = {
  maxCyclomatic: 15,
  maxCognitive: 15,
  maxNesting: 4,
  maxFunctionLines: 60,
  maxParams: 7,
};

export interface StructuralFinding {
  ruleId: string;
  file: string;
  startLine: number;
  message: string;
  /** Valor medido e limiar, para a ficha do apontamento. */
  measured: number;
  threshold: number;
}

const REGRAS = [
  {
    id: "HERO-SMELL-CYCLOMATIC",
    campo: "cyclomatic" as const,
    limiar: "maxCyclomatic" as const,
    msg: (v: number, t: number) =>
      `Complexidade ciclomática ${v} acima do limite ${t}: a função tem caminhos de execução demais para ser testada com confiança.`,
  },
  {
    id: "HERO-SMELL-COGNITIVE",
    campo: "cognitive" as const,
    limiar: "maxCognitive" as const,
    msg: (v: number, t: number) =>
      `Complexidade cognitiva ${v} acima do limite ${t}: o aninhamento torna o fluxo difícil de acompanhar.`,
  },
  {
    id: "HERO-SMELL-NESTING",
    campo: "maxNesting" as const,
    limiar: "maxNesting" as const,
    msg: (v: number, t: number) =>
      `Aninhamento de ${v} níveis acima do limite ${t}: extraia os blocos internos ou inverta as condições.`,
  },
  {
    id: "HERO-SMELL-LONG-FUNCTION",
    campo: "lines" as const,
    limiar: "maxFunctionLines" as const,
    msg: (v: number, t: number) =>
      `Função com ${v} linhas acima do limite ${t}: provavelmente faz mais de uma coisa.`,
  },
  {
    id: "HERO-SMELL-PARAM-COUNT",
    campo: "params" as const,
    limiar: "maxParams" as const,
    msg: (v: number, t: number) =>
      `Função com ${v} parâmetros acima do limite ${t}: considere agrupá-los num objeto.`,
  },
];

export function structuralFindings(
  metrics: FileMetrics,
  thresholds: StructuralThresholds = DEFAULT_STRUCTURAL_THRESHOLDS,
): StructuralFinding[] {
  // Árvore com erro de sintaxe produz números pela metade; reportar limiar
  // sobre eles geraria falso positivo silencioso.
  if (metrics.parseError) return [];

  const out: StructuralFinding[] = [];
  for (const fn of metrics.functions) {
    for (const regra of REGRAS) {
      const valor = fn[regra.campo];
      const limite = thresholds[regra.limiar];
      if (valor > limite) {
        out.push({
          ruleId: regra.id,
          file: metrics.file,
          startLine: fn.startLine,
          message: regra.msg(valor, limite),
          measured: valor,
          threshold: limite,
        });
      }
    }
  }
  return out;
}
