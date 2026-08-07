import {
  isKind,
  type NodeKind,
  type SemanticConstraint,
  type StructuralSpec,
} from "@codehero/contracts";
import type { ParsedFile, SyntaxNode } from "./parser.ts";
import { EMPTY_SEMANTIC_INDEX, type SemanticIndex } from "../semantic/types.ts";

// ---------------------------------------------------------------------------
// Avaliador de regras estruturais.
//
// Roda sobre a árvore do tree-sitter, então vale para as 6 linguagens com
// gramática — e não para uma só, como o L1 anterior (Babel, JS/TS).
//
// Determinístico do começo ao fim: sem modelo, sem heurística probabilística.
// A profundidade vem da ÁRVORE, não de adivinhação.
// ---------------------------------------------------------------------------

/** Nós que representam valor constante em tempo de compilação. */
const LITERAIS = new Set([
  "string",
  "string_literal",
  "interpreted_string_literal",
  "raw_string_literal",
  "verbatim_string_literal",
  "concatenated_string",
  "number",
  "integer",
  "float",
  "integer_literal",
  "real_literal",
  "decimal_integer_literal",
  "true",
  "false",
  "null",
  "none",
  "null_literal",
  "boolean_literal",
  "nil",
]);

/**
 * Template literal SEM interpolação ainda é constante; COM interpolação não é.
 * `eval(\`x\`)` é inofensivo; `eval(\`${entrada}\`)` não é — e para a regex os
 * dois são a mesma coisa.
 */
function temInterpolacao(n: SyntaxNode): boolean {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i);
    if (c && (c.type === "template_substitution" || c.type === "interpolation")) return true;
  }
  return false;
}

/** Nós de string que PODEM carregar interpolação, dependendo do conteúdo. */
const STRINGS_INTERPOLAVEIS = new Set([
  "template_string", // JS/TS
  "string", // Python: f"{x}" é um `string` com filho `interpolation`
  "interpolated_string_expression", // C#
]);

function ehLiteral(n: SyntaxNode): boolean {
  // Uma f-string do Python tem tipo `string` igual a uma string comum: só a
  // presença do nó `interpolation` separa `exec("x")` de `exec(f"{x}")`.
  // Sem esta checagem o segundo passava como constante e a regra CRITICAL
  // silenciava justamente no caso perigoso.
  if (STRINGS_INTERPOLAVEIS.has(n.type)) return !temInterpolacao(n);
  if (LITERAIS.has(n.type)) return true;
  // Literal negativo (`-1`) e agrupamento (`("x")`) continuam constantes.
  if (n.type === "unary_expression" || n.type === "parenthesized_expression") {
    const c = n.namedChild(0);
    return c ? ehLiteral(c) : false;
  }
  return false;
}

/** Campo `function`/`arguments` varia de nome entre gramáticas. */
function calleeDe(n: SyntaxNode): SyntaxNode | null {
  return (
    n.childForFieldName("function") ??
    n.childForFieldName("name") ??
    n.childForFieldName("constructor") ??
    n.namedChild(0)
  );
}

function argumentosDe(n: SyntaxNode): SyntaxNode[] {
  const lista =
    n.childForFieldName("arguments") ?? n.childForFieldName("argument_list") ?? null;
  const alvo = lista ?? n;
  const out: SyntaxNode[] = [];
  for (let i = 0; i < alvo.namedChildCount; i++) {
    const c = alvo.namedChild(i);
    // Quando não há nó de lista, o callee é o primeiro filho nomeado — pular.
    if (!c) continue;
    if (!lista && i === 0) continue;
    // C# embrulha cada argumento num nó `argument`.
    out.push(c.type === "argument" ? (c.namedChild(0) ?? c) : c);
  }
  return out;
}

/**
 * Testa o regex contra o texto INTEIRO do callee e contra o último segmento.
 *
 * Em código real quase toda chamada é qualificada — `db.query(...)`,
 * `conn.execute(...)`, `this.repo.find(...)`. Uma regra `^query$` casada só
 * contra o texto inteiro nunca dispararia, e a regra pareceria funcionar
 * (verde nos testes com chamada nua) enquanto era inútil em produção.
 *
 * Aceitar os dois mantém a expressividade: `^query$` pega o método em qualquer
 * receptor, e `^db\.query$` continua podendo exigir o receptor específico.
 */
