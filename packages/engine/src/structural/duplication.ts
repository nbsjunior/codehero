import { createHash } from "node:crypto";
import type { ParsedFile, SyntaxNode } from "./parser.ts";

// ---------------------------------------------------------------------------
// Duplicação por hash de subárvore.
//
// Hasheamos a FORMA (só os tipos de nó, sem identificadores nem literais), o
// que pega o clone com variável renomeada — o tipo mais comum na prática, e o
// que um diff textual não acha.
//
// O hash sai bottom-up numa única passada pós-ordem: o hash de um nó deriva
// dos hashes já prontos dos filhos. Serializar cada subárvore separadamente
// seria O(n²) no tamanho do arquivo.
// ---------------------------------------------------------------------------

/** Abaixo disto é ruído: `if (x) return;` repetido não é duplicação. */
const MIN_LINHAS = 6;

/**
 * Um bloco pode ter 6 linhas e ainda ser trivial (uma chamada espalhada).
 * O peso estrutural separa os dois casos.
 */
const MIN_NOS = 25;

/** Só nós que representam trecho executável entram como candidatos. */
const CANDIDATOS = new Set([
  "statement_block",
  "block",
  "function_declaration",
  "function_definition",
  "method_definition",
  "method_declaration",
  "class_declaration",
  "class_definition",
  "if_statement",
  "for_statement",
  "while_statement",
  "switch_statement",
  "try_statement",
  "expression_switch_statement",
  "arrow_function",
  "function_expression",
  "func_literal",
  "local_function_statement",
  "constructor_declaration",
]);

export interface DuplicateBlock {
  file: string;
  startLine: number;
  endLine: number;
  lines: number;
}

export interface DuplicateCandidate extends DuplicateBlock {
  /** Hash da forma — mesmo valor significa estrutura idêntica. */
  hash: string;
  nodes: number;
}

export interface DuplicateGroup {
  hash: string;
  blocks: DuplicateBlock[];
  /** Linhas de UMA ocorrência; as demais são a repetição. */
  lines: number;
}

/**
 * Hash de forma de todas as subárvores candidatas de um arquivo.
 *
 * Pós-ordem iterativa: um nó só é hasheado depois dos filhos. Iterativo porque
 * arquivo grande estoura recursão — e porque a identidade de objeto do
 * web-tree-sitter não é estável, então nada pode ser indexado por nó.
 */
export function candidatesFor(file: string, parsed: ParsedFile): DuplicateCandidate[] {
  // Árvore com erro produz forma incompleta; um "clone" daí seria artefato.
  if (parsed.hasError) return [];

  const posix = file.split("\\").join("/");
  const out: DuplicateCandidate[] = [];

  interface Frame {
    n: SyntaxNode;
    i: number;
    childHashes: string[];
    childNodes: number;
  }

  const stack: Frame[] = [{ n: parsed.root, i: 0, childHashes: [], childNodes: 0 }];
  let devolvido: { hash: string; nodes: number } | null = null;

  while (stack.length) {
    const frame = stack[stack.length - 1]!;

    if (devolvido) {
      frame.childHashes.push(devolvido.hash);
      frame.childNodes += devolvido.nodes;
      devolvido = null;
    }

    if (frame.i < frame.n.childCount) {
      const c = frame.n.child(frame.i);
      frame.i++;
      if (c) stack.push({ n: c, i: 0, childHashes: [], childNodes: 0 });
      continue;
    }

    const h = createHash("sha1");
    h.update(frame.n.type);
    for (const ch of frame.childHashes) h.update(ch);
    const hash = h.digest("hex").slice(0, 16);
    const nodes = frame.childNodes + 1;

    const startLine = frame.n.startPosition.row + 1;
    const endLine = frame.n.endPosition.row + 1;
    const lines = endLine - startLine + 1;

    if (CANDIDATOS.has(frame.n.type) && lines >= MIN_LINHAS && nodes >= MIN_NOS) {
      out.push({ hash, file: posix, startLine, endLine, lines, nodes });
    }

    stack.pop();
    devolvido = { hash, nodes };
  }

  return out;
}

