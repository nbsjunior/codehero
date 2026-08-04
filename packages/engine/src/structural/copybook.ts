// ---------------------------------------------------------------------------
// Expansão de copybook COBOL.
//
// POR QUE ISTO VEM ANTES DE QUALQUER REGRA: `COPY CLIENTE.` traz uma estrutura
// que pode ter centenas de campos, e sem expandir o analisador vê a linha
// `COPY CLIENTE.` e mais nada. Ele não está analisando o programa — está
// analisando um pedaço, e não sabe qual pedaço falta. Qualquer número extraído
// daí (dado morto, campo não usado, tipo de host variable) é ficção.
//
// O MAPA DE LINHAS É O QUE TORNA ISTO CORRETO. Expandir desloca todas as
// linhas seguintes; sem rastrear a origem, todo achado passaria a apontar para
// o lugar errado. Cada linha do fonte expandido guarda de onde veio — o
// programa ou o copybook, com a linha de lá. É isso que permite dizer "campo
// não usado, declarado em CLIENTE.cpy:42".
//
// COPY NÃO RESOLVIDO NÃO É COPY LIMPO. Copybook cujo fonte não foi encontrado
// entra em `missing`, e quem consome decide: reportar cobertura parcial ou
// recusar o arquivo. Tratar ausência como vazio é como o analisador mente sem
// perceber.
// ---------------------------------------------------------------------------

/** De onde veio cada linha do fonte expandido. */
export interface LineOrigin {
  /** Caminho do programa ou do copybook. */
  file: string;
  /** Linha 1-based no arquivo de origem. */
  line: number;
  /** Profundidade de aninhamento (0 = programa, 1 = copybook, 2 = COPY dentro de copybook). */
  depth: number;
}

export interface CopybookResolver {
  /**
   * Fonte do copybook, ou null quando não encontrado.
   * `library` vem de `COPY X OF LIB` / `COPY X IN LIB`.
   */
  resolve(name: string, library?: string): { path: string; source: string } | null;
}

export interface ExpandResult {
  /** Fonte com os COPY substituídos pelo conteúdo. */
  source: string;
  /** Uma entrada por linha de `source`. */
  origins: LineOrigin[];
  /** Copybooks resolvidos, na ordem de aparição. */
  resolved: string[];
  /** `COPY` cujo fonte não foi encontrado — o número que revela cobertura falsa. */
  missing: string[];
  /** Ciclos detectados (`A` inclui `B` que inclui `A`). */
  cycles: string[];
  /** Linhas trazidas de copybook — quanto do programa estava invisível. */
  expandedLines: number;
}

/**
 * `COPY nome [OF|IN biblioteca] [REPLACING ...] .`
 *
 * A instrução pode atravessar linhas — `REPLACING` longo é comum — então a
 * varredura junta linhas até o ponto final.
 */
