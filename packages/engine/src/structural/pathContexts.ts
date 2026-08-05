import type { SyntaxNode, ParsedFile } from "./parser.ts";

// ---------------------------------------------------------------------------
// Path-contexts: a representação de código que o Code2Vec usa.
//
// Um path-context é a tripla (folha_origem, caminho_na_árvore, folha_destino).
// Duas funções que fazem a mesma coisa escritas de formas diferentes produzem
// conjuntos de caminhos parecidos — é isso que permite agrupar por SIMILARIDADE
// FUNCIONAL, e não por texto.
//
// POR QUE ISTO É DIFERENTE DO HASH DE FORMA que já existe (duplication.ts): o
// hash exige a árvore IDÊNTICA, então pega clone tipo-2 (variável renomeada) e
// só. O conjunto de caminhos é aproximado por natureza — duas implementações
// diferentes do mesmo algoritmo compartilham muitos caminhos sem compartilhar
// forma. É o que alcança clone tipo-3/4 e, principalmente, detecção de ANOMALIA:
// função cujo conjunto de caminhos não se parece com nada do acervo.
//
// DETERMINÍSTICO POR CONSTRUÇÃO: nenhum modelo, nenhuma rede. O vetor é
// contagem de caminhos com hashing de dimensão fixa. Mesmo código, mesmo vetor,
// sempre — que é o requisito para isto poder participar de um gate.
// ---------------------------------------------------------------------------

export interface PathContext {
  /** Texto da folha de origem (identificador, literal…), normalizado. */
  origem: string;
  /** Tipos de nó do caminho subindo até o ancestral comum e descendo. */
  caminho: string;
  destino: string;
}

/**
 * Folha "interessante": carrega significado próprio.
 *
 * Pontuação (vírgula, parêntese, ponto) é ruído estrutural — está em toda
 * função e não distingue nada. Incluí-la afogaria o sinal.
 */
function ehFolhaUtil(n: SyntaxNode): boolean {
  if (n.childCount > 0) return false;
  const t = n.text.trim();
  if (!t) return false;
  if (/^[^\p{L}\p{N}_]+$/u.test(t)) return false; // só pontuação
  return true;
}

/**
 * Normaliza o texto da folha.
 *
 * Identificador vira o próprio nome em minúsculas — o NOME importa: `saldo` e
 * `valor` são pistas de domínio. Literal numérico e string viram marcadores,
 * porque `42` e `43` não distinguem nada e explodiriam o vocabulário.
 */
function normalizaFolha(n: SyntaxNode): string {
  const t = n.text.trim();
  if (/^["'`]/.test(t)) return "<STR>";
  if (/^[0-9]/.test(t)) return "<NUM>";
  return t.toLowerCase().slice(0, 40);
}

/** Cadeia de tipos de nó da folha até a raiz do trecho. */
function ancestrais(n: SyntaxNode, ate: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [n];
  let p = n.parent;
  while (p && p !== ate) {
    out.push(p);
    p = p.parent;
  }
  if (p === ate) out.push(ate);
  return out;
}

export interface PathContextOptions {
  /** Teto de folhas por trecho: o custo é quadrático no número de folhas. */
  maxFolhas?: number;
  /** Teto de caminhos emitidos, para não estourar em função gigante. */
  maxCaminhos?: number;
  /** Caminho mais longo que isso é ruído: liga partes sem relação real. */
  maxAltura?: number;
}

const PADRAO: Required<PathContextOptions> = {
  maxFolhas: 120,
  // TETO ALTO DE PROPOSITO. Com 400, 55% das unidades reais saturavam e ficavam
  // com vetores quase identicos — e a deteccao de anomalia passou a medir
  // TAMANHO em vez de atipicidade: as 14 anomalias tinham menos de 100 caminhos
  // enquanto a mediana do acervo era 400 (o teto).
  //
  // Truncar tambem enviesa: os primeiros pares da travessia sao sempre das
  // mesmas regioes da arvore. 120 folhas dao no maximo 7140 pares, o que e
  // barato — o teto existe so como rede de seguranca.
  maxCaminhos: 1200,
  maxAltura: 12,
};

/**
 * Extrai os path-contexts de uma subárvore.
 *
 * O custo é quadrático no número de folhas — daí o teto. Numa função de 30
 * linhas são ~40 folhas e ~800 pares, o que é barato; numa de 3.000 linhas
 * seria inviável, e essa função já teria disparado a regra de complexidade.
 */
export function extractPathContexts(
  raiz: SyntaxNode,
  opts: PathContextOptions = {},
): PathContext[] {
  const o = { ...PADRAO, ...opts };
  const folhas: SyntaxNode[] = [];
  const pilha: SyntaxNode[] = [raiz];
  while (pilha.length && folhas.length < o.maxFolhas) {
    const n = pilha.pop()!;
    if (ehFolhaUtil(n)) {
      folhas.push(n);
      continue;
    }
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c) pilha.push(c);
    }
  }

  const out: PathContext[] = [];
  for (let i = 0; i < folhas.length && out.length < o.maxCaminhos; i++) {
    for (let j = i + 1; j < folhas.length && out.length < o.maxCaminhos; j++) {
      const a = ancestrais(folhas[i]!, raiz);
      const b = ancestrais(folhas[j]!, raiz);

      // Ancestral comum: onde as duas cadeias se encontram. Comparar por TIPO
      // e posição é suficiente aqui — o web-tree-sitter devolve um wrapper novo
      // a cada acesso, então identidade de objeto não é confiável (foi o bug
      // que zerou as métricas de aninhamento antes).
      let ka = a.length - 1;
      let kb = b.length - 1;
      while (
        ka > 0 &&
        kb > 0 &&
        a[ka - 1]!.type === b[kb - 1]!.type &&
        a[ka - 1]!.startPosition.row === b[kb - 1]!.startPosition.row &&
        a[ka - 1]!.startPosition.column === b[kb - 1]!.startPosition.column
      ) {
        ka--;
        kb--;
      }

      const subida = a.slice(0, ka + 1).map((n) => n.type);
      const descida = b.slice(0, kb).reverse().map((n) => n.type);
      if (subida.length + descida.length > o.maxAltura) continue;

      out.push({
        origem: normalizaFolha(folhas[i]!),
        caminho: `${subida.join(">")}^${descida.join("<")}`,
        destino: normalizaFolha(folhas[j]!),
      });
    }
  }
  return out;
}

