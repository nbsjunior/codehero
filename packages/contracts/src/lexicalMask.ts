// ---------------------------------------------------------------------------
// Máscara léxica — o que é código, o que é comentário, o que é string.
//
// O motor L0 casa regex em linha crua. Medido no próprio repo: de 542
// apontamentos, 304 (56%) caíam dentro de literal de string e 49 (9%) dentro
// de comentário. Só 35% estavam em código executável. Uma regra que dispara
// no comentário que a DESCREVE não é uma regra ruim — é um motor sem noção de
// contexto léxico.
//
// POR QUE VARREDURA E NÃO PARSE: o L0 roda em todo arquivo e custa
// microssegundos por regra. Parsear com tree-sitter custa ~13ms por arquivo e
// só cobre as linguagens com gramática. Esta varredura é O(n) numa passada,
// não constrói árvore, e cobre também VB.NET e DB2 — que não têm gramática.
//
// A máscara PRESERVA posição: cada caractere apagado vira espaço, e as quebras
// de linha ficam. Assim linha e coluna do achado continuam iguais.
// ---------------------------------------------------------------------------

/** Onde a regra tem permissão de casar. */
export type PatternScope =
  /** Só código executável. Padrão — é o que a esmagadora maioria quer. */
  | "code"
  /** Só comentários. Regras de TODO/FIXME dependem disso. */
  | "comments"
  /** Só o conteúdo de literais de string. `hardcoded-secret` depende disso. */
  | "strings"
  /** Linha crua, sem máscara. Escape para regra que precisa dos três. */
  | "any";

export interface LexicalMask {
  /** Comentário e conteúdo de string apagados. */
  code: string;
  /** Só comentários. */
  comments: string;
  /** Só conteúdo de strings. */
  strings: string;
}

interface Perfil {
  linha: string[];
  blocoIni: string | null;
  blocoFim: string | null;
  aspas: string[];
  /** Aspas triplas do Python. */
  triplas: string[];
  /** `\` escapa dentro de string (C-like) ou não (SQL usa `''`). */
  escapaBarra: boolean;
  /** Aspas repetidas escapam a si mesmas: `''` em SQL, `""` em VB. */
  escapaDobrando: boolean;
  /** COBOL de formato fixo: `*` ou `/` na coluna 7 comenta a linha inteira. */
  cobolFixo: boolean;
}

const CLIKE: Perfil = {
  linha: ["//"],
  blocoIni: "/*",
  blocoFim: "*/",
  aspas: ['"', "'", "`"],
  triplas: [],
  escapaBarra: true,
  escapaDobrando: false,
  cobolFixo: false,
};

const PERFIS: Record<string, Perfil> = {
  clike: CLIKE,
  python: {
    linha: ["#"],
    blocoIni: null,
    blocoFim: null,
    aspas: ['"', "'"],
    triplas: ['"""', "'''"],
    escapaBarra: true,
    escapaDobrando: false,
    cobolFixo: false,
  },
  sql: {
    linha: ["--"],
    blocoIni: "/*",
    blocoFim: "*/",
    aspas: ["'"],
    triplas: [],
    escapaBarra: false,
    escapaDobrando: true,
    cobolFixo: false,
  },
  cobol: {
    linha: ["*>"],
    blocoIni: null,
    blocoFim: null,
    aspas: ['"', "'"],
    triplas: [],
    escapaBarra: false,
    escapaDobrando: true,
    cobolFixo: true,
  },
  vbnet: {
    linha: ["'"],
    blocoIni: null,
    blocoFim: null,
    aspas: ['"'],
    triplas: [],
    escapaBarra: false,
    escapaDobrando: true,
    cobolFixo: false,
  },
};

const EXT_PERFIL: Record<string, string> = {
  js: "clike", jsx: "clike", mjs: "clike", cjs: "clike",
  ts: "clike", tsx: "clike", mts: "clike", cts: "clike",
  java: "clike", cs: "clike", go: "clike", c: "clike", h: "clike",
  cpp: "clike", cc: "clike", hpp: "clike", kt: "clike", swift: "clike",
  py: "python", pyi: "python",
  sql: "sql",
  cbl: "cobol", cob: "cobol", cpy: "cobol",
  vb: "vbnet",
};

/** Perfil léxico pelo caminho do arquivo. Desconhecido cai em C-like. */
export function lexicalProfileFor(file: string): string {
  const dot = file.lastIndexOf(".");
  if (dot < 0) return "clike";
  return EXT_PERFIL[file.slice(dot + 1).toLowerCase()] ?? "clike";
}

const CODIGO = 0;
const COMENTARIO = 1;
const STRING = 2;
/**
 * Aspas de abertura e fechamento. Aparecem em `code` E em `strings`.
 *
 * Existe por um caso concreto e contra-intuitivo: apagar as aspas junto com o
 * conteúdo faz a máscara CRIAR achados, não só remover. A regra que procura
 * `import X;` (import sem `from`) passou a casar em toda linha
 * `import { x } from "mod";`, porque sem as aspas a linha vira
 * `import { x } from        ;`. Foram 490 achados falsos gerados pela própria
 * máscara. A aspa é sintaxe da linguagem; só o conteúdo dela é dado.
 */
