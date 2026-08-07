import type { Severity, IssueType } from "./severity.ts";
import type { SecurityCategory } from "./engineKinds.ts";

// ---------------------------------------------------------------------------
// Análises COBOL ALGORÍTMICAS.
//
// Diferente de `STRUCTURAL_RULES`, estas não são descritas por uma
// especificação declarativa (`match`, `callee`, `argument`) — elas exigem
// algoritmo próprio sobre a árvore inteira do programa:
//
//   - dado morto cruza DATA DIVISION com PROCEDURE DIVISION;
//   - SQLCODE não checado precisa de ordem entre irmãos, fecho transitivo de
//     PERFORM e escopo de WHENEVER.
//
// Nenhuma das duas cabe num padrão. Manter o catálogo separado deixa isso
// explícito em vez de fingir que uma spec declarativa daria conta.
// ---------------------------------------------------------------------------

export interface CobolAnalysis {
  id: string;
  name: string;
  message: string;
  severity: Severity;
  type: IssueType;
  remediationEffortMin: number;
  cwe: string[];
  owasp: string[];
  sddTemplateId: string;
  category?: SecurityCategory;
  /** Por que um padrão declarativo não resolve. */
  whyNotPattern: string;
}

export const COBOL_ANALYSES: Record<string, CobolAnalysis> = {
  "HERO-CBL-0252-sqlcode-nao-checado": {
    id: "HERO-CBL-0252-sqlcode-nao-checado",
    name: "SqlcodeNaoChecado",
    message:
      "EXEC SQL sem verificar SQLCODE: o DB2 devolve +100 (sem linha) ou -911 (deadlock) e NÃO interrompe o programa — ele segue com a host variable intacta e grava dado errado.",
    severity: "BLOCKER",
    type: "BUG",
    remediationEffortMin: 20,
    cwe: ["CWE-252"],
    owasp: [],
    sddTemplateId: "sdd.db2.check-sqlcode",
    category: "data-integrity",
    whyNotPattern:
      "Exige a ORDEM dos comandos depois do END-EXEC, o fecho transitivo do PERFORM (a checagem quase sempre está num parágrafo comum) e o escopo do WHENEVER SQLERROR. Nada disso está numa linha.",
  },
  "HERO-CBL-1164-dado-morto": {
    id: "HERO-CBL-1164-dado-morto",
    name: "DadoMorto",
    message:
      "Campo declarado e nunca referenciado: ocupa espaço no registro e no load module, e via copybook compartilhado se propaga para dezenas de programas.",
    severity: "MINOR",
    type: "CODE_SMELL",
    remediationEffortMin: 10,
    cwe: ["CWE-1164"],
    owasp: [],
    sddTemplateId: "sdd.smell.remove-dead-code",
    category: "code-smell",
    whyNotPattern:
      "Cruza a DATA DIVISION com a PROCEDURE DIVISION do programa inteiro: a declaração está numa linha (às vezes em copybook) e a ausência de uso está espalhada por todas as outras.",
  },
  "HERO-CBL-0197-truncamento-host-variable": {
    id: "HERO-CBL-0197-truncamento-host-variable",
    name: "TruncamentoHostVariable",
    message:
      "Host variable menor que a coluna do DB2: um INTEGER (10 dígitos) chegando num PIC S9(4) trunca o valor. Dependendo do compilador, sem erro — o programa segue e grava número errado.",
    severity: "CRITICAL",
    type: "BUG",
    remediationEffortMin: 15,
    cwe: ["CWE-197"],
    owasp: [],
    sddTemplateId: "sdd.db2.ajustar-host-variable",
    category: "data-integrity",
    whyNotPattern:
      "Cruza dois lugares distantes: o PIC está na DATA DIVISION e o tipo da coluna está no SQL. Comparar as capacidades exige entender a correspondência posicional entre a lista do SELECT e a lista do INTO.",
  },
  "HERO-CBL-0404-cursor-sem-close": {
    id: "HERO-CBL-0404-cursor-sem-close",
    name: "CursorSemClose",
    message:
      "Cursor aberto e nunca fechado: segura bloqueio e recurso do plano até o fim da unidade de trabalho. Em batch longo é vazamento acumulativo.",
    severity: "MAJOR",
    type: "BUG",
    remediationEffortMin: 10,
    cwe: ["CWE-404"],
    owasp: [],
    sddTemplateId: "sdd.db2.fechar-cursor",
    whyNotPattern:
      "Emparelhar OPEN com CLOSE por nome de cursor ao longo do programa inteiro. Uma linha com OPEN não diz nada; o defeito é a AUSÊNCIA de outra linha em qualquer lugar do fonte.",
  },
  "HERO-CBL-1049-sql-em-laco": {
    id: "HERO-CBL-1049-sql-em-laco",
    name: "SqlEmLaco",
    message:
      "EXEC SQL dentro de PERFORM: uma ida e volta ao DB2 por iteração. No mainframe a CPU é faturada — o N+1 aqui tem preço direto na fatura, não só latência.",
    severity: "MAJOR",
    type: "CODE_SMELL",
    remediationEffortMin: 60,
    cwe: ["CWE-1049"],
    owasp: [],
    sddTemplateId: "sdd.db2.trocar-laco-por-cursor",
    whyNotPattern:
      "Exige saber se o EXEC SQL está DENTRO de um PERFORM — aninhamento, não texto. E precisa excluir FETCH e CLOSE, que em laço são a forma correta de consumir cursor.",
  },
  "HERO-CBL-0459-commit-em-cursor": {
    id: "HERO-CBL-0459-commit-em-cursor",
    name: "CommitEmLacoDeCursor",
    message:
      "COMMIT dentro de laço com cursor sem WITH HOLD: o commit fecha o cursor e a iteração seguinte falha com -501. O defeito só aparece quando o volume passa do ponto de commit — normalmente em produção.",
    severity: "BLOCKER",
    type: "BUG",
    remediationEffortMin: 30,
    cwe: ["CWE-459"],
    owasp: [],
    sddTemplateId: "sdd.db2.cursor-with-hold",
    category: "data-integrity",
    whyNotPattern:
      "Três fatos em lugares diferentes: o COMMIT está dentro de um laço (aninhamento), existe um cursor aberto (outra linha) e esse cursor não foi declarado WITH HOLD (uma terceira linha, às vezes em copybook).",
  },
  "HERO-CBL-0197-move-trunca": {
    id: "HERO-CBL-0197-move-trunca",
    name: "MoveQueTrunca",
    message:
      "MOVE para campo menor: o COBOL corta e não avisa. Em campo numérico o corte é nos dígitos MAIS significativos, então 1.250.000 vira 250.000 e o programa segue como se nada fosse.",
    severity: "CRITICAL",
    type: "BUG",
    remediationEffortMin: 10,
    cwe: ["CWE-197"],
    owasp: [],
    sddTemplateId: "sdd.cobol.ajustar-picture",
    category: "data-integrity",
    whyNotPattern:
      "A linha do MOVE não diz o tamanho de nada, e a linha do PIC não diz que há um MOVE. É preciso cruzar a DATA DIVISION com a PROCEDURE DIVISION, e resolver cada destino quando o comando tem vários.",
  },
  "HERO-CBL-0198-move-trunca-exibicao": {
    id: "HERO-CBL-0198-move-trunca-exibicao",
    name: "MoveTruncaNaExibicao",
    message:
      "Valor movido para campo de saída menor: o dado guardado continua certo, o relatório é que sai cortado. Aparece só quando o valor chega perto do limite, o que costuma ser no fechamento de mês.",
    severity: "MAJOR",
    type: "BUG",
    remediationEffortMin: 10,
    cwe: ["CWE-197"],
    owasp: [],
    sddTemplateId: "sdd.cobol.ajustar-picture",
    category: "data-integrity",
    whyNotPattern:
      "Exige contar as posições de dígito de uma PICTURE de edição, onde `$`, `Z` e `+` valem dígito e vírgula não vale, e comparar com o PIC da origem, declarado em outro ponto do programa.",
  },
  "HERO-CBL-0704-move-classe-trocada": {
    id: "HERO-CBL-0704-move-classe-trocada",
    name: "MoveAlfanumericoParaNumerico",
    message:
      "MOVE de campo alfanumérico para numérico: se a origem trouxer espaço ou letra, o resultado depende do compilador e das opções de compilação. Costuma dar lixo em produção e abend em teste, ou o contrário.",
    severity: "MAJOR",
    type: "BUG",
    remediationEffortMin: 15,
    cwe: ["CWE-704"],
    owasp: [],
    sddTemplateId: "sdd.cobol.validar-antes-do-move",
    category: "data-integrity",
    whyNotPattern:
      "Exige saber a CLASSE dos dois campos, que está declarada longe do comando. `MOVE A TO B` é a mesma forma textual nos dois casos.",
  },
  "HERO-CBL-0305-indicador-nulo-ausente": {
    id: "HERO-CBL-0305-indicador-nulo-ausente",
    name: "IndicadorDeNuloAusente",
    message:
      "Coluna que aceita NULL lida sem variável indicadora: o DB2 devolve SQLCODE -305 e a host variable fica sem valor. O programa segue com o conteúdo anterior do campo.",
    severity: "CRITICAL",
    type: "BUG",
    remediationEffortMin: 15,
    cwe: ["CWE-252"],
    owasp: [],
    sddTemplateId: "sdd.db2.indicador-de-nulo",
    category: "data-integrity",
    whyNotPattern:
      "Cruza a definição da coluna com a lista do INTO, por posição. Saber se falta indicador exige emparelhar a enésima coluna com a enésima host variable.",
  },
  "HERO-CBL-0561-cursor-nunca-usado": {
    id: "HERO-CBL-0561-cursor-nunca-usado",
    name: "CursorNuncaUsado",
    message:
      "Cursor declarado e nunca aberto: sobra de manutenção que sugere um caminho de leitura que não existe. Quem for manter o programa vai procurar por ele.",
    severity: "MINOR",
    type: "CODE_SMELL",
    remediationEffortMin: 5,
    cwe: ["CWE-561"],
    owasp: [],
    sddTemplateId: "sdd.smell.remove-dead-code",
    category: "code-smell",
    whyNotPattern:
      "O defeito é a AUSÊNCIA de um OPEN em qualquer lugar do programa. Nenhuma linha isolada mostra isso.",
  },
};

export const COBOL_ANALYSIS_LIST: CobolAnalysis[] = Object.values(COBOL_ANALYSES);