/** Hash estável de string para índice de dimensão (FNV-1a de 32 bits). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Vetor de dimensão fixa por hashing dos path-contexts.
 *
 * O "truque do hashing" evita manter vocabulário: cada contexto cai numa
 * dimensão pelo hash do seu texto. Colisão existe e é aceitável — o vetor é
 * usado para SIMILARIDADE, não para reconstruir o código.
 *
 * Normalizado em L2 para que função grande e função pequena sejam comparáveis:
 * sem isso, a distância mediria tamanho, não semelhança.
 */
export function vectorize(contexts: PathContext[], dim = 256): Float64Array {
  const v = new Float64Array(dim);
  for (const c of contexts) {
    const chave = `${c.origem}|${c.caminho}|${c.destino}`;
    v[hash32(chave) % dim]! += 1;
  }
  let norma = 0;
  for (let i = 0; i < dim; i++) norma += v[i]! * v[i]!;
  norma = Math.sqrt(norma);
  if (norma > 0) for (let i = 0; i < dim; i++) v[i]! /= norma;
  return v;
}

export interface FunctionVector {
  file: string;
  name: string | null;
  startLine: number;
  endLine: number;
  vector: Float64Array;
  /** Nº de path-contexts que originaram o vetor — 0 = trecho sem estrutura. */
  contexts: number;
}

/**
 * Mínimo de path-contexts para a unidade entrar na análise.
 *
 * Ver a justificativa medida em `vectorizeFile`.
 */
export const MIN_CONTEXTS = 30;

/** Tipos de nó que representam "unidade analisável" em cada linguagem. */
const UNIDADES = new Set([
  "function_declaration", "function_definition", "method_definition",
  "method_declaration", "constructor_declaration", "arrow_function",
  "function_expression", "func_literal", "lambda", "local_function_statement",
  // COBOL e T-SQL
  "paragraph", "procedure_definition",
]);

/**
 * Repondera os vetores por IDF e devolve novos vetores normalizados.
 *
 * SEM ISTO O AGRUPAMENTO NÃO SEPARA NADA. Medido em 318 unidades reais: as
 * distâncias ao centroide ficaram todas entre 0,597 e 1,014 e ZERO anomalias
 * passaram do corte. A causa é que os caminhos mais frequentes — os que
 * aparecem em toda função, tipo `identifier>expression_statement` — dominam o
 * vetor e são exatamente os que não distinguem nada.
 *
 * IDF derruba o peso do que é comum e levanta o do que é raro. É o mesmo
 * princípio de recuperação de texto, e é a diferença entre um espaço onde tudo
 * é equidistante e um onde distância significa alguma coisa.
 *
 * Continua determinístico: o IDF sai do próprio acervo analisado.
 */
export function applyIdf(vetores: Float64Array[]): Float64Array[] {
  if (vetores.length === 0) return vetores;
  const dim = vetores[0]!.length;
  const docFreq = new Float64Array(dim);
  for (const v of vetores) {
    for (let i = 0; i < dim; i++) if (v[i]! > 0) docFreq[i]! += 1;
  }
  const n = vetores.length;
  const idf = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    // +1 no numerador e denominador: dimensão ausente não vira infinito.
    idf[i] = Math.log((n + 1) / (docFreq[i]! + 1)) + 1;
  }
  return vetores.map((v) => {
    const out = new Float64Array(dim);
    let norma = 0;
    for (let i = 0; i < dim; i++) {
      out[i] = v[i]! * idf[i]!;
      norma += out[i]! * out[i]!;
    }
    norma = Math.sqrt(norma);
    if (norma > 0) for (let i = 0; i < dim; i++) out[i]! /= norma;
    return out;
  });
}

/** Vetoriza cada unidade (função/parágrafo) do arquivo. */
export function vectorizeFile(
  parsed: ParsedFile,
  file: string,
  dim = 256,
): FunctionVector[] {
  const out: FunctionVector[] = [];
  const pilha: SyntaxNode[] = [parsed.root];
  while (pilha.length) {
    const n = pilha.pop()!;
    if (UNIDADES.has(n.type)) {
      const ctxs = extractPathContexts(n);
      // CORTE DE TRIVIALIDADE. Lambda de uma linha (`(r) => [r.id, r]`) gera
      // poucos caminhos, e há centenas delas num repositório — elas ACHATAM a
      // distribuição e matam o sinal.
      //
      // Medido no proprio repo: com corte 3, z maximo 1,59 e ZERO anomalias em
      // 401 unidades; com corte 30, z maximo 2,46 e 14 anomalias em 280. O
      // corte nao e estetico, e o que faz o metodo funcionar.
      if (ctxs.length >= MIN_CONTEXTS) {
        out.push({
          file,
          name: n.childForFieldName("name")?.text ?? null,
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          vector: vectorize(ctxs, dim),
          contexts: ctxs.length,
        });
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) pilha.push(c);
    }
  }
  return out;
}
