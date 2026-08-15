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
  "evaluate_statement", // COBOL
  "when_clause", // COBOL EVALUATE WHEN
  "perform_until_statement", // COBOL loop PERFORM
  "goto_statement", // COBOL GO TO — each is a path edge
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
  "evaluate_statement",
  "perform_until_statement",
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
  "paragraph", // COBOL
  "procedure_definition", // T-SQL
]);

/** Métodos de classe (Java, C#, TS, etc.) — subset de FUNCOES. */
const METODOS = new Set([
  "method_definition",
  "method_declaration",
  "constructor_declaration",
]);

/** Funções livres / top-level (não métodos). */
const FUNCOES_LIVRES = new Set([
  "function_declaration",
  "function_definition",
  "function_item",
  "local_function_statement",
  "arrow_function",
  "function_expression",
  "generator_function_declaration",
  "func_literal",
  "lambda",
]);

/** Classes / tipos com corpo (Java, C#, TS, Python…). COBOL não tem. */
const CLASSES = new Set([
  "class_declaration",
  "class_definition",
  "class",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
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
  /** Volume de Halstead da funcao. */
  halsteadVolume: number;
  /** Indice de Manutenibilidade 0-100 desta funcao. */
  maintainabilityIndex: number;
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
  /** Volume de Halstead do arquivo — insumo do indice de manutenibilidade. */
  halsteadVolume: number;
  /** Indice de Manutenibilidade 0-100 (variante Microsoft). */
  maintainabilityIndex: number;
  /** Classes / interfaces / records no arquivo (0 em COBOL). */
  classes: number;
  /** Métodos de classe (Java/C#/TS…). */
  methods: number;
  /** Funções livres / top-level. */
  freeFunctions: number;
  /** Parágrafos COBOL. */
  paragraphs: number;
  /** Procedures (T-SQL / SQL PL). */
  procedures: number;
  functions: FunctionMetrics[];
}

function nodeName(n: SyntaxNode): string | null {
  const named = n.childForFieldName("name");
  if (named?.text) return named.text;
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && (c.type === "identifier" || c.type === "property_identifier" || c.type === "field_identifier")) {
      return c.text || null;
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
  const hal = halsteadDe(parsed.root);
  const loc = source.length ? source.split("\n").length : 0;

  const functions: FunctionMetrics[] = [];
  let commentLines = 0;
  let classes = 0;
  let methods = 0;
  let freeFunctions = 0;
  let paragraphs = 0;
  let procedures = 0;

  walk(parsed.root, (n) => {
    if (COMENTARIO.test(n.type)) {
      commentLines += n.endPosition.row - n.startPosition.row + 1;
      return;
    }
    if (CLASSES.has(n.type)) classes += 1;
    if (METODOS.has(n.type)) methods += 1;
    if (FUNCOES_LIVRES.has(n.type)) freeFunctions += 1;
    if (n.type === "paragraph") paragraphs += 1;
    if (n.type === "procedure_definition") procedures += 1;

    if (!FUNCOES.has(n.type)) return;
    const m = calcula(n);
    const h = halsteadDe(n);
    const linhasFn = n.endPosition.row - n.startPosition.row + 1;
    functions.push({
      name: nodeName(n),
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      lines: n.endPosition.row - n.startPosition.row + 1,
      cyclomatic: m.cyclomatic,
      cognitive: m.cognitive,
      maxNesting: m.maxNesting,
      params: contaParametros(n),
      halsteadVolume: h.volume,
      maintainabilityIndex: indiceManutenibilidade(h.volume, m.cyclomatic, linhasFn),
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
    halsteadVolume: hal.volume,
    // MI do arquivo = média das funções PONDERADA POR LINHA, e não o cálculo
    // direto sobre o arquivo inteiro.
    //
    // A diferença não é cosmética. A fórmula tem um termo `16.2·ln(LOC)`, e
    // num arquivo de novecentas linhas ele sozinho vale mais de cem pontos:
    // TODO arquivo grande dá zero, inclusive um perfeitamente organizado em
    // funções pequenas. Medido aqui: `lineTaint.ts` dava 0 e um utilitário de
    // 23 linhas dava 51.8, o que diz mais sobre o tamanho do arquivo do que
    // sobre a manutenibilidade dele.
    //
    // Visual Studio e as demais ferramentas calculam por MÉTODO. Usar outra
    // unidade faria o número do CodeHero não bater com o que o time já viu em
    // outro lugar, e um índice incomparável não serve para decidir nada.
    //
    // Arquivo sem função nenhuma (dado, configuração) cai no cálculo direto:
    // ali o arquivo É a unidade.
    maintainabilityIndex: functions.length
      ? Math.round(
          (functions.reduce((a, f) => a + f.maintainabilityIndex * Math.max(f.lines, 1), 0) /
            functions.reduce((a, f) => a + Math.max(f.lines, 1), 0)) * 10,
        ) / 10
      : indiceManutenibilidade(hal.volume, doArquivo.cyclomatic, loc),
    classes,
    methods,
    freeFunctions,
    paragraphs,
    procedures,
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

// ---------------------------------------------------------------------------
// Halstead e Índice de Manutenibilidade.
//
// Por que Halstead precisa existir aqui
// ---------------------------------------------------------------------------
// O Índice de Manutenibilidade clássico é
//
//   MI = 171 − 5.2·ln(V) − 0.23·G − 16.2·ln(LOC)
//
// e o `V` é o volume de Halstead. Sem ele não dá para calcular o índice; dá
// para calcular OUTRA coisa e chamar pelo mesmo nome, que é pior, porque o
// número vira incomparável com qualquer ferramenta do mercado e ninguém
// percebe.
//
// Como operador e operando são separados sem `isNamed`
// ---------------------------------------------------------------------------
// A superfície de nó que este motor consome não expõe `isNamed`. Mas o
// tree-sitter dá o mesmo sinal por outro caminho: em token anônimo o `type` É
// o próprio texto (`+`, `if`, `{`), enquanto em nó nomeado o `type` é a
// categoria e o texto é o conteúdo (`identifier` contra `usuario`).
//
//   folha e type === text   → operador
//   folha e type !== text   → operando
//
// A exceção são os literais que também são palavras: `true`, `false`, `null`.
// Neles type e text coincidem e mesmo assim são operandos — estão listados.
//
// Pontuação de agrupamento fica FORA das duas contagens. Contar `(`, `)`, `;`
// e `,` como operador infla o vocabulário com ruído sintático que não diz
// nada sobre a dificuldade de ler o código, e as implementações sérias
// também os descartam.
// ---------------------------------------------------------------------------

/** Literais que o tree-sitter representa como token de texto igual ao tipo. */
const OPERANDO_PALAVRA = new Set([
  "true", "false", "null", "nil", "None", "True", "False", "undefined", "NULL",
]);

/** Agrupamento e separação: ruído sintático, não operador. */
const PONTUACAO = new Set(["(", ")", "[", "]", "{", "}", ";", ",", ":", "."]);

export interface Halstead {
  /** Operadores distintos (n1). */
  operadoresDistintos: number;
  /** Operandos distintos (n2). */
  operandosDistintos: number;
  /** Total de operadores (N1). */
  operadores: number;
  /** Total de operandos (N2). */
  operandos: number;
  /** N · log2(n) — o tamanho em bits de uma implementação da mesma lógica. */
  volume: number;
}

export function halsteadDe(root: SyntaxNode): Halstead {
  const opDistintos = new Set<string>();
  const odDistintos = new Set<string>();
  let ops = 0;
  let odds = 0;

  walk(root, (n) => {
    if (n.childCount > 0) return; // só folhas
    const t = n.type;
    const txt = n.text;
    if (COMENTARIO.test(t)) return;
    if (PONTUACAO.has(t)) return;
    if (!txt.trim()) return;

    if (t === txt && !OPERANDO_PALAVRA.has(t)) {
      opDistintos.add(t);
      ops++;
    } else {
      odDistintos.add(txt);
      odds++;
    }
  });

  const n = opDistintos.size + odDistintos.size;
  const N = ops + odds;
  return {
    operadoresDistintos: opDistintos.size,
    operandosDistintos: odDistintos.size,
    operadores: ops,
    operandos: odds,
    volume: n > 0 ? Math.round(N * Math.log2(n) * 100) / 100 : 0,
  };
}

/**
 * Índice de Manutenibilidade na escala 0–100 (variante da Microsoft).
 *
 * A fórmula original de Coleman/Oman devolve algo entre −∞ e 171, o que é
 * inútil numa tela: ninguém sabe se 94 é bom. A Microsoft normalizou para
 * 0–100 cortando o negativo, e é essa a versão que Visual Studio e a maioria
 * das ferramentas mostram — usar outra faria o número do CodeHero não bater
 * com o que o time já viu em outro lugar.
 *
 * As faixas seguem a mesma convenção: abaixo de 10 é vermelho, até 20 é
 * amarelo, acima disso é verde. São faixas ESTREITAS de propósito na ponta
 * ruim, porque a queda de manutenibilidade é logarítmica: sair de 25 para 15
 * dói muito mais que de 65 para 55.
 */
export function indiceManutenibilidade(
  volumeHalstead: number,
  ciclomatica: number,
  linhasDeCodigo: number,
): number {
  if (linhasDeCodigo <= 0) return 100;
  const v = Math.max(volumeHalstead, 1);
  const loc = Math.max(linhasDeCodigo, 1);
  const bruto = 171 - 5.2 * Math.log(v) - 0.23 * ciclomatica - 16.2 * Math.log(loc);
  return Math.round(Math.max(0, (bruto * 100) / 171) * 10) / 10;
}

/** Faixa de leitura do índice, na convenção que o mercado já usa. */
export function faixaManutenibilidade(mi: number): "boa" | "atencao" | "ruim" {
  if (mi < 10) return "ruim";
  if (mi < 20) return "atencao";
  return "boa";
}
