import type { BuiltNode } from "./builtNode.ts";
import { camposDeclarados, tamanhoDoPic } from "./cobolData.ts";

// ---------------------------------------------------------------------------
// A costura COBOL ↔ DB2.
//
// Estas quatro análises existem porque o mercado trata COBOL e SQL como mundos
// separados: um analisador olha o programa, outro olha a query, e ninguém olha
// a junta. É exatamente na junta que moram os defeitos que derrubam batch em
// produção.
//
// Todas precisam da DATA DIVISION na árvore e da ordem dos comandos — nenhuma
// é expressável como padrão de linha.
// ---------------------------------------------------------------------------

export interface AchadoDb2 {
  tipo: "truncamento" | "cursor-sem-close" | "sql-em-laco" | "commit-em-cursor";
  linha: number;
  detalhe: string;
  trecho: string;
  paragrafo: string | null;
}

function textoSql(n: BuiltNode): string {
  return n.text.replace(/^\s*EXEC\s+SQL/i, "").replace(/END-EXEC\.?/i, "").trim();
}

function paragrafoDe(n: BuiltNode): string | null {
  let p = n.parent;
  while (p) {
    if (p.type === "paragraph") return p.childForFieldName("name")?.text ?? null;
    p = p.parent;
  }
  return null;
}

function coleta(root: BuiltNode, tipo: string): BuiltNode[] {
  const out: BuiltNode[] = [];
  const st: BuiltNode[] = [root];
  while (st.length) {
    const n = st.pop()!;
    if (n.type === tipo) out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) st.push(c);
    }
  }
  return out;
}

/** Todo ancestral de um nó, para saber em que contexto ele está. */
function ancestrais(n: BuiltNode): BuiltNode[] {
  const out: BuiltNode[] = [];
  let p = n.parent;
  while (p) {
    out.push(p);
    p = p.parent;
  }
  return out;
}

/**
 * Capacidade declarada de uma coluna DB2, pelo tipo.
 *
 * Só os tipos numéricos com faixa fixa — é onde o truncamento é silencioso e
 * determinístico. `DECIMAL(p,s)` é lido do próprio texto.
 */
const CAPACIDADE: Record<string, number> = {
  SMALLINT: 5,
  INTEGER: 10,
  INT: 10,
  BIGINT: 19,
};

/**
 * 1. TRUNCAMENTO: host variable menor que a coluna.
 *
 * `SELECT valor INTO :WS-X` onde a coluna é `INTEGER` (10 dígitos) e
 * `WS-X PIC S9(4)` (4 dígitos) trunca em silêncio — o DB2 devolve -304 ou, pior,
 * dependendo do compilador, o valor chega cortado sem erro.
 *
 * Exige a DATA DIVISION (para o PIC) e o texto do SQL (para o tipo). Nenhum
 * analisador de SQL sozinho vê o PIC; nenhum de COBOL sozinho vê a coluna.
 */