const COPY_INICIO = /^\s*COPY\s+([A-Z0-9$#@_-]+)\s*(?:\b(?:OF|IN)\s+([A-Z0-9$#@_-]+))?/i;

/** Profundidade máxima: copybook que inclui copybook é normal; 20 níveis não. */
const MAX_DEPTH = 20;

/**
 * Área do COBOL de formato fixo: colunas 1–6 são sequência, 7 é indicador.
 * `COPY` na coluna 8+ é o caso normal; precisamos ignorar a sequência para
 * reconhecê-lo, sem destruir o texto (as regras ainda leem a linha original).
 */
function areaCodigo(line: string): string {
  if (line.length >= 7 && /^[\d\s]{6}/.test(line.slice(0, 6))) {
    const ind = line[6];
    if (ind === "*" || ind === "/") return ""; // linha de comentário
    return line.slice(7);
  }
  return line;
}

/** Pares `==a== BY ==b==` e `a BY b` da cláusula REPLACING. */
function parseReplacing(texto: string): Array<{ de: string; para: string }> {
  const out: Array<{ de: string; para: string }> = [];
  const m = /\bREPLACING\b([\s\S]*)$/i.exec(texto);
  if (!m) return out;
  const corpo = m[1]!;

  // Pseudo-texto: ==...== BY ==...==  (forma canônica)
  const pseudo = /==([\s\S]*?)==\s+BY\s+==([\s\S]*?)==/gi;
  let p: RegExpExecArray | null;
  while ((p = pseudo.exec(corpo)) !== null) {
    out.push({ de: p[1]!.trim(), para: p[2]!.trim() });
  }
  if (out.length > 0) return out;

  // Forma simples: IDENT BY IDENT
  const simples = /([A-Z0-9$#@_-]+)\s+BY\s+([A-Z0-9$#@_-]+|==[\s\S]*?==)/gi;
  let s: RegExpExecArray | null;
  while ((s = simples.exec(corpo)) !== null) {
    out.push({ de: s[1]!.trim(), para: s[2]!.replace(/^==|==$/g, "").trim() });
  }
  return out;
}

function escapaRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aplica REPLACING. Substituição é TEXTUAL, como manda o padrão — o COBOL
 * troca pseudo-texto antes de compilar, não identificadores tipados.
 */
function aplicaReplacing(linha: string, regras: Array<{ de: string; para: string }>): string {
  let out = linha;
  for (const r of regras) {
    if (!r.de) continue;
    out = out.replace(new RegExp(escapaRegex(r.de), "gi"), r.para);
  }
  return out;
}

export interface ExpandOptions {
  /** Caminho do arquivo de origem, usado no mapa de linhas. */
  file: string;
  resolver: CopybookResolver;
  maxDepth?: number;
}

export function expandCopybooks(source: string, opts: ExpandOptions): ExpandResult {
  const resolved: string[] = [];
  const missing: string[] = [];
  const cycles: string[] = [];
  const linhas: string[] = [];
  const origins: LineOrigin[] = [];
  let expandedLines = 0;

  const maxDepth = opts.maxDepth ?? MAX_DEPTH;

  function expandir(
    texto: string,
    arquivo: string,
    depth: number,
    pilha: string[],
    replacing: Array<{ de: string; para: string }>,
  ): void {
    const src = texto.split(/\r?\n/);
    for (let i = 0; i < src.length; i++) {
      const original = src[i]!;
      const codigo = areaCodigo(original);
      const m = COPY_INICIO.exec(codigo);

      if (!m) {
        linhas.push(replacing.length ? aplicaReplacing(original, replacing) : original);
        origins.push({ file: arquivo, line: i + 1, depth });
        continue;
      }

      // A instrucao COPY pode atravessar linhas ate o ponto final.
      let fim = i;
      let instrucao = codigo;
      while (fim < src.length && !/\.\s*$/.test(areaCodigo(src[fim]!).trimEnd())) {
        fim++;
        if (fim < src.length) instrucao += " " + areaCodigo(src[fim]!);
      }

      const nome = m[1]!.toUpperCase();
      const lib = m[2]?.toUpperCase();
      const chave = lib ? `${lib}.${nome}` : nome;

      if (pilha.includes(chave)) {
        cycles.push([...pilha, chave].join(" -> "));
        // Mantem a linha literal: o ciclo e um defeito do fonte, nao nosso.
        linhas.push(original);
        origins.push({ file: arquivo, line: i + 1, depth });
        i = fim;
        continue;
      }
      if (depth >= maxDepth) {
        missing.push(`${chave} (profundidade ${depth})`);
        linhas.push(original);
        origins.push({ file: arquivo, line: i + 1, depth });
        i = fim;
        continue;
      }

      const achado = opts.resolver.resolve(nome, lib);
      if (!achado) {
        missing.push(chave);
        // A linha COPY fica visivel: quem le o relatorio precisa ver que havia
        // um COPY ali que nao foi resolvido.
        linhas.push(original);
        origins.push({ file: arquivo, line: i + 1, depth });
        i = fim;
        continue;
      }

      resolved.push(chave);
      const regras = [...replacing, ...parseReplacing(instrucao)];
      const antes = linhas.length;
      expandir(achado.source, achado.path, depth + 1, [...pilha, chave], regras);
      expandedLines += linhas.length - antes;
      i = fim;
    }
  }

  expandir(source, opts.file, 0, [], []);

  return {
    source: linhas.join("\n"),
    origins,
    resolved,
    missing,
    cycles,
    expandedLines,
  };
}

/**
 * Traduz uma linha do fonte EXPANDIDO para o arquivo e linha de origem.
 *
 * Sem isto o achado apontaria para a linha deslocada — e "campo não usado na
 * linha 380" de um programa de 200 linhas destrói a confiança no relatório.
 */
export function origemDaLinha(res: ExpandResult, linhaExpandida: number): LineOrigin | null {
  return res.origins[linhaExpandida - 1] ?? null;
}
