import type { BuiltNode } from "./builtNode.ts";

// ---------------------------------------------------------------------------
// SQLCODE não verificado após EXEC SQL — o defeito nº 1 de COBOL/DB2.
//
// Quando um `SELECT` não acha linha, o DB2 devolve +100 e NÃO interrompe nada.
// O programa segue com a host variable intacta (lixo da iteração anterior) e
// grava. Quando o banco devolve -911 (deadlock), idem. Não existe exceção em
// COBOL: se ninguém olhar SQLCODE, o erro vira dado errado em produção.
//
// POR QUE NENHUMA FERRAMENTA DE MERCADO PEGA ISSO BEM: exige juntar três
// coisas que normalmente vivem em análises separadas — o SQL embutido, o fluxo
// de controle do COBOL depois do END-EXEC, e o alcance interprocedural do
// `PERFORM` (a checagem quase sempre está num parágrafo comum, tipo
// `PERFORM CHECK-SQL`, e não inline). Analisar o SQL de um lado e o COBOL do
// outro não enxerga a costura.
//
// O QUE NÃO CONTA COMO EXECUÇÃO (e portanto não exige checagem):
//   - INCLUDE SQLCA / INCLUDE copybook: é declaração;
//   - DECLARE ... CURSOR: declara, não executa (o OPEN é que executa);
//   - BEGIN/END DECLARE SECTION: delimita host variables;
//   - WHENEVER: é justamente a instalação do tratamento de erro.
//
// E `WHENEVER SQLERROR GOTO/PERFORM` ativo cobre tudo que vem depois dele —
// ignorar isso transformaria a regra num gerador de falso positivo em todo
// programa que usa o idioma clássico de tratamento global.
// ---------------------------------------------------------------------------

export interface SqlcodeNaoChecado {
  /** Linha 0-based do EXEC SQL. */
  linha: number;
  /** Primeira linha do comando, para o relatório. */
  trecho: string;
  /** Verbo SQL identificado (SELECT, OPEN, FETCH…). */
  verbo: string;
  paragrafo: string | null;
}

/** Comandos que não executam SQL e portanto não produzem SQLCODE relevante. */
const NAO_EXECUTA = /^\s*(INCLUDE|DECLARE|BEGIN\s+DECLARE|END\s+DECLARE|WHENEVER)\b/i;

/** Referência a SQLCODE / SQLSTATE, em qualquer das grafias usuais. */
const CHECA_SQL = /\bSQL(CODE|STATE)\b|\bSQLCA\s*\.\s*SQL(CODE|STATE)\b/i;

function textoSql(n: BuiltNode): string {
  return n.text.replace(/^\s*EXEC\s+SQL/i, "").replace(/END-EXEC\.?/i, "").trim();
}

function verboDe(sql: string): string {
  const m = /^\s*([A-Z-]+)/i.exec(sql);
  return (m?.[1] ?? "?").toUpperCase();
}

/**
 * Parágrafos que verificam SQLCODE, direta ou indiretamente.
 *
 * O ponto interprocedural: `PERFORM CHECK-SQL` conta como checagem se — e
 * somente se — `CHECK-SQL` realmente olha SQLCODE. Confiar no NOME do
 * parágrafo seria adivinhação; seguir o PERFORM é verificação.
 */
function paragrafosQueChecam(root: BuiltNode): Set<string> {
  const paras = new Map<string, BuiltNode>();
  const st: BuiltNode[] = [root];
  while (st.length) {
    const n = st.pop()!;
    if (n.type === "paragraph") {
      const nome = n.childForFieldName("name")?.text;
      if (nome) paras.set(nome.toUpperCase(), n);
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c); }
  }

  const checaDireto = new Set<string>();
  const performa = new Map<string, Set<string>>();
  for (const [nome, node] of paras) {
    const corpo = node.childForFieldName("body")?.text ?? node.text;
    if (CHECA_SQL.test(corpo)) checaDireto.add(nome);
    const alvos = new Set<string>();
    for (const m of corpo.matchAll(/\bPERFORM\s+([A-Z0-9-]+)/gi)) {
      alvos.add(m[1]!.toUpperCase());
    }
    performa.set(nome, alvos);
  }

  // Fecho transitivo: A performa B, B checa -> A checa. Limite de profundidade
  // porque COBOL real tem PERFORM recursivo por acidente.
  let mudou = true;
  let voltas = 0;
  while (mudou && voltas < 20) {
    mudou = false;
    voltas++;
    for (const [nome, alvos] of performa) {
      if (checaDireto.has(nome)) continue;
      for (const a of alvos) {
        if (checaDireto.has(a)) {
          checaDireto.add(nome);
          mudou = true;
          break;
        }
      }
    }
  }
  return checaDireto;
}