function contido(dentro: DuplicateBlock, fora: DuplicateBlock): boolean {
  return (
    dentro.file === fora.file &&
    dentro.startLine >= fora.startLine &&
    dentro.endLine <= fora.endLine &&
    !(dentro.startLine === fora.startLine && dentro.endLine === fora.endLine)
  );
}

/**
 * Agrupa por hash e descarta o aninhado: se um método inteiro está duplicado,
 * reportar também cada `if` dentro dele infla a contagem sem dizer nada novo.
 *
 * A contenção é avaliada DEPOIS do agrupamento, sobre o conjunto de grupos
 * duplicados — que é ordens de magnitude menor que o de candidatos. Avaliar
 * durante o hashing custaria O(n × candidatos).
 */
export function findDuplicates(candidatos: DuplicateCandidate[]): DuplicateGroup[] {
  // Vários nós descrevem o MESMO bloco físico: uma `function_declaration` e o
  // `statement_block` do corpo dela costumam ter intervalo de linhas idêntico
  // (a `{` fica na linha da assinatura). Hashes diferentes, mesmo trecho — sem
  // colapsar aqui, o mesmo bloco aparece duas vezes no relatório. A contenção
  // por si não resolve, porque ela ignora intervalos iguais de propósito.
  const porSpan = new Map<string, DuplicateCandidate>();
  for (const c of candidatos) {
    const chave = `${c.file}:${c.startLine}-${c.endLine}`;
    const anterior = porSpan.get(chave);
    // Fica o mais externo (mais nós): é ele que representa o bloco inteiro.
    if (!anterior || c.nodes > anterior.nodes) porSpan.set(chave, c);
  }

  const porHash = new Map<string, DuplicateCandidate[]>();
  for (const c of porSpan.values()) {
    const lista = porHash.get(c.hash);
    if (lista) lista.push(c);
    else porHash.set(c.hash, [c]);
  }

  const grupos: DuplicateGroup[] = [];
  for (const [hash, lista] of porHash) {
    if (lista.length < 2) continue;
    grupos.push({
      hash,
      lines: lista[0]!.lines,
      blocks: lista
        .map((c) => ({ file: c.file, startLine: c.startLine, endLine: c.endLine, lines: c.lines }))
        .sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine),
    });
  }

  // Maior primeiro, para que o teste de contenção sempre compare contra um
  // bloco pelo menos tão grande.
  grupos.sort((a, b) => b.lines - a.lines);

  const mantidos: DuplicateGroup[] = [];
  for (const g of grupos) {
    const cobertoPorMaior = g.blocks.every((b) =>
      mantidos.some((m) => m.blocks.some((mb) => contido(b, mb))),
    );
    if (!cobertoPorMaior) mantidos.push(g);
  }

  return mantidos.sort((a, b) => b.lines * b.blocks.length - a.lines * a.blocks.length);
}

export interface DuplicationSummary {
  groups: DuplicateGroup[];
  /** Linhas dentro de algum bloco duplicado, sem contar em dobro. */
  duplicatedLines: number;
  totalLines: number;
  percent: number;
}

export function summarizeDuplication(
  groups: DuplicateGroup[],
  totalLines: number,
): DuplicationSummary {
  // Uma linha coberta por dois grupos não pode contar duas vezes: a contagem é
  // por conjunto de linhas por arquivo.
  const porArquivo = new Map<string, Set<number>>();
  for (const g of groups) {
    for (const b of g.blocks) {
      let set = porArquivo.get(b.file);
      if (!set) {
        set = new Set<number>();
        porArquivo.set(b.file, set);
      }
      for (let l = b.startLine; l <= b.endLine; l++) set.add(l);
    }
  }

  let duplicatedLines = 0;
  for (const set of porArquivo.values()) duplicatedLines += set.size;

  return {
    groups,
    duplicatedLines,
    totalLines,
    percent: totalLines > 0 ? Math.round((duplicatedLines / totalLines) * 1000) / 10 : 0,
  };
}