function casaCallee(re: RegExp, texto: string): boolean {
  if (re.test(texto)) return true;
  const ultimo = texto.split(/[.:]/).pop();
  return ultimo !== undefined && ultimo !== texto && re.test(ultimo);
}

/** Funções que existem para montar string a partir de partes. */
const MONTADORES = /^(Sprintf|Sprint|Fprintf|format|Format|concat|join|printf)$/;

/**
 * A string foi REMENDADA em tempo de execução?
 *
 * É a forma estrutural da injeção: `"SELECT ... " + id`, `` `... ${id}` ``,
 * `"..." % id`, `"...".format(id)`, `fmt.Sprintf("...", id)`. Todas têm em
 * comum um literal de string costurado com um valor — e isso a árvore mostra.
 *
 * Um identificador sozinho (`db.query(sql)`) NÃO conta: pode ser uma constante
 * e o rastro de onde `sql` veio é trabalho do motor de taint (L2), não desta
 * regra. Aqui o critério é precisão.
 */
function ehMontado(n: SyntaxNode): boolean {
  if (STRINGS_INTERPOLAVEIS.has(n.type)) return temInterpolacao(n);

  // Concatenação/formatação: `"a" + x`, `"a %s" % x`.
  if (n.type === "binary_expression" || n.type === "binary_operator") {
    let temString = false;
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (!c) continue;
      if (ehMontado(c)) return true;
      if (LITERAIS.has(c.type) || STRINGS_INTERPOLAVEIS.has(c.type)) temString = true;
    }
    return temString;
  }

  if (n.type === "parenthesized_expression") {
    const c = n.namedChild(0);
    return c ? ehMontado(c) : false;
  }

  // `fmt.Sprintf(...)`, `"...".format(...)`, `String.join(...)`.
  if (/call|invocation/.test(n.type)) {
    const callee = calleeDe(n);
    if (!callee) return false;
    const ultimo = callee.text.split(/[.:]/).pop() ?? callee.text;
    return MONTADORES.test(ultimo);
  }

  return false;
}

function temAncestral(n: SyntaxNode, kinds: NodeKind[]): boolean {
  let p = n.parent;
  while (p) {
    if (kinds.some((k) => isKind(p!.type, k))) return true;
    p = p.parent;
  }
  return false;
}

/** Corpo sem nenhum nó nomeado — comentário não é nó nomeado nas gramáticas. */
function corpoVazio(n: SyntaxNode): boolean {
  const corpo = n.childForFieldName("body") ?? n.childForFieldName("consequence") ?? n;
  for (let i = 0; i < corpo.namedChildCount; i++) {
    const c = corpo.namedChild(i);
    // Em algumas gramáticas o parâmetro do catch é filho nomeado do próprio
    // catch_clause; ele não conta como "conteúdo".
    if (c && !/comment/.test(c.type) && c !== corpo) {
      if (corpo === n && (c.type === "identifier" || /parameter|declaration/.test(c.type))) continue;
      if (corpo === n && /block|body|statement/.test(c.type)) return corpoVazio(c);
      return false;
    }
  }
  return true;
}

function casaArgumento(args: SyntaxNode[], c: NonNullable<StructuralSpec["argument"]>): boolean {
  const idx = c.index ?? "any";
  const candidatos =
    idx === "any"
      ? args
      : idx === "last"
        ? args.slice(-1)
        : args[idx] !== undefined
          ? [args[idx]!]
          : [];
  if (candidatos.length === 0) return false;

  const satisfaz = (a: SyntaxNode) => {
    if (c.is === "literal" && !ehLiteral(a)) return false;
    if (c.is === "non-literal" && ehLiteral(a)) return false;
    if (c.is === "assembled" && !ehMontado(a)) return false;
    if (c.matches && !new RegExp(c.matches).test(a.text)) return false;
    return true;
  };

  // `any` = ALGUM argumento satisfaz; índice explícito = AQUELE satisfaz.
  return idx === "any" ? candidatos.some(satisfaz) : candidatos.every(satisfaz);
}

