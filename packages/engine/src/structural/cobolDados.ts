import type { BuiltNode } from "./builtNode.ts";
import { camposDeclarados, tamanhoDoPic } from "./cobolData.ts";

// ---------------------------------------------------------------------------
// Integridade de dado dentro do programa COBOL.
//
// As análises de `cobolDb2.ts` cuidam da costura com o banco. Estas cuidam de
// uma junta mais interna e igualmente invisível: a DATA DIVISION declara os
// campos num lugar, a PROCEDURE DIVISION os move noutro, e nada no compilador
// obriga que caibam.
//
// É o defeito mais comum de COBOL em produção, e o mais silencioso: um MOVE
// que não cabe não dá erro, ele CORTA. O programa segue, grava o valor errado,
// e a divergência aparece semanas depois numa conciliação que ninguém liga ao
// código.
// ---------------------------------------------------------------------------

export interface AchadoDados {
  tipo: "move-trunca" | "move-trunca-exibicao" | "move-alfa-para-num" | "indicador-nulo-ausente" | "cursor-nunca-usado";
  linha: number;
  detalhe: string;
  trecho: string;
  paragrafo: string | null;
}

function paragrafoDe(n: BuiltNode): string | null {
  let p = n.parent;
  while (p) {
    if (p.type === "paragraph") return p.childForFieldName("name")?.text ?? null;
    p = p.parent;
  }
  return null;
}

function coleta(root: BuiltNode, tipos: string[]): BuiltNode[] {
  const out: BuiltNode[] = [];
  const pilha: BuiltNode[] = [root];
  while (pilha.length) {
    const n = pilha.pop()!;
    if (tipos.includes(n.type)) out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) pilha.push(c);
    }
  }
  return out;
}

/** Campos elementares por nome, para consulta durante a PROCEDURE DIVISION. */
function tabelaDeCampos(root: BuiltNode) {
  const div = root.childForFieldName?.("data") ?? null;
  const mapa = new Map<string, ReturnType<typeof camposDeclarados>[number]>();
  for (const c of camposDeclarados(div)) {
    if (c.ehGrupo) continue;
    mapa.set(c.nome.toUpperCase(), c);
  }
  return mapa;
}

/**
 * 1. MOVE QUE NÃO CABE.
 *
 * `MOVE WS-VALOR-GRANDE TO WS-VALOR-PEQUENO` com origem maior que destino
 * trunca em silêncio. Em campo numérico o COBOL corta os dígitos MAIS
 * SIGNIFICATIVOS, o que transforma 1.250.000 em 250.000 sem aviso nenhum.
 *
 * Só é possível cruzando a declaração dos dois campos com o comando que os
 * liga. Nem a linha do MOVE nem a linha do PIC, sozinhas, dizem alguma coisa.
 */
