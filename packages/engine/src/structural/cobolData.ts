import { BuiltNode, type Pos } from "./builtNode.ts";

// ---------------------------------------------------------------------------
// DATA DIVISION do COBOL.
//
// O parser anterior só modelava a PROCEDURE DIVISION — o que o programa FAZ.
// Metade da análise de COBOL é sobre o que o programa DECLARA: campo nunca
// usado, `REDEFINES` que reinterpreta bytes, `OCCURS` sem limite checado, e —
// o que mais importa para a costura com DB2 — o `PIC` da host variable, que é
// o que diz se `SELECT ... INTO :WS-VALOR` trunca ou não.
//
// A HIERARQUIA VEM DO NÍVEL, NÃO DA INDENTAÇÃO. `05` sob `01` é filho; outro
// `01` fecha a árvore inteira. Programa COBOL real vem com indentação
// inconsistente depois de décadas de manutenção, então indentação não serve
// como sinal — o número do nível é a única fonte confiável.
//
// Níveis especiais: 66 (RENAMES), 77 (item independente, sempre raiz) e 88
// (nome-condição, não é campo — é um valor nomeado do campo anterior).
// ---------------------------------------------------------------------------

/** Uma declaração pode atravessar linhas até o ponto final. */
const NIVEL = /^\s*(\d{2})\s+([A-Z0-9$#@_-]+|FILLER)\b/i;
const SECAO = /^\s*(WORKING-STORAGE|LOCAL-STORAGE|LINKAGE|FILE|REPORT|COMMUNICATION|SCREEN)\s+SECTION\s*\./i;
const DATA_DIV = /^\s*DATA\s+DIVISION\s*\./i;
const PROC_DIV = /^\s*PROCEDURE\s+DIVISION/i;
const FD = /^\s*(FD|SD|RD)\s+([A-Z0-9$#@_-]+)/i;

const SECAO_NODE: Record<string, string> = {
  "WORKING-STORAGE": "working_storage_section",
  "LOCAL-STORAGE": "local_storage_section",
  LINKAGE: "linkage_section",
  FILE: "file_section",
  REPORT: "report_section",
  COMMUNICATION: "communication_section",
  SCREEN: "screen_section",
};

/** Cláusulas que descrevem o campo. Extraídas do texto inteiro da declaração. */
function extraiClausulas(texto: string): {
  picture?: string;
  usage?: string;
  occurs?: string;
  redefines?: string;
  value?: string;
  ehFiller: boolean;
} {
  // O `.` faz parte de PIC editado (`ZZ9.99`), então não dá para excluí-lo da
  // classe — mas o ponto que ENCERRA a declaração seria capturado junto.
  // Tirar só o final resolve os dois casos.
  const picBruto = /\b(?:PIC|PICTURE)\s+(?:IS\s+)?([A-Z0-9()SV$*+,./Z-]+)/i.exec(texto);
  const pic = picBruto ? [picBruto[0], picBruto[1]!.replace(/\.+$/, "")] : null;
  // USAGE pode vir com ou sem a palavra USAGE.
  const usg =
    /\b(?:USAGE\s+(?:IS\s+)?)?(COMP-[1-5]|COMPUTATIONAL-[1-5]|COMP|COMPUTATIONAL|BINARY|PACKED-DECIMAL|DISPLAY|INDEX|POINTER|NATIONAL)\b/i.exec(
      texto,
    );
  const occ = /\bOCCURS\s+(?:(\d+)\s+TO\s+)?(\d+|[A-Z0-9-]+)\s*(?:TIMES)?/i.exec(texto);
  const red = /\bREDEFINES\s+([A-Z0-9$#@_-]+)/i.exec(texto);
  const val = /\bVALUE\s+(?:IS\s+)?('[^']*'|"[^"]*"|[A-Z0-9+.-]+)/i.exec(texto);
  return {
    picture: pic?.[1],
    usage: usg?.[1]?.toUpperCase(),
    occurs: occ?.[2],
    redefines: red?.[1]?.toUpperCase(),
    value: val?.[1],
    ehFiller: /^\s*\d{2}\s+FILLER\b/i.test(texto),
  };
}

/**
 * Tamanho em dígitos/caracteres declarado pelo PIC.
 *
 * É o que permite comparar host variable com coluna DB2: `PIC S9(4) COMP`
 * cabe 4 dígitos, e receber um `INTEGER` do DB2 ali trunca em silêncio. Sem
 * este cálculo a regra de truncamento não existe.
 */
export function tamanhoDoPic(pic: string): {
  digitos: number;
  decimais: number;
  alfanumerico: boolean;
  /** PICTURE de edição (`$`, `Z`, `,`, `.`, `+`): campo de saída, não de cálculo. */
  editado: boolean;
} | null {
  if (!pic) return null;
  // A cláusula de USAGE não faz parte da PICTURE e precisa sair antes de
  // qualquer leitura: `COMP-3` tem um hífen, que é símbolo de sinal flutuante,
  // e fazia o campo ser classificado como editado.
  const p = pic
    .toUpperCase()
    .replace(/\b(?:USAGE\s+)?(?:IS\s+)?(?:COMP(?:UTATIONAL)?(?:-[1-5])?|BINARY|PACKED-DECIMAL|DISPLAY-1|DISPLAY|INDEX|POINTER)\b/g, "")
    .trim();

  // PICTURE DE EDIÇÃO
  // ---------------------------------------------------------------------------
  // Medido contra COBOL real (AWS CardDemo, 113 arquivos): a versão anterior
  // contava só `9 X A Z *` e ignorava `$`, `+`, `-` e a vírgula. Isso fazia
  // `$$,$$$,$$9.99` valer 1 dígito em vez de 10, e a análise de MOVE apontava
  // truncamento em 13 formatações de relatório perfeitamente corretas.
  //
  // As regras que importam para contar capacidade:
  //   9 Z *      uma posição de dígito cada
  //   $ + -      inserção FLUTUANTE: n símbolos dão n-1 posições, porque uma
  //              fica reservada para o próprio símbolo. Um só é inserção fixa
  //              e não vale dígito nenhum
  //   , B 0 /    inserção: ocupam espaço, não carregam dígito
  //   .          é o ponto decimal do campo editado, faz o papel do V
  //   CR DB      dois caracteres de sinal, nenhum dígito
  // `CR`/`DB` entram como par; `C` solto NÃO é símbolo de edição, e incluí-lo
  // marcava `PIC S9(4) COMP` como campo editado por causa do C de COMP.
  const editado = (/[Z*$,]/.test(p) || /\b(CR|DB)\b/.test(p) || /[+\-]/.test(p)) && /[9Z*$]/.test(p);

  let digitos = 0;
  let decimais = 0;
  let alfanumerico = false;
  let depoisDoPonto = false;

  // `CR` e `DB` saem antes: senão o `C`, o `R`, o `D` e o `B` seriam lidos soltos.
  const limpo = p.replace(/\b(CR|DB)\b/g, "");

  const re = /([9XAZ*$+\-])(?:\((\d+)\))?|(V|\.)|(S)|([,B0/])/g;
  let m: RegExpExecArray | null;
  let flutuantes = 0; // total de `$`/`+`/`-` vistos, para descontar um no fim

  while ((m = re.exec(limpo)) !== null) {
    if (m[3]) {
      // `V` é implícito, `.` é o ponto do campo editado. Ambos separam a parte
      // decimal, e só o primeiro conta.
      if (!depoisDoPonto) depoisDoPonto = true;
      continue;
    }
    if (m[4]) continue; // `S` não ocupa posição sem SEPARATE CHARACTER
    if (m[5]) continue; // inserção pura: ocupa espaço, não carrega dígito

    const simbolo = m[1]!;
    const n = m[2] ? parseInt(m[2], 10) : 1;

    if (simbolo === "X" || simbolo === "A") {
      alfanumerico = true;
      if (depoisDoPonto) decimais += n;
      else digitos += n;
      continue;
    }
    if (simbolo === "$" || simbolo === "+" || simbolo === "-") {
      flutuantes += n;
      if (depoisDoPonto) decimais += n;
      else digitos += n;
      continue;
    }
    // 9, Z, *
    if (depoisDoPonto) decimais += n;
    else digitos += n;
  }

  // Um dos símbolos flutuantes é o próprio sinal ou cifrão impresso, não uma
  // posição de dígito. Sinal fixo (um só) não vale dígito nenhum.
  if (flutuantes > 0) {
    const desconto = 1;
    if (digitos >= desconto) digitos -= desconto;
    else if (decimais >= desconto) decimais -= desconto;
  }

  if (digitos === 0 && decimais === 0 && !alfanumerico) return null;
  return { digitos: digitos + decimais, decimais, alfanumerico, editado };
}

interface Item {
  nivel: number;
  node: BuiltNode;
}

function pos(row: number, column = 0): Pos {
  return { row, column };
}

/**
 * Constrói o nó `data_division` a partir das linhas já sem área de sequência.
 * Devolve `null` quando o programa não tem DATA DIVISION.
 */
export function parseDataDivision(lines: string[]): BuiltNode | null {
  let inicio = lines.findIndex((l) => DATA_DIV.test(l));

  // COPYBOOK: o formato mais comum é um fragmento com itens de dado e NENHUM
  // cabeçalho `DATA DIVISION.` — ele é colado dentro de um. Tratar isso como
  // "sem dados" faria o analisador ignorar justamente o arquivo cuja razão de
  // existir são os dados.
  if (inicio < 0) {
    const temItem = lines.some((l) => NIVEL.test(l) && !l.trim().startsWith("*"));
    if (!temItem) return null;
    inicio = -1; // varre desde a primeira linha
  }

  let fim = lines.findIndex((l, i) => i > inicio && PROC_DIV.test(l));
  if (fim < 0) fim = lines.length;

  // `inicio` é -1 no caso do copybook sem cabeçalho; a varredura começa em 0,
  // mas a POSIÇÃO do nó não pode ser negativa — um achado ancorado nele sairia
  // apontando para a linha -1.
  const primeira = Math.max(inicio, 0);
  const ultima = Math.max(fim - 1, 0);
  const div = new BuiltNode(
    "data_division",
    lines.slice(primeira, fim).join("\n"),
    pos(primeira),
    pos(ultima, (lines[ultima] ?? "").length),
  );

  let secao: BuiltNode | null = null;
  // Pilha de itens abertos, do nível mais baixo para o mais alto.
  let pilha: Item[] = [];

  const alvoAtual = (): BuiltNode => secao ?? div;

  for (let i = inicio + 1; i < fim; i++) {
    const linha = lines[i] ?? "";
    const t = linha.trim();
    if (!t || t.startsWith("*")) continue;

    const sec = SECAO.exec(linha);
    if (sec) {
      const tipo = SECAO_NODE[sec[1]!.toUpperCase()] ?? "section";
      secao = new BuiltNode(tipo, t, pos(i), pos(i, linha.length));
      div.add(secao);
      pilha = [];
      continue;
    }

    const fd = FD.exec(linha);
    if (fd) {
      const node = new BuiltNode("file_description", t, pos(i), pos(i, linha.length));
      node.add(new BuiltNode("identifier", fd[2]!.toUpperCase(), pos(i), pos(i, linha.length)), "name");
      alvoAtual().add(node);
      pilha = [];
      continue;
    }

    const niv = NIVEL.exec(linha);
    if (!niv) continue;

    // Junta linhas até o ponto final: `05 WS-X PIC 9(4)` costuma quebrar.
    let ate = i;
    let texto = linha;
    while (ate < fim - 1 && !/\.\s*$/.test((lines[ate] ?? "").trimEnd())) {
      ate++;
      texto += " " + (lines[ate] ?? "");
    }

    const nivel = parseInt(niv[1]!, 10);
    const nome = niv[2]!.toUpperCase();
    const c = extraiClausulas(texto);

    const tipo = nivel === 88 ? "condition_name" : nivel === 66 ? "renames_item" : "data_item";
    const node = new BuiltNode(tipo, texto.trim(), pos(i), pos(ate, (lines[ate] ?? "").length));
    node.add(new BuiltNode("identifier", nome, pos(i), pos(i, linha.length)), "name");
    node.add(new BuiltNode("level_number", String(nivel), pos(i), pos(i, linha.length)), "level");
    if (c.picture) node.add(new BuiltNode("picture_clause", c.picture, pos(i), pos(ate)), "picture");
    if (c.usage) node.add(new BuiltNode("usage_clause", c.usage, pos(i), pos(ate)), "usage");
    if (c.occurs) node.add(new BuiltNode("occurs_clause", c.occurs, pos(i), pos(ate)), "occurs");
    if (c.redefines) node.add(new BuiltNode("redefines_clause", c.redefines, pos(i), pos(ate)), "redefines");
    if (c.value) node.add(new BuiltNode("value_clause", c.value, pos(i), pos(ate)), "value");

    // 88 é nome-condição do item anterior, não um campo irmão.
    if (nivel === 88) {
      const pai = pilha[pilha.length - 1];
      (pai?.node ?? alvoAtual()).add(node);
      i = ate;
      continue;
    }

    // 77 e 01 sempre reabrem a árvore.
    if (nivel === 1 || nivel === 77) {
      pilha = [];
      alvoAtual().add(node);
      pilha.push({ nivel, node });
      i = ate;
      continue;
    }

    // Desempilha até achar um nível MENOR — é a hierarquia por número.
    while (pilha.length > 0 && pilha[pilha.length - 1]!.nivel >= nivel) pilha.pop();
    const pai = pilha[pilha.length - 1];
    (pai?.node ?? alvoAtual()).add(node);
    pilha.push({ nivel, node });
    i = ate;
  }

  return div;
}

export interface CampoDeclarado {
  nome: string;
  nivel: number;
  picture: string | null;
  usage: string | null;
  redefines: string | null;
  occurs: string | null;
  value: string | null;
  /** Linha 0-based no fonte analisado. */
  linha: number;
  /** `01 GRUPO.` sem PIC é grupo — não é campo elementar. */
  ehGrupo: boolean;
  secao: string;
}

/** Achata a árvore em lista de campos — o formato que as regras consomem. */
export function camposDeclarados(div: BuiltNode | null): CampoDeclarado[] {
  if (!div) return [];
  const out: CampoDeclarado[] = [];
  const anda = (n: BuiltNode, secao: string): void => {
    const s = /_section$/.test(n.type) ? n.type : secao;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (!c) continue;
      if (c.type === "data_item" || c.type === "condition_name" || c.type === "renames_item") {
        const pic = c.childForFieldName("picture")?.text ?? null;
        const temFilhoCampo = (() => {
          for (let k = 0; k < c.childCount; k++) {
            if (c.child(k)?.type === "data_item") return true;
          }
          return false;
        })();
        out.push({
          nome: c.childForFieldName("name")?.text ?? "?",
          nivel: parseInt(c.childForFieldName("level")?.text ?? "0", 10),
          picture: pic,
          usage: c.childForFieldName("usage")?.text ?? null,
          redefines: c.childForFieldName("redefines")?.text ?? null,
          occurs: c.childForFieldName("occurs")?.text ?? null,
          value: c.childForFieldName("value")?.text ?? null,
          linha: c.startPosition.row,
          ehGrupo: !pic && temFilhoCampo,
          secao: s,
        });
      }
      anda(c, s);
    }
  };
  anda(div, "unknown");
  return out;
}
