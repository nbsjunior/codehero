import { BuiltNode, endPos } from "./builtNode.ts";

// ---------------------------------------------------------------------------
// Parser estrutural de SQL PL (DB2 for z/OS e LUW).
//
// Até aqui DB2 era regex pura sobre a linha. Isso perde exatamente o que
// importa: em SQL PL a lógica vive num BLOCO composto, o statement é multilinha
// e o defeito grave — injeção via `EXECUTE IMMEDIATE` de string montada com
// `||` — só é visível ligando a montagem à execução.
//
// Por que não tree-sitter: não existe gramática madura de SQL PL publicada em
// WASM. Escrever um parser recursivo completo de DB2 seria meses; o que o motor
// estrutural consome é bem menor — blocos, laços, chamadas e atribuições.
//
// DUAS ARMADILHAS DO DIALETO, tratadas explicitamente:
//
//  1. O terminador do STATEMENT (`;`) é diferente do terminador da ROTINA
//     (`@`, ou o que vier em `--#SET TERMINATOR`). Um parser que corta em `;`
//     parte a procedure no meio e nunca vê o bloco.
//  2. `END` é ambíguo: fecha o bloco composto, mas também fecha `END IF`,
//     `END WHILE`, `END FOR`, `END REPEAT`, `END LOOP` e `END CASE`. Contar
//     `BEGIN`/`END` sem olhar a palavra seguinte desalinha o aninhamento.
// ---------------------------------------------------------------------------

const CREATE_ROTINA =
  /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TRIGGER)\s+("[^"]+"|[\w$#@.]+)/i;

/** `END IF`, `END WHILE`, ... fecham construções, não o bloco composto. */
const END_DE_CONSTRUCAO = /^END\s+(IF|WHILE|FOR|REPEAT|LOOP|CASE)\b/i;

interface Statement {
  texto: string;
  /** Linha (0-based) onde o statement começa no fonte original. */
  linha: number;
  linhaFim: number;
}

/**
 * Cabeçalho de controle: fecha um statement SEM ponto e vírgula.
 *
 * Esta é a diferença que quebra qualquer parser emprestado de outro dialeto.
 * Em SQL PL o `;` termina o comando SIMPLES; `WHILE ... DO`, `IF ... THEN` e
 * `BEGIN` abrem escopo e não levam terminador. Cortar só no `;` funde o
 * cabeçalho com o primeiro comando de dentro — o `IF` some da árvore e tudo
 * que vem depois fica pendurado no nível errado.
 */
const CABECALHO_DE_CONTROLE =
  /(?:^|\s)(?:THEN|DO|LOOP|BEGIN(?:\s+ATOMIC)?|ELSE)\s*$/i;

/**
 * Divide o fonte em statements respeitando literais e comentários.
 *
 * O terminador de rotina (`@` isolado, ou o declarado em `--#SET TERMINATOR`)
 * fecha a rotina inteira; `;` fecha um statement dentro dela.
 */
function statements(source: string): Statement[] {
  const linhas = source.split(/\r?\n/);
  let terminadorRotina = "@";
  const out: Statement[] = [];

  let buf: string[] = [];
  let inicio = 0;
  let emComentarioBloco = false;

  const emite = (fim: number) => {
    const texto = buf.join("\n").trim();
    if (texto) out.push({ texto, linha: inicio, linhaFim: fim });
    buf = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const bruta = linhas[i] ?? "";

    const setTerm = /^\s*--\s*#SET\s+TERMINATOR\s+(\S)/i.exec(bruta);
    if (setTerm) {
      terminadorRotina = setTerm[1]!;
      continue;
    }

    // Remove comentários mantendo o texto de código; strings ficam intactas.
    let limpa = "";
    let emString = false;
    for (let c = 0; c < bruta.length; c++) {
      const ch = bruta[c]!;
      const prox = bruta[c + 1];
      if (emComentarioBloco) {
        if (ch === "*" && prox === "/") {
          emComentarioBloco = false;
          c++;
        }
        continue;
      }
      if (emString) {
        limpa += ch;
        // `''` é aspa escapada dentro do literal, não o fim dele.
        if (ch === "'" && prox === "'") {
          limpa += prox;
          c++;
        } else if (ch === "'") emString = false;
        continue;
      }
      if (ch === "-" && prox === "-") break;
      if (ch === "/" && prox === "*") {
        emComentarioBloco = true;
        c++;
        continue;
      }
      if (ch === "'") emString = true;
      limpa += ch;
    }

    if (buf.length === 0) {
      if (!limpa.trim()) continue;
      inicio = i;
    }

    let cortado = limpa.trim();
    // O terminador de rotina aparece nas duas formas, e `END@` (colado) é a
    // mais comum nos fontes reais. Tratar só o `@` sozinho fazia a rotina
    // seguinte ser engolida pela anterior — o arquivo inteiro virava um
    // statement e nada depois do primeiro `END` era analisado.
    if (terminadorRotina !== ";" && cortado.endsWith(terminadorRotina)) {
      cortado = cortado.slice(0, -terminadorRotina.length).trim();
      if (cortado) buf.push(cortado);
      emite(i);
      continue;
    }
    buf.push(limpa);
    if (cortado.endsWith(";")) {
      emite(i);
      continue;
    }
    // `END LOOP` / `END REPEAT` terminam em palavra de cabeçalho mas FECHAM
    // escopo; deixá-los cair aqui os transformaria em abertura.
    if (CABECALHO_DE_CONTROLE.test(buf.join(" ")) && !/^\s*END\b/i.test(buf[0] ?? "")) emite(i);
  }
  if (buf.length) emite(linhas.length - 1);

  return out;
}

