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
};

export const COBOL_ANALYSIS_LIST: CobolAnalysis[] = Object.values(COBOL_ANALYSES);