function moveTrunca(root: BuiltNode, campos: ReturnType<typeof tabelaDeCampos>): AchadoDados[] {
  const out: AchadoDados[] = [];

  for (const n of coleta(root, ["move_statement"])) {
    const texto = n.text.replace(/\s+/g, " ").trim();
    // `MOVE origem TO destino [destino2 ...]`
    const m = /^MOVE\s+(?:CORRESPONDING\s+|CORR\s+)?([A-Z0-9][\w-]*)\s+TO\s+(.+?)\.?$/i.exec(texto);
    if (!m) continue;

    const origem = campos.get(m[1]!.toUpperCase());
    if (!origem?.picture) continue;
    const to = tamanhoDoPic(origem.picture);
    if (!to) continue;

    for (const bruto of m[2]!.split(/[\s,]+/)) {
      const destino = campos.get(bruto.replace(/\.$/, "").toUpperCase());
      if (!destino?.picture) continue;
      const td = tamanhoDoPic(destino.picture);
      if (!td) continue;

      // Alfanumérico corta à DIREITA, numérico corta à ESQUERDA. Os dois
      // truncam, mas a consequência do numérico é muito pior, e a mensagem
      // precisa dizer qual é qual.
      if (to.alfanumerico !== td.alfanumerico) continue; // tratado na análise 2
      if (td.digitos >= to.digitos) continue;

      // DESTINO EDITADO É OUTRA COISA.
      //
      // Medido no CardDemo: 9 dos 13 apontamentos restantes moviam um valor
      // para `+ZZZ,ZZZ,ZZZ.99` ou `$$,$$$,$$9.99`. Campo editado é de EXIBIÇÃO,
      // não de cálculo. O dado guardado não corrompe: quem sai errado é o
      // relatório, e só quando o valor chega perto do limite.
      //
      // Misturar os dois casos na mesma severidade faz a análise perder
      // autoridade justamente onde ela mais serve, que é o caso de corrupção.
      const paraExibicao = td.editado && !to.editado;

      out.push({
        tipo: paraExibicao ? "move-trunca-exibicao" : "move-trunca",
        linha: n.startPosition.row,
        detalhe: paraExibicao
          ? `${origem.nome} PIC ${origem.picture} tem ${to.digitos} dígitos e o campo de saída ${destino.nome} PIC ${destino.picture} comporta ${td.digitos}: o dado guardado fica certo, o relatório é que sai cortado`
          : to.alfanumerico
            ? `${origem.nome} PIC ${origem.picture} não cabe em ${destino.nome} PIC ${destino.picture}: o texto é cortado à direita`
            : `${origem.nome} PIC ${origem.picture} não cabe em ${destino.nome} PIC ${destino.picture}: COBOL corta os dígitos MAIS significativos, então o valor muda de ordem de grandeza`,
        trecho: texto.slice(0, 100),
        paragrafo: paragrafoDe(n),
      });
    }
  }
  return out;
}

/**
 * 2. MOVE ENTRE CLASSES DIFERENTES.
 *
 * Mover alfanumérico para numérico depende do conteúdo em runtime. Se o campo
 * de origem trouxer espaço ou qualquer caractere não numérico, o resultado é
 * lixo ou abend, dependendo do compilador e das opções.
 */
function moveClasseTrocada(
  root: BuiltNode,
  campos: ReturnType<typeof tabelaDeCampos>,
): AchadoDados[] {
  const out: AchadoDados[] = [];

  for (const n of coleta(root, ["move_statement"])) {
    const texto = n.text.replace(/\s+/g, " ").trim();
    const m = /^MOVE\s+([A-Z0-9][\w-]*)\s+TO\s+(.+?)\.?$/i.exec(texto);
    if (!m) continue;

    const origem = campos.get(m[1]!.toUpperCase());
    if (!origem?.picture) continue;
    const to = tamanhoDoPic(origem.picture);
    if (!to?.alfanumerico) continue; // só interessa alfanumérico virando número

    for (const bruto of m[2]!.split(/[\s,]+/)) {
      const destino = campos.get(bruto.replace(/\.$/, "").toUpperCase());
      if (!destino?.picture) continue;
      const td = tamanhoDoPic(destino.picture);
      if (!td || td.alfanumerico) continue;

      out.push({
        tipo: "move-alfa-para-num",
        linha: n.startPosition.row,
        detalhe: `${origem.nome} é alfanumérico (PIC ${origem.picture}) e ${destino.nome} é numérico (PIC ${destino.picture}): se a origem trouxer espaço ou letra, o resultado é imprevisível`,
        trecho: texto.slice(0, 100),
        paragrafo: paragrafoDe(n),
      });
    }
  }
  return out;
}

function textoSql(n: BuiltNode): string {
  return n.text.replace(/^\s*EXEC\s+SQL/i, "").replace(/END-EXEC\.?/i, "").trim();
}

/**
 * 3. COLUNA QUE ACEITA NULO SEM VARIÁVEL INDICADORA.
 *
 * `SELECT col INTO :WS-X` numa coluna que aceita NULL devolve SQLCODE -305 e o
 * programa não recebe valor nenhum. A correção é declarar um indicador
 * (`INTO :WS-X:WS-X-IND`), e a ausência dele é invisível em qualquer análise
 * que olhe só o SQL ou só o COBOL.
 *
 * O que dá para saber sem catálogo do banco: as colunas declaradas no próprio
 * fonte com `DECLARE ... TABLE`. Sem `NOT NULL`, a coluna aceita nulo. É uma
 * leitura conservadora e por isso só aponta o que está escrito ali.
 */