const DELIM = 3;

/**
 * Classifica cada caractere e devolve as três variantes.
 *
 * A classificação é de CARACTERE, não de linha: `foo(); // nota` tem código e
 * comentário na mesma linha, e a regra de código não pode ver a nota.
 */
export function buildLexicalMask(source: string, profile = "clike"): LexicalMask {
  const p = PERFIS[profile] ?? CLIKE;
  const n = source.length;
  const classe = new Uint8Array(n); // começa tudo CODIGO

  let i = 0;
  let colunaLinha = 0; // coluna 0-based dentro da linha corrente

  while (i < n) {
    const c = source[i]!;

    if (c === "\n") {
      classe[i] = CODIGO;
      i++;
      colunaLinha = 0;
      continue;
    }

    // COBOL de formato fixo: indicador na coluna 7 (índice 6).
    if (p.cobolFixo && colunaLinha === 6 && (c === "*" || c === "/")) {
      while (i < n && source[i] !== "\n") {
        classe[i] = COMENTARIO;
        i++;
        colunaLinha++;
      }
      continue;
    }

    // Comentário de linha.
    let achouLinha = false;
    for (const tok of p.linha) {
      if (source.startsWith(tok, i)) {
        while (i < n && source[i] !== "\n") {
          classe[i] = COMENTARIO;
          i++;
          colunaLinha++;
        }
        achouLinha = true;
        break;
      }
    }
    if (achouLinha) continue;

    // Comentário de bloco.
    if (p.blocoIni && p.blocoFim && source.startsWith(p.blocoIni, i)) {
      const fim = source.indexOf(p.blocoFim, i + p.blocoIni.length);
      const ate = fim < 0 ? n : fim + p.blocoFim.length;
      for (let k = i; k < ate; k++) classe[k] = source[k] === "\n" ? CODIGO : COMENTARIO;
      i = ate;
      colunaLinha = 0; // aproximação: bloco costuma cruzar linha
      continue;
    }

    // String de aspas triplas (Python) — testar ANTES da aspa simples.
    let achouTripla = false;
    for (const t of p.triplas) {
      if (source.startsWith(t, i)) {
        const fim = source.indexOf(t, i + t.length);
        const ate = fim < 0 ? n : fim + t.length;
        for (let k = i; k < ate; k++) classe[k] = source[k] === "\n" ? CODIGO : STRING;
        // Delimitadores das triplas ficam visíveis ao código.
        for (let k = i; k < i + t.length && k < n; k++) classe[k] = DELIM;
        if (fim >= 0) for (let k = fim; k < fim + t.length; k++) classe[k] = DELIM;
        i = ate;
        colunaLinha = 0;
        achouTripla = true;
        break;
      }
    }
    if (achouTripla) continue;

    // String comum.
    if (p.aspas.includes(c)) {
      const abre = c;
      classe[i] = DELIM;
      i++;
      colunaLinha++;
      while (i < n) {
        const d = source[i]!;
        // Quebra de linha encerra string não-multilinha (exceto template JS).
        if (d === "\n" && abre !== "`") break;
        if (p.escapaBarra && d === "\\" && i + 1 < n) {
          classe[i] = STRING;
          if (source[i + 1] !== "\n") classe[i + 1] = STRING;
          i += 2;
          colunaLinha += 2;
          continue;
        }
        if (d === abre) {
          if (p.escapaDobrando && source[i + 1] === abre) {
            classe[i] = STRING;
            classe[i + 1] = STRING;
            i += 2;
            colunaLinha += 2;
            continue;
          }
          classe[i] = DELIM;
          i++;
          colunaLinha++;
          break;
        }
        classe[i] = d === "\n" ? CODIGO : STRING;
        i++;
        if (d === "\n") colunaLinha = 0;
        else colunaLinha++;
      }
      continue;
    }

    classe[i] = CODIGO;
    i++;
    colunaLinha++;
  }

  return {
    // A aspa entra nas DUAS: em `code` porque é sintaxe, em `strings` porque
    // regra de literal costuma ancorar nela.
    code: variante(source, classe, [CODIGO, DELIM]),
    comments: variante(source, classe, [COMENTARIO]),
    strings: variante(source, classe, [STRING, DELIM]),
  };
}

/** Mantém só os caracteres das classes pedidas; o resto vira espaço. Quebras ficam. */
function variante(source: string, classe: Uint8Array, alvos: number[]): string {
  const out = new Array<string>(source.length);
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\n" || c === "\r") out[i] = c;
    else out[i] = alvos.includes(classe[i]!) ? c : " ";
  }
  return out.join("");
}

/** Texto sobre o qual a regra deve casar, dado seu escopo. */
export function sourceForScope(
  scope: PatternScope | undefined,
  raw: string,
  mask: LexicalMask,
): string {
  switch (scope ?? "code") {
    case "any":
      return raw;
    case "comments":
      return mask.comments;
    case "strings":
      return mask.strings;
    case "code":
    default:
      return mask.code;
  }
}
