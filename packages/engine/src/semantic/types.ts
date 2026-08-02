// ---------------------------------------------------------------------------
// Camada SEMÂNTICA — o que a árvore sozinha não sabe.
//
// A árvore mostra forma: "isto é uma chamada, o método se chama `get`". Ela não
// diz o que `get` É. Sem isso, `map.get(k)` (O(1), inofensivo) e `repo.get(id)`
// (consulta ao banco) são o mesmo nó, e a regra tem de escolher entre calar nos
// dois ou gritar nos dois. Foi exatamente o que produziu 60 falsos positivos na
// regra de laço, "resolvidos" com uma lista de nomes mantida na mão.
//
// O compilador do TypeScript resolve isso de verdade: ele diz o TIPO do
// receptor, o tipo de retorno e — o sinal mais útil — em que arquivo o método
// foi DECLARADO. Método declarado num `lib.*.d.ts` é biblioteca padrão da
// linguagem. Esse único fato dispensa qualquer lista de nomes, para qualquer
// coleção, sem manutenção.
//
// Custo: montar o Program é caro (segundos), então é opt-in e roda uma vez para
// o conjunto todo, não por arquivo. Continua DETERMINÍSTICO: é o mesmo checker
// que o `tsc` usa para compilar, sem modelo e sem heurística.
// ---------------------------------------------------------------------------

/** Onde o símbolo chamado foi declarado — o eixo que separa coleção de I/O. */
export type CallOrigin =
  /** `lib.*.d.ts`: Map, Set, Array, Promise, String… a linguagem em si. */
  | "stdlib"
  /** Dentro de node_modules: biblioteca de terceiro. */
  | "dependency"
  /** Código do próprio repositório. */
  | "user"
  /** Sem declaração resolvível (JS sem tipos, `any`, import quebrado). */
  | "unknown";

export interface CallFact {
  /** 1-based, alinhado com `StructuralMatch.startLine`. */
  line: number;
  /** 1-based, alinhado com `StructuralMatch.startColumn`. */
  column: number;
  /** Tipo do receptor: `Map<string, number>`, `Repo`, `number[]`… */
  receiverType: string | null;
  origin: CallOrigin;
  returnType: string | null;
  /** Retorna Promise/Thenable — sinal forte de operação de I/O. */
  awaitable: boolean;
}

export interface SemanticIndex {
  /** Fato da chamada que começa exatamente nesta posição, se houver. */
  at(file: string, line: number, column: number): CallFact | null;
  /** Arquivo entrou no Program? Se não, a ausência de fato não significa nada. */
  covers(file: string): boolean;
  readonly stats: { files: number; calls: number; ms: number };
}

/** Índice vazio: tudo `unknown`, nada coberto. Deixa as regras degradarem sem `if`. */
export const EMPTY_SEMANTIC_INDEX: SemanticIndex = {
  at: () => null,
  covers: () => false,
  stats: { files: 0, calls: 0, ms: 0 },
};

/** `lib.es2015.collection.d.ts`, `lib.dom.d.ts`… a biblioteca padrão. */
function ehStdlib(fileName: string): boolean {
  return /(^|[/\\])lib\.[a-z0-9._]*d\.ts$/i.test(fileName);
}

function origemDe(fileName: string | undefined): CallOrigin {
  if (!fileName) return "unknown";
  if (ehStdlib(fileName)) return "stdlib";
  if (/[/\\]node_modules[/\\]/.test(fileName)) return "dependency";
  return "user";
}

export interface SemanticOptions {
  /** Raiz para normalizar os caminhos como o scanner os reporta. */
  cwd: string;
  /** Teto de arquivos: acima disso o Program custa mais do que entrega. */
  maxFiles?: number;
}

const MAX_FILES_PADRAO = 3000;

/**
 * Monta o índice para os arquivos TS/JS informados.
 *
 * Devolve `EMPTY_SEMANTIC_INDEX` — nunca lança — quando o `typescript` não está
 * instalado ou o conjunto é grande demais. Análise semântica indisponível tem
 * de degradar para "sem informação", jamais derrubar o scan.
 */