function indicadorNuloAusente(root: BuiltNode): AchadoDados[] {
  const execs = coleta(root, ["exec_sql_statement"]);
  if (execs.length === 0) return [];

  // Colunas declaradas sem NOT NULL, lidas do `DECLARE ... TABLE` do fonte.
  const aceitaNulo = new Set<string>();
  for (const e of execs) {
    const sql = textoSql(e);
    const decl = /DECLARE\s+[\w.-]+\s+TABLE\s*\(([\s\S]+)\)/i.exec(sql);
    if (!decl) continue;
    for (const linha of decl[1]!.split(",")) {
      const col = /^\s*([A-Z][\w]*)\s+\w/i.exec(linha);
      if (!col) continue;
      if (/\bNOT\s+NULL\b/i.test(linha)) continue;
      aceitaNulo.add(col[1]!.toUpperCase());
    }
  }
  if (aceitaNulo.size === 0) return [];

  const out: AchadoDados[] = [];
  for (const e of execs) {
    const sql = textoSql(e);
    const m = /SELECT\s+([\s\S]+?)\s+INTO\s+([\s\S]+?)\s+FROM/i.exec(sql);
    if (!m) continue;

    const colunas = m[1]!.split(",").map((s) => s.trim().replace(/^.*\./, "").toUpperCase());
    const hosts = m[2]!.split(",").map((s) => s.trim());

    for (let i = 0; i < Math.min(colunas.length, hosts.length); i++) {
      if (!aceitaNulo.has(colunas[i]!)) continue;
      // `:WS-X:WS-X-IND` é a forma com indicador. Sem o segundo `:`, não há.
      if (/:\s*[\w-]+\s*:\s*[\w-]+/.test(hosts[i]!)) continue;
      out.push({
        tipo: "indicador-nulo-ausente",
        linha: e.startPosition.row,
        detalhe: `${colunas[i]} aceita NULL e ${hosts[i]!.trim()} não tem variável indicadora: o SELECT devolve -305 e o campo fica sem valor`,
        trecho: sql.split("\n")[0]!.trim().slice(0, 100),
        paragrafo: paragrafoDe(e),
      });
    }
  }
  return out;
}

/**
 * 4. CURSOR DECLARADO E NUNCA USADO.
 *
 * Sobra de manutenção. Não quebra nada, mas o `DECLARE` sugere um caminho de
 * leitura que não existe, e quem for manter o programa vai procurar por ele.
 */
function cursorNuncaUsado(root: BuiltNode): AchadoDados[] {
  const execs = coleta(root, ["exec_sql_statement"]);
  const declarados = new Map<string, BuiltNode>();
  const usados = new Set<string>();

  for (const e of execs) {
    const sql = textoSql(e);
    const dec = /DECLARE\s+([A-Z][\w-]*)\s+(?:(?:NO\s+)?SCROLL\s+)?CURSOR\b/i.exec(sql);
    if (dec) declarados.set(dec[1]!.toUpperCase(), e);
    for (const m of sql.matchAll(/\b(?:OPEN|FETCH|CLOSE)\s+([A-Z][\w-]*)/gi)) {
      usados.add(m[1]!.toUpperCase());
    }
  }

  const out: AchadoDados[] = [];
  for (const [nome, e] of declarados) {
    if (usados.has(nome)) continue;
    out.push({
      tipo: "cursor-nunca-usado",
      linha: e.startPosition.row,
      detalhe: `cursor ${nome} declarado e nunca aberto`,
      trecho: textoSql(e).split("\n")[0]!.trim().slice(0, 100),
      paragrafo: paragrafoDe(e),
    });
  }
  return out;
}

export function analisarDados(root: BuiltNode): AchadoDados[] {
  const campos = tabelaDeCampos(root);
  return [
    ...moveTrunca(root, campos),
    ...moveClasseTrocada(root, campos),
    ...indicadorNuloAusente(root),
    ...cursorNuncaUsado(root),
  ].sort((a, b) => a.linha - b.linha);
}