/**
 * A restrição semântica é satisfeita nesta posição?
 *
 * A regra do "sem informação" é explícita porque é onde se erra: um arquivo
 * fora do Program não é um arquivo limpo, é um arquivo desconhecido. Tratar os
 * dois igual foi o que fez a versão anterior gritar em JS sem tipos.
 */
function casaSemantica(
  c: SemanticConstraint,
  idx: SemanticIndex,
  file: string,
  linha: number,
  coluna: number,
): boolean {
  const fato = idx.at(file, linha, coluna);
  if (!fato) return c.requireSemantic !== true;

  if (c.calleeFrom && !c.calleeFrom.includes(fato.origin)) return false;
  if (c.awaitable !== undefined && fato.awaitable !== c.awaitable) return false;
  if (c.receiverTypeMatches) {
    if (!fato.receiverType) return c.requireSemantic !== true;
    try {
      if (!new RegExp(c.receiverTypeMatches).test(fato.receiverType)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Contexto opcional: sem ele, regras com `semantic` degradam para a árvore. */
export interface StructuralContext {
  semantic: SemanticIndex;
  /** Caminho como o scanner o reporta — a chave do índice. */
  file: string;
}

export interface StructuralMatch {
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
}

/** JS RegExp does not accept `(?i)` inline; map it to the `i` flag. */
function compileRe(src: string): RegExp {
  if (src.startsWith("(?i)")) return new RegExp(src.slice(4), "i");
  return new RegExp(src);
}

/** Todos os pontos de um arquivo que satisfazem a especificação. */
export function matchStructural(
  parsed: ParsedFile,
  spec: StructuralSpec,
  ctx?: StructuralContext,
): StructuralMatch[] {
  // Árvore com erro dá forma incompleta: um match daí seria artefato.
  if (parsed.hasError) return [];
  // Regra restrita a dialeto: ver o porquê em `StructuralSpec.languages`.
  if (spec.languages && !spec.languages.includes(parsed.language)) return [];

  const out: StructuralMatch[] = [];
  const stack: SyntaxNode[] = [parsed.root];

  let calleeRe: RegExp | null = null;
  let textoRe: RegExp | null = null;
  try {
    calleeRe = spec.callee ? compileRe(spec.callee) : null;
    textoRe = spec.textMatches ? compileRe(spec.textMatches) : null;
  } catch {
    return []; // regex inválida na regra não pode derrubar o scan
  }

  while (stack.length) {
    const n = stack.pop()!;
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c) stack.push(c);
    }

    if (!isKind(n.type, spec.match)) continue;
    if (spec.inside && !temAncestral(n, spec.inside)) continue;
    if (spec.notInside && temAncestral(n, spec.notInside)) continue;
    if (textoRe && !textoRe.test(n.text)) continue;
    if (spec.empty === true && !corpoVazio(n)) continue;
    if (spec.empty === false && corpoVazio(n)) continue;

    if (calleeRe) {
      const callee = calleeDe(n);
      if (!callee) continue;
      const texto = callee.text;
      if (spec.calleeUnqualified) {
        // Chamada nua apenas: `exec(x)` conta, `re.exec(x)` nao.
        if (/[.:]/.test(texto) || !calleeRe.test(texto)) continue;
      } else if (!casaCallee(calleeRe, texto)) {
        continue;
      }
    }
    if (spec.argument && !casaArgumento(argumentosDe(n), spec.argument)) continue;

    const linha = n.startPosition.row;
    if (
      spec.semantic &&
      !casaSemantica(
        spec.semantic,
        ctx?.semantic ?? EMPTY_SEMANTIC_INDEX,
        ctx?.file ?? "",
        linha + 1,
        n.startPosition.column + 1,
      )
    ) {
      continue;
    }
    out.push({
      startLine: linha + 1,
      startColumn: n.startPosition.column + 1,
      endColumn: n.endPosition.row === linha ? n.endPosition.column + 1 : n.startPosition.column + 2,
      snippet: n.text.split("\n")[0]!.trim().slice(0, 200),
    });
  }

  return out;
}
