import type { BuiltNode } from "./builtNode.ts";
import { camposDeclarados, type CampoDeclarado } from "./cobolData.ts";

// ---------------------------------------------------------------------------
// Dado morto em COBOL: campo declarado e nunca referenciado.
//
// POR QUE ISTO NÃO É REGEX: exige cruzar a DATA DIVISION com a PROCEDURE
// DIVISION do programa inteiro. Nenhum padrão por linha decide isso — a
// declaração está numa linha e o uso (ou a ausência dele) está espalhado por
// centenas de outras, possivelmente em copybook.
//
// POR QUE IMPORTA EM COBOL MAIS QUE EM OUTRAS LINGUAGENS: o campo ocupa espaço
// no registro e no load module, e copybook compartilhado carrega o campo morto
// para dezenas de programas. Em modernização, cada campo morto que sobrevive
// vira um campo morto na tabela nova.
//
// O QUE NÃO CONTA COMO MORTO, e cada exclusão tem motivo concreto:
//   - grupo (item sem PIC): usar o filho conta como usar o grupo;
//   - FILLER: é preenchimento, nunca tem nome para referenciar;
//   - item com REDEFINES ou redefinido por outro: o acesso é pelo par;
//   - LINKAGE SECTION: é a interface do programa, quem usa é quem chama;
//   - FILE SECTION nível 01: o registro é lido/escrito pelo nome do arquivo;
//   - nome-condição (88): usar o 88 é usar o campo pai, e vice-versa.
// ---------------------------------------------------------------------------

export interface CampoMorto {
  nome: string;
  nivel: number;
  linha: number;
  secao: string;
  picture: string | null;
}

/** Palavras que nunca são referência a campo. */
const RESERVADAS = new Set([
  "PIC", "PICTURE", "VALUE", "VALUES", "OCCURS", "TIMES", "REDEFINES", "USAGE",
  "COMP", "COMP-1", "COMP-2", "COMP-3", "COMP-4", "COMP-5", "COMPUTATIONAL",
  "BINARY", "PACKED-DECIMAL", "DISPLAY", "INDEX", "POINTER", "IS", "TO", "FROM",
  "BY", "THRU", "THROUGH", "SPACES", "SPACE", "ZERO", "ZEROS", "ZEROES",
  "LOW-VALUE", "LOW-VALUES", "HIGH-VALUE", "HIGH-VALUES", "ALL", "FILLER",
  "SECTION", "DIVISION", "PROGRAM-ID", "AUTHOR", "SOURCE-COMPUTER",
  "OBJECT-COMPUTER", "SPECIAL-NAMES", "FILE-CONTROL", "SELECT", "ASSIGN",
  "ORGANIZATION", "ACCESS", "RECORD", "KEY", "STATUS", "LABEL", "RECORDS",
  "BLOCK", "CONTAINS", "DATA", "WORKING-STORAGE", "LOCAL-STORAGE", "LINKAGE",
  "PROCEDURE", "IDENTIFICATION", "ENVIRONMENT", "CONFIGURATION", "INPUT-OUTPUT",
]);

/**
 * Nomes referenciados na PROCEDURE DIVISION (e em cláusulas que apontam para
 * outro campo, como REDEFINES e DEPENDING ON).
 *
 * Conta referência por TEXTO, não por resolução de escopo: COBOL permite
 * qualificação (`WS-NUM OF WS-CONTA`) e nomes repetidos em grupos diferentes.
 * Resolver isso direito exige tabela de símbolos com qualificação — e enquanto
 * ela não existe, contar por texto ERRA PARA O LADO SEGURO: um campo com nome
 * repetido é considerado usado, e não vira falso positivo.
 */
function nomesReferenciados(root: BuiltNode): Set<string> {
  const usados = new Set<string>();

  const coletar = (texto: string): void => {
    for (const tok of texto.toUpperCase().match(/[A-Z][A-Z0-9-]*/g) ?? []) {
      if (!RESERVADAS.has(tok)) usados.add(tok);
    }
  };

  // Varre a PROCEDURE DIVISION inteira, incluindo o texto de nós NÃO-folha.
  // A condição de um `IF` vive no texto do próprio `if_statement` — ler só as
  // folhas deixava `IF WS-LIGADO` invisível, e todo campo cuja única leitura é
  // por nome-condição (o idioma normal de flag em COBOL) virava dado morto.
  //
  // Repetir token entre pai e filho é irrelevante: é um Set, e sobrecontar só
  // marca campo como USADO — erra para o lado seguro, nunca cria acusação.
  const proc: BuiltNode[] = [];
  const acha: BuiltNode[] = [root];
  while (acha.length) {
    const n = acha.pop()!;
    if (n.type === "procedure_division") proc.push(n);
    else for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) acha.push(c); }
  }
  for (const p of proc) {
    const st: BuiltNode[] = [p];
    while (st.length) {
      const n = st.pop()!;
      if (n.text) coletar(n.text);
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c); }
    }
  }

  // A DATA DIVISION descreve, não usa — mas REDEFINES e OCCURS DEPENDING ON
  // apontam para outro campo, e essa referência conta.
  const dst: BuiltNode[] = [root];
  while (dst.length) {
    const d = dst.pop()!;
    const red = d.childForFieldName?.("redefines")?.text;
    if (red) usados.add(red.toUpperCase());
    const occ = d.childForFieldName?.("occurs")?.text;
    if (occ && !/^\d+$/.test(occ)) usados.add(occ.toUpperCase());
    for (let i = 0; i < d.childCount; i++) { const c = d.child(i); if (c) dst.push(c); }
  }

  return usados;
}

export function camposMortos(root: BuiltNode): CampoMorto[] {
  const div = root.childForFieldName?.("data") ?? null;
  const campos = camposDeclarados(div);
  if (campos.length === 0) return [];

  const usados = nomesReferenciados(root);

  // Um campo redefinido por outro é acessado pelo par: marcar os dois lados.
  const redefinidos = new Set(campos.map((c) => c.redefines).filter(Boolean) as string[]);

  // Nome-condição (88) em uso implica campo pai em uso: `IF WS-LIGADO` lê
  // `WS-FLAG` sem citá-lo. Sem isto, todo campo cuja única leitura é por 88 —
  // que é o idioma normal de flag em COBOL — seria reportado como morto.
  const paisDeUsado = new Set<string>();
  if (div) {
    const st: BuiltNode[] = [div];
    while (st.length) {
      const n = st.pop()!;
      if (n.type === "data_item") {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c?.type !== "condition_name") continue;
          const nome88 = c.childForFieldName("name")?.text;
          if (nome88 && usados.has(nome88)) {
            const pai = n.childForFieldName("name")?.text;
            if (pai) paisDeUsado.add(pai);
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c); }
    }
  }

  const porNome = new Map<string, CampoDeclarado>(campos.map((c) => [c.nome, c]));

  const out: CampoMorto[] = [];
  for (const c of campos) {
    if (c.ehGrupo) continue;
    if (c.nome === "FILLER") continue;
    if (c.nivel === 88 || c.nivel === 66) continue;
    if (c.secao === "linkage_section") continue;
    if (c.secao === "file_section" && c.nivel === 1) continue;
    if (c.redefines) continue;
    if (redefinidos.has(c.nome)) continue;
    if (usados.has(c.nome)) continue;
    if (paisDeUsado.has(c.nome)) continue;
    void porNome;
    out.push({ nome: c.nome, nivel: c.nivel, linha: c.linha, secao: c.secao, picture: c.picture });
  }
  return out;
}