/** Palavras que abrem um nível de aninhamento e o tipo de nó correspondente. */
const ABERTURAS: Array<{ re: RegExp; tipo: string }> = [
  { re: /^(?:[\w$#]+\s*:\s*)?BEGIN(?:\s+ATOMIC)?\b/i, tipo: "block" },
  { re: /^IF\b/i, tipo: "if_statement" },
  { re: /^WHILE\b/i, tipo: "while_statement" },
  { re: /^(?:[\w$#]+\s*:\s*)?FOR\b/i, tipo: "for_statement" },
  { re: /^(?:[\w$#]+\s*:\s*)?REPEAT\b/i, tipo: "repeat_statement" },
  { re: /^(?:[\w$#]+\s*:\s*)?LOOP\b/i, tipo: "loop_statement" },
  { re: /^CASE\b/i, tipo: "case_statement" },
];

function abertura(texto: string): string | null {
  for (const a of ABERTURAS) if (a.re.test(texto)) return a.tipo;
  return null;
}

/** `IF ... THEN` e `WHILE ... DO` podem terminar na mesma linha em uma só sentença. */
function fechaNaPropriaSentenca(texto: string, tipo: string): boolean {
  if (tipo === "if_statement") return /\bEND\s+IF\b/i.test(texto);
  if (tipo === "while_statement") return /\bEND\s+WHILE\b/i.test(texto);
  if (tipo === "for_statement") return /\bEND\s+FOR\b/i.test(texto);
  if (tipo === "repeat_statement") return /\bEND\s+REPEAT\b/i.test(texto);
  if (tipo === "loop_statement") return /\bEND\s+LOOP\b/i.test(texto);
  if (tipo === "case_statement") return /\bEND\s+CASE\b/i.test(texto);
  // Bloco composto: `BEGIN ... END` na mesma sentença.
  return /\bBEGIN\b[\s\S]*\bEND\b/i.test(texto);
}

function pos(st: Statement, texto: string) {
  return {
    start: { row: st.linha, column: 0 },
    end: { row: st.linhaFim, column: texto.length },
  };
}

/**
 * Chamada dinâmica: `EXECUTE IMMEDIATE v`, `PREPARE s FROM v`, `CALL p(...)`.
 *
 * Expõe `function` e `arguments` no mesmo formato que as outras linguagens, para
 * as regras de `callee`/`argument` funcionarem sem caso especial de SQL PL.
 */
function chamada(st: Statement, texto: string, montadas: Set<string>): BuiltNode | null {
  const p = pos(st, texto);
  const mk = (nome: string, arg: string) => {
    const n = new BuiltNode("call_statement", texto, p.start, p.end);
    n.add(new BuiltNode("identifier", nome, p.start, p.start), "function");
    const args = new BuiltNode("argument_list", arg, p.start, p.end);
    const cru = arg.trim();
    const literal = /^N?'/.test(cru);

    // Se a variável executada foi montada com `||` antes, NESTA rotina, o
    // argumento é uma string REMENDADA — não apenas "não literal". É a
    // diferença entre `EXECUTE IMMEDIATE v_sql` onde v_sql veio de
    // `'... WHERE ID = ' || p_conta` (injeção) e onde veio de um literal
    // inteiro (inofensivo). Sem esta ligação a regra teria que escolher entre
    // perder o primeiro caso ou apontar o segundo.
    if (!literal && montadas.has(cru.toUpperCase())) {
      const bin = new BuiltNode("binary_expression", cru, p.start, p.end);
      bin.add(new BuiltNode("string_literal", "SQL", p.start, p.start));
      bin.add(new BuiltNode("identifier", cru, p.start, p.start));
      args.add(bin);
    } else {
      args.add(new BuiltNode(literal ? "string_literal" : "identifier", cru, p.start, p.end));
    }
    n.add(args, "arguments");
    return n;
  };

  const exec = /^EXECUTE\s+IMMEDIATE\s+([\s\S]+?)\s*;?\s*$/i.exec(texto);
  if (exec) return mk("EXECUTE IMMEDIATE", exec[1]!);

  const prep = /^PREPARE\s+[\w$#]+\s+FROM\s+([\s\S]+?)\s*;?\s*$/i.exec(texto);
  if (prep) return mk("PREPARE", prep[1]!);

  const call = /^CALL\s+("[^"]+"|[\w$#.]+)\s*(?:\(([\s\S]*)\))?/i.exec(texto);
  if (call) return mk(call[1]!.replace(/"/g, ""), call[2] ?? "");

  return null;
}

/**
 * Atribuição. `SET v = 'SELECT * FROM T WHERE C = ' || p_id` é a montagem que
 * torna o `EXECUTE IMMEDIATE` seguinte uma injeção — expor o `binary_expression`
 * é o que permite a regra ligar as duas pontas.
 */
function atribuicao(st: Statement, texto: string, montadas: Set<string>): BuiltNode | null {
  const m = /^(?:SET|DECLARE\s+[\w$#]+\s+[\w()\s,]*DEFAULT)\s+([\w$#]+)?\s*=?\s*([\s\S]+?)\s*;?\s*$/i.exec(
    texto,
  );
  if (!/^SET\b/i.test(texto)) return null;
  if (!m) return null;
  const p = pos(st, texto);
  const n = new BuiltNode("assignment", texto, p.start, p.end);
  const rhs = m[2] ?? "";
  // `||` é a concatenação do SQL padrão — em SQL PL é ela, não `+`.
  if (/\|\|/.test(rhs) && /'/.test(rhs)) {
    // Registra o destino: a partir daqui, executar esta variavel e executar
    // SQL remendado. Ver `chamada`.
    if (m[1]) montadas.add(m[1].toUpperCase());
    const bin = new BuiltNode("binary_expression", rhs, p.start, p.end);
    bin.add(new BuiltNode("string_literal", "SQL", p.start, p.start));
    bin.add(new BuiltNode("identifier", rhs, p.start, p.start));
    n.add(bin);
  }
  return n;
}

/**
 * Declarações que a análise precisa enxergar como nós próprios: cursor e
 * handler. Um `CONTINUE HANDLER FOR SQLEXCEPTION` vazio engole todo erro do
 * bloco — é o `catch {}` do mainframe.
 */
function declaracao(st: Statement, texto: string): BuiltNode | null {
  const cursor = /^DECLARE\s+([\w$#]+)\s+(?:(?:NO\s+)?SCROLL\s+)?CURSOR\b/i.exec(texto);
  if (cursor) {
    const p = pos(st, texto);
    const n = new BuiltNode("cursor_declaration", texto, p.start, p.end);
    n.add(new BuiltNode("identifier", cursor[1]!, p.start, p.start), "name");
    return n;
  }
  const handler = /^DECLARE\s+(CONTINUE|EXIT|UNDO)\s+HANDLER\s+FOR\s+([\s\S]+?)\s*;?\s*$/i.exec(
    texto,
  );
  if (handler) {
    const p = pos(st, texto);
    const n = new BuiltNode("handler_declaration", texto, p.start, p.end);
    n.add(new BuiltNode("identifier", handler[1]!.toUpperCase(), p.start, p.start), "name");
    return n;
  }
  return null;
}

function noDeStatement(st: Statement, montadas: Set<string>): BuiltNode {
  const texto = st.texto;
  return (
    chamada(st, texto, montadas) ??
    atribuicao(st, texto, montadas) ??
    declaracao(st, texto) ??
    (() => {
      const p = pos(st, texto);
      return new BuiltNode("statement", texto, p.start, p.end);
    })()
  );
}

export function parseSqlplSource(source: string): BuiltNode {
  const linhas = source.split(/\r?\n/);
  const root = new BuiltNode(
    "program",
    source,
    { row: 0, column: 0 },
    endPos(linhas, Math.max(0, linhas.length - 1)),
  );

  const sts = statements(source);
  // Pilha de contêineres abertos. O topo recebe os próximos statements.
  const pilha: BuiltNode[] = [root];
  let rotinaAberta: BuiltNode | null = null;
  // Variaveis montadas com `||`. Zerado a cada rotina: um `v_sql` remendado
  // numa procedure nao diz nada sobre o `v_sql` de outra.
  let montadas = new Set<string>();

  for (const st of sts) {
    const texto = st.texto;
    const p = pos(st, texto);
    const topo = pilha[pilha.length - 1]!;

    // --- fim de construção: END IF / END WHILE / ... e END do bloco
    if (END_DE_CONSTRUCAO.test(texto) || /^END\b/i.test(texto)) {
      if (pilha.length > 1) {
        const fechado = pilha.pop()!;
        fechado.endPosition = p.end;
        // O END da rotina fecha também a definição.
        if (rotinaAberta && pilha[pilha.length - 1] === rotinaAberta) {
          rotinaAberta.endPosition = p.end;
          pilha.pop();
          rotinaAberta = null;
        }
      }
      continue;
    }

    // --- CREATE PROCEDURE/FUNCTION/TRIGGER: pode trazer o BEGIN junto
    const cria = CREATE_ROTINA.exec(texto);
    if (cria) {
      const tipo =
        cria[1]!.toUpperCase() === "FUNCTION" ? "function_definition" : "procedure_definition";
      montadas = new Set<string>();
      const rotina = new BuiltNode(tipo, texto, p.start, p.end);
      rotina.add(
        new BuiltNode("identifier", cria[2]!.replace(/"/g, ""), p.start, p.start),
        "name",
      );
      const corpo = new BuiltNode("block", texto, p.start, p.end);
      rotina.add(corpo, "body");
      topo.add(rotina);

      // A sentença inteira pode conter o corpo (`BEGIN ... END` no mesmo
      // statement, comum quando o terminador de rotina é `@`).
      if (/\bBEGIN\b/i.test(texto) && fechaNaPropriaSentenca(texto, "block")) {
        // `corpoDe` preserva as quebras de linha, então os statements internos
        // vêm numerados a partir do início DESTA sentença — daí o deslocamento.
        for (const interno of statements(corpoDe(texto))) {
          corpo.add(
            noDeStatement(
              {
                texto: interno.texto,
                linha: interno.linha + st.linha,
                linhaFim: interno.linhaFim + st.linha,
              },
              montadas,
            ),
          );
        }
        continue;
      }
      pilha.push(rotina);
      pilha.push(corpo);
      rotinaAberta = rotina;
      continue;
    }

    // --- construções que abrem nível
    const tipoAbre = abertura(texto);
    if (tipoAbre && !fechaNaPropriaSentenca(texto, tipoAbre)) {
      const no = new BuiltNode(tipoAbre, texto, p.start, p.end);
      topo.add(no);
      pilha.push(no);
      continue;
    }

    topo.add(noDeStatement(st, montadas));
  }

  return root;
}

/**
 * Texto entre o primeiro `BEGIN` e o último `END` da sentença, com as quebras
 * de linha PRESERVADAS.
 *
 * Fatiar a string perderia a numeração — o statement interno voltaria a começar
 * na linha 0 e o apontamento cairia no lugar errado do arquivo. Em vez de
 * cortar, o que está fora do corpo vira espaço, e o `\n` sobrevive.
 */
function corpoDe(texto: string): string {
  const abre = /\bBEGIN(?:\s+ATOMIC)?\b/i.exec(texto);
  if (!abre) return texto;
  const inicio = abre.index + abre[0].length;
  const fim = texto.toUpperCase().lastIndexOf("END");
  const limite = fim > inicio ? fim : texto.length;
  const branco = (s: string) => s.replace(/[^\n]/g, " ");
  return branco(texto.slice(0, inicio)) + texto.slice(inicio, limite) + branco(texto.slice(limite));
}