/** Irmãos que vêm DEPOIS deste nó, na ordem do fonte. */
function irmaosApos(n: BuiltNode): BuiltNode[] {
  const pai = n.parent;
  if (!pai) return [];
  const out: BuiltNode[] = [];
  let achou = false;
  for (let i = 0; i < pai.childCount; i++) {
    const c = pai.child(i);
    if (!c) continue;
    if (c === n) {
      achou = true;
      continue;
    }
    if (achou) out.push(c);
  }
  return out;
}

function paragrafoDe(n: BuiltNode): string | null {
  let p = n.parent;
  while (p) {
    if (p.type === "paragraph") return p.childForFieldName("name")?.text ?? null;
    p = p.parent;
  }
  return null;
}

export function sqlcodeNaoChecado(root: BuiltNode): SqlcodeNaoChecado[] {
  const execs: BuiltNode[] = [];
  const st: BuiltNode[] = [root];
  while (st.length) {
    const n = st.pop()!;
    if (n.type === "exec_sql_statement") execs.push(n);
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c); }
  }
  if (execs.length === 0) return [];

  execs.sort((a, b) => a.startPosition.row - b.startPosition.row);
  const checam = paragrafosQueChecam(root);

  // WHENEVER SQLERROR ativo a partir da linha em que foi declarado. CONTINUE
  // desliga o tratamento — e aí a checagem volta a ser obrigatória.
  let whenceverAtivoApartirDe = Number.POSITIVE_INFINITY;
  for (const e of execs) {
    const sql = textoSql(e);
    const w = /^\s*WHENEVER\s+(SQLERROR|SQLWARNING|NOT\s+FOUND)\s+(.+)$/i.exec(sql);
    if (!w) continue;
    const acao = w[2]!.trim().toUpperCase();
    if (/^CONTINUE\b/.test(acao)) {
      whenceverAtivoApartirDe = Number.POSITIVE_INFINITY;
    } else if (e.startPosition.row < whenceverAtivoApartirDe) {
      whenceverAtivoApartirDe = e.startPosition.row;
    }
  }

  const out: SqlcodeNaoChecado[] = [];
  for (const e of execs) {
    const sql = textoSql(e);
    if (NAO_EXECUTA.test(sql)) continue;
    if (e.startPosition.row > whenceverAtivoApartirDe) continue;

    // Procura a checagem nos comandos SEGUINTES, dentro do mesmo bloco. Outro
    // EXEC SQL antes da checagem encerra a busca: o primeiro ficou sem olhar.
    let checado = false;
    for (const irmao of irmaosApos(e)) {
      if (irmao.type === "exec_sql_statement") break;
      if (CHECA_SQL.test(irmao.text)) {
        checado = true;
        break;
      }
      const perf = /\bPERFORM\s+([A-Z0-9-]+)/i.exec(irmao.text);
      if (perf && checam.has(perf[1]!.toUpperCase())) {
        checado = true;
        break;
      }
      const goto_ = /\bGO\s+TO\s+([A-Z0-9-]+)/i.exec(irmao.text);
      if (goto_ && checam.has(goto_[1]!.toUpperCase())) {
        checado = true;
        break;
      }
    }
    if (checado) continue;

    out.push({
      linha: e.startPosition.row,
      trecho: e.text.split("\n")[0]!.trim().slice(0, 120),
      verbo: verboDe(sql),
      paragrafo: paragrafoDe(e),
    });
  }
  return out;
}
