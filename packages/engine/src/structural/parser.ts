import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Camada de parsing via tree-sitter (WASM).
//
// POR QUE WASM E NÃO OS BINDINGS NATIVOS: o scanner precisa rodar por `npx` e
// dentro do VSIX do VS Code. Bindings nativos exigem node-gyp ou prebuilds por
// plataforma, o que quebra esses dois canais. O WASM custa alguns ms por
// arquivo e roda em qualquer lugar.
//
// AS VERSÕES SÃO UM PAR CASADO — NÃO ATUALIZE UMA SÓ:
//   web-tree-sitter@0.20.8  +  tree-sitter-wasms@0.1.13
// As gramáticas do tree-sitter-wasms foram compiladas com tree-sitter-cli
// 0.20.x. Rodá-las num runtime 0.26 falha em `getDylinkMetadata` — erro de ABI
// que não menciona versão nenhuma e custa tempo para diagnosticar.
// ---------------------------------------------------------------------------

/** Linguagens com gramática madura disponível. COBOL, T-SQL, DB2 e VB.NET não têm. */
export type StructuralLanguage =
  | "javascript"
  | "typescript"
  /** JSX exige gramática própria: a de `typescript` REJEITA sintaxe JSX. */
  | "tsx"
  | "python"
  | "java"
  | "go"
  | "csharp";

const WASM_FILE: Record<StructuralLanguage, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  python: "tree-sitter-python.wasm",
  java: "tree-sitter-java.wasm",
  go: "tree-sitter-go.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
};

const EXT_TO_LANG: Record<string, StructuralLanguage> = {
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  // .tsx e .jsx vão para a gramática tsx — a de typescript nao aceita JSX e
  // todos os componentes React caiam como erro de sintaxe, sumindo das
  // metricas exatamente onde aninhamento costuma doer.
  ".tsx": "tsx",
  ".mts": "typescript",
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".cs": "csharp",
};

export function structuralLanguageFor(file: string): StructuralLanguage | null {
  const dot = file.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_LANG[file.slice(dot).toLowerCase()] ?? null;
}

/**
 * Superfície do nó que o motor consome. Deliberadamente menor que a do
 * runtime, para não acoplar o engine ao web-tree-sitter — mas grande o
 * bastante para regra ESTRUTURAL, que precisa de:
 *   - `text`             ler o nome do callee, o conteúdo de um literal
 *   - `childForFieldName` navegar por campo nomeado (function, arguments,
 *                        condition, body) em vez de por índice, que varia
 *                        entre gramáticas
 *   - `namedChild`       pular pontuação (vírgula, parêntese)
 *   - `parent`           checar contexto ("está dentro de um laço?")
 */
export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  namedChildCount: number;
  parent: SyntaxNode | null;
  child(i: number): SyntaxNode | null;
  namedChild(i: number): SyntaxNode | null;
  childForFieldName(field: string): SyntaxNode | null;
  hasError(): boolean;
}

interface ParserLike {
  setLanguage(lang: unknown): void;
  parse(src: string): { rootNode: SyntaxNode };
}

interface ParserCtor {
  new (): ParserLike;
  init(): Promise<void>;
  Language: { load(path: string): Promise<unknown> };
}

const require_ = createRequire(import.meta.url);

function grammarDir(): string {
  return join(dirname(require_.resolve("tree-sitter-wasms/package.json")), "out");
}

let initPromise: Promise<ParserCtor> | null = null;
const parserCache = new Map<StructuralLanguage, ParserLike>();

async function getParserCtor(): Promise<ParserCtor> {
  // Import dinâmico: o WASM só é carregado se alguém realmente pedir métricas
  // estruturais, então quem só roda regras L0 não paga nada.
  initPromise ??= (async () => {
    const mod = (await import("web-tree-sitter")) as unknown as {
      default?: ParserCtor;
    } & ParserCtor;
    const Ctor = (mod.default ?? mod) as ParserCtor;
    await Ctor.init();
    return Ctor;
  })();
  return initPromise;
}

/** Parser por linguagem, carregado uma vez e reusado. */
export async function getParser(lang: StructuralLanguage): Promise<ParserLike> {
  const cached = parserCache.get(lang);
  if (cached) return cached;

  const Ctor = await getParserCtor();
  const grammar = await Ctor.Language.load(join(grammarDir(), WASM_FILE[lang]));
  const parser = new Ctor();
  parser.setLanguage(grammar);
  parserCache.set(lang, parser);
  return parser;
}

export interface ParsedFile {
  language: StructuralLanguage;
  root: SyntaxNode;
  /** Árvore com erro de sintaxe: métricas ainda saem, mas ficam sob suspeita. */
  hasError: boolean;
}

export async function parseStructural(file: string, source: string): Promise<ParsedFile | null> {
  const lang = structuralLanguageFor(file);
  if (!lang) return null;
  try {
    const parser = await getParser(lang);
    const tree = parser.parse(source);
    return { language: lang, root: tree.rootNode, hasError: tree.rootNode.hasError() };
  } catch {
    // Gramática ausente ou arquivo que o parser rejeita: seguir sem métrica é
    // melhor que derrubar o scan inteiro.
    return null;
  }
}

/** Percorre a árvore em profundidade. Iterativo — arquivo grande estoura recursão. */
export function walk(root: SyntaxNode, visit: (n: SyntaxNode, depth: number) => void): void {
  const stack: Array<{ n: SyntaxNode; d: number }> = [{ n: root, d: 0 }];
  while (stack.length) {
    const { n, d } = stack.pop()!;
    visit(n, d);
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c) stack.push({ n: c, d: d + 1 });
    }
  }
}