export async function buildSemanticIndex(
  files: string[],
  opts: SemanticOptions,
): Promise<SemanticIndex> {
  const alvos = files.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(f));
  if (alvos.length === 0 || alvos.length > (opts.maxFiles ?? MAX_FILES_PADRAO)) {
    return EMPTY_SEMANTIC_INDEX;
  }

  let ts: typeof import("typescript");
  try {
    ts = await import("typescript");
  } catch {
    return EMPTY_SEMANTIC_INDEX; // sem o compilador, seguimos só com a árvore
  }

  const inicio = Date.now();
  let program: import("typescript").Program;
  try {
    program = ts.createProgram(alvos, {
      allowJs: true,
      checkJs: false,
      // Sem emitir nada: só queremos o checker.
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    });
  } catch {
    return EMPTY_SEMANTIC_INDEX;
  }

  const checker = program.getTypeChecker();
  // file -> "linha:coluna" -> fato
  const porArquivo = new Map<string, Map<string, CallFact>>();
  let calls = 0;

  const normalizar = (p: string) =>
    p.replace(/\\/g, "/").replace(opts.cwd.replace(/\\/g, "/").replace(/\/$/, "") + "/", "");

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = normalizar(sf.fileName);
    const mapa = new Map<string, CallFact>();

    const visitar = (n: import("typescript").Node): void => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const fato = fatoDe(ts, checker, sf, n);
        if (fato) {
          mapa.set(`${fato.line}:${fato.column}`, fato);
          calls++;
        }
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);

    if (mapa.size > 0) porArquivo.set(rel, mapa);
  }

  const cobertos = new Set(
    program
      .getSourceFiles()
      .filter((sf) => !sf.isDeclarationFile)
      .map((sf) => normalizar(sf.fileName)),
  );

  return {
    at: (file, line, column) =>
      porArquivo.get(file.replace(/\\/g, "/"))?.get(`${line}:${column}`) ?? null,
    covers: (file) => cobertos.has(file.replace(/\\/g, "/")),
    stats: { files: cobertos.size, calls, ms: Date.now() - inicio },
  };
}

function fatoDe(
  ts: typeof import("typescript"),
  checker: import("typescript").TypeChecker,
  sf: import("typescript").SourceFile,
  n: import("typescript").CallExpression | import("typescript").NewExpression,
): CallFact | null {
  let pos;
  try {
    // `getStart()` pula trivia (comentário/espaço), que é o que o tree-sitter
    // também faz — sem isso as posições não casariam.
    pos = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  } catch {
    return null;
  }

  const alvo = ts.isCallExpression(n) ? n.expression : n.expression;
  const receptor = ts.isPropertyAccessExpression(alvo) ? alvo.expression : null;

  let receiverType: string | null = null;
  if (receptor) {
    try {
      receiverType = checker.typeToString(checker.getTypeAtLocation(receptor));
    } catch {
      receiverType = null;
    }
  }

  let origin: CallOrigin = "unknown";
  try {
    const sym = checker.getSymbolAtLocation(alvo);
    // Um alias (import) precisa ser resolvido até a declaração real, senão a
    // origem seria sempre o arquivo que importou.
    const real =
      sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const decl = real?.declarations?.[0];
    origin = origemDe(decl?.getSourceFile().fileName);
  } catch {
    origin = "unknown";
  }

  let returnType: string | null = null;
  let awaitable = false;
  try {
    const sig = checker.getResolvedSignature(n);
    if (sig) {
      const rt = checker.getReturnTypeOfSignature(sig);
      returnType = checker.typeToString(rt);
      awaitable = /^(Promise|PromiseLike|Thenable)\b/.test(returnType);
    }
  } catch {
    /* assinatura não resolvida: fica sem tipo de retorno */
  }

  return {
    line: pos.line + 1,
    column: pos.character + 1,
    receiverType,
    origin,
    returnType,
    awaitable,
  };
}