function truncamento(root: BuiltNode, execs: BuiltNode[]): AchadoDb2[] {
  const div = root.childForFieldName?.("data") ?? null;
  const campos = new Map(camposDeclarados(div).map((c) => [c.nome, c]));
  if (campos.size === 0) return [];

  // Declarações de tipo vistas no próprio fonte: `DECLARE ... (COL INTEGER)`
  // ou comentário de catálogo. Sem catálogo externo, é o que dá para saber.
  const tipoDaColuna = new Map<string, number>();
  for (const e of execs) {
    const sql = textoSql(e);
    for (const m of sql.matchAll(/([A-Z][A-Z0-9_]*)\s+(SMALLINT|INTEGER|INT|BIGINT)\b/gi)) {
      tipoDaColuna.set(m[1]!.toUpperCase(), CAPACIDADE[m[2]!.toUpperCase()] ?? 0);
    }
    for (const m of sql.matchAll(/([A-Z][A-Z0-9_]*)\s+DECIMAL\s*\(\s*(\d+)/gi)) {
      tipoDaColuna.set(m[1]!.toUpperCase(), parseInt(m[2]!, 10));
    }
  }
  if (tipoDaColuna.size === 0) return [];

  const out: AchadoDb2[] = [];
  for (const e of execs) {
    const sql = textoSql(e);
    // `SELECT col1, col2 INTO :A, :B FROM ...` — pares por posição.
    const m = /SELECT\s+([\s\S]+?)\s+INTO\s+([\s\S]+?)\s+FROM/i.exec(sql);
    if (!m) continue;
    const colunas = m[1]!.split(",").map((s) => s.trim().replace(/^.*\./, "").toUpperCase());
    const hosts = m[2]!.split(",").map((s) => s.trim().replace(/^:/, "").toUpperCase());

    for (let i = 0; i < Math.min(colunas.length, hosts.length); i++) {
      const cap = tipoDaColuna.get(colunas[i]!);
      const campo = campos.get(hosts[i]!);
      if (cap === undefined || !campo?.picture) continue;
      const t = tamanhoDoPic(campo.picture);
      if (!t || t.alfanumerico) continue;
      if (t.digitos >= cap) continue;
      out.push({
        tipo: "truncamento",
        linha: e.startPosition.row,
        detalhe: `${hosts[i]} PIC ${campo.picture} (${t.digitos} dígitos) recebe ${colunas[i]} com capacidade ${cap}`,
        trecho: sql.split("\n")[0]!.trim().slice(0, 100),
        paragrafo: paragrafoDe(e),
      });
    }
  }
  return out;
}

/**
 * 2. CURSOR SEM CLOSE.
 *
 * Cursor aberto e não fechado segura bloqueio e consome recurso do plano até o
 * fim da unidade de trabalho. Em batch longo, é vazamento.
 */
function cursorSemClose(execs: BuiltNode[]): AchadoDb2[] {
  const abertos = new Map<string, BuiltNode>();
  const fechados = new Set<string>();
  for (const e of execs) {
    const sql = textoSql(e);
    const open = /^\s*OPEN\s+([A-Z][A-Z0-9_-]*)/i.exec(sql);
    if (open) abertos.set(open[1]!.toUpperCase(), e);
    const close = /^\s*CLOSE\s+([A-Z][A-Z0-9_-]*)/i.exec(sql);
    if (close) fechados.add(close[1]!.toUpperCase());
  }
  const out: AchadoDb2[] = [];
  for (const [nome, e] of abertos) {
    if (fechados.has(nome)) continue;
    out.push({
      tipo: "cursor-sem-close",
      linha: e.startPosition.row,
      detalhe: `cursor ${nome} aberto e nunca fechado`,
      trecho: textoSql(e).split("\n")[0]!.trim().slice(0, 100),
      paragrafo: paragrafoDe(e),
    });
  }
  return out;
}

/**
 * 3. EXEC SQL DENTRO DE LAÇO.
 *
 * Uma ida e volta ao DB2 por iteração. No mainframe, CPU é faturada: o padrão
 * N+1 aqui tem preço direto na fatura, não só latência.
 *
 * As exceções não são arbitrárias — cada uma é um verbo cujo lugar natural É o
 * laço:
 *
 *   FETCH   forma correta de consumir cursor;
 *   CLOSE   encerramento do cursor ao sair;
 *   COMMIT  checkpoint/restart periódico é prática padrão de batch, não N+1
 *           (e o risco real do COMMIT em laço — cursor sem WITH HOLD — é
 *           reportado por `commitEmCursor`, com diagnóstico melhor);
 *   ROLLBACK  mesma razão do COMMIT;
 *   WHENEVER/INCLUDE/DECLARE  são declarações, não vão ao banco.
 */
const VERBOS_ESPERADOS_EM_LACO =
  /^\s*(FETCH|CLOSE|COMMIT|ROLLBACK|WHENEVER|INCLUDE|DECLARE)\b/i;

function sqlEmLaco(execs: BuiltNode[]): AchadoDb2[] {
  const out: AchadoDb2[] = [];
  for (const e of execs) {
    const sql = textoSql(e);
    if (VERBOS_ESPERADOS_EM_LACO.test(sql)) continue;
    const emLaco = ancestrais(e).some(
      (a) => a.type === "perform_until_statement" || a.type === "perform_varying_statement",
    );
    if (!emLaco) continue;
    const verbo = /^\s*([A-Z-]+)/i.exec(sql)?.[1]?.toUpperCase() ?? "?";
    out.push({
      tipo: "sql-em-laco",
      linha: e.startPosition.row,
      detalhe: `${verbo} dentro de PERFORM: uma ida ao DB2 por iteração`,
      trecho: sql.split("\n")[0]!.trim().slice(0, 100),
      paragrafo: paragrafoDe(e),
    });
  }
  return out;
}

/**
 * 4. COMMIT DENTRO DE LAÇO DE CURSOR.
 *
 * O COMMIT fecha todos os cursores que não foram declarados `WITH HOLD`. Se o
 * laço depende do cursor para continuar, a próxima iteração falha com -501
 * (cursor não aberto) — e o defeito só aparece quando o volume passa do ponto
 * de commit, o que costuma ser em produção.
 */
function commitEmCursor(execs: BuiltNode[]): AchadoDb2[] {
  const comHold = new Set<string>();
  for (const e of execs) {
    const m = /DECLARE\s+([A-Z][A-Z0-9_-]*)\s+CURSOR\s+WITH\s+HOLD/i.exec(textoSql(e));
    if (m) comHold.add(m[1]!.toUpperCase());
  }
  const cursoresAbertos = new Set<string>();
  for (const e of execs) {
    const m = /^\s*OPEN\s+([A-Z][A-Z0-9_-]*)/i.exec(textoSql(e));
    if (m) cursoresAbertos.add(m[1]!.toUpperCase());
  }
  const semHold = [...cursoresAbertos].filter((c) => !comHold.has(c));
  if (semHold.length === 0) return [];

  const out: AchadoDb2[] = [];
  for (const e of execs) {
    if (!/^\s*COMMIT\b/i.test(textoSql(e))) continue;
    const emLaco = ancestrais(e).some(
      (a) => a.type === "perform_until_statement" || a.type === "perform_varying_statement",
    );
    if (!emLaco) continue;
    out.push({
      tipo: "commit-em-cursor",
      linha: e.startPosition.row,
      detalhe: `COMMIT em laço com cursor sem WITH HOLD (${semHold.join(", ")}): a próxima iteração falha com -501`,
      trecho: textoSql(e).split("\n")[0]!.trim().slice(0, 100),
      paragrafo: paragrafoDe(e),
    });
  }
  return out;
}

export function analisarDb2(root: BuiltNode): AchadoDb2[] {
  const execs = coleta(root, "exec_sql_statement");
  if (execs.length === 0) return [];
  execs.sort((a, b) => a.startPosition.row - b.startPosition.row);
  return [
    ...truncamento(root, execs),
    ...cursorSemClose(execs),
    ...sqlEmLaco(execs),
    ...commitEmCursor(execs),
  ].sort((a, b) => a.linha - b.linha);
}
